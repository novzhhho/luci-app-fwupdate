# luci-app-fwupdate

给 OpenWrt / ImmortalWrt 用的 LuCI 插件：**在网页上检查 GitHub Release 有没有新固件，点一下直接升级**。
不依赖 Attended Sysupgrade（ASU）服务，也不需要 SSH。

```
LuCI → 系统 → 固件升级
  ├─ 版本对比      当前版本 → 可升级到，附镜像大小 / 发布时间 / 状态徽章
  ├─ 检查更新      查 GitHub Releases，展示更新说明
  ├─ 立即升级      七步流水线，每步都有结果，任何一步不过就自动中止
  │                1 检查更新  2 下载镜像  3 校验镜像  4 兼容性预检
  │                5 生成配置备份  6 容量预检  7 刷写
  │                界面实时渲染成勾选清单 + 五段进度条 + 控制台日志
  ├─ 上次升级      开机自证结果：恢复了多少项配置、耗时多久
  └─ 插件版本      插件自身也能从 GitHub 拉新构建，apk 覆盖安装
```

## 它解决什么问题

官方 `luci-app-attendedsysupgrade` 依赖 ASU 服务端做在线重打包。自编固件一旦装了第三方
来源的包（lucky、bandix 之类），ASU 会把这些包一起上报，服务端直接报
`Impossible package selection: missing (...)`, 升级不了。

本插件换成完全不同的思路：**升级包由 CI 提前构建好放在 Release 里**，路由器只负责下载和刷写。
没有服务端，没有包解析，也就没有那类失败。

## 组成

| 文件 | 作用 |
|---|---|
| `root/usr/bin/fwupdate` | 升级引擎（纯 shell）：七步流水线，自建配置包，`sysupgrade -T` 预检后 `-f` 刷写 |
| `root/usr/libexec/rpcd/luci.fwupdate` | rpcd 后端：`status` `check` `log` `start` `setconfig` + `selfstatus` `selfcheck` `selfupdate` |
| `root/etc/uci-defaults/95_luci-app-fwupdate` | 首启：确保持久分区开机自动挂载、迁移仓库地址到 uci |
| `root/etc/uci-defaults/97_luci-app-fwupdate-verify` | 首启：读 `pending.json`，从完整备份补齐文件，逐项核对指纹，写 `result.json` |
| `htdocs/.../view/fwupdate/overview.js` | LuCI 页面（原生 JS 视图，自带作用域 CSS） |
| `root/usr/share/luci/menu.d/` | 挂到「系统 → 固件升级」 |
| `root/usr/share/rpcd/acl.d/` | 只放行上面 8 个 ubus 方法 |
| `root/etc/config/fwupdate` | UCI 配置：`repo`、`mirror` |
| `.github/workflows/apk.yml` | 每次 push 打 apk 并发 Release（tag = commit 短 sha） |

## 为什么自己打包配置，而不是让 sysupgrade 打

`sysupgrade` 默认把 `/lib/upgrade/keep.d/*` 列出的路径全打成一个包，写到 **p1 引导分区**，
重启后由 `preinit` 搬回 `/`（这是唯一能跨刷写存活的通道）。

问题出在 `luci-app-openclash` 的 keep.d 写的是整个 `/etc/openclash/` —— 里面有
`GeoIP.dat`(15.7 MB)、`GeoSite.dat`(10.9 MB)、`core/clash_meta`(10.3 MB)、`ASN.mmdb`(8.6 MB)
等纯数据文件，实测打出来 **27.2 MB**，而这块 16 MB 的分区只剩 **9.0 MB**。

更糟的是 `platform_copy_config()` 里是 `cp -af` 之后直接 `umount`，**不检查返回值**；
而 `/lib/preinit/79_move_config` 只判 `[ -f /sysupgrade.tgz ]`。于是残缺的包会被当成好包
搬走，开机解一半 —— 配置只恢复一半，且没有任何报错。

所以本插件的做法是：

1. 用 `sysupgrade -l` 拿系统自己认的清单（语义与官方完全一致，不会漏项），只做减法；
2. 剔掉 `*.apk-new` 残留、`/etc/fw-version`（必须让新镜像覆盖）、以及单文件 ≥4 MB 的纯资源；
3. 打包后**硬校验**体积不得超过 p1 可用空间的 90%，超了就中止，绝不带着风险刷；
4. 用 `sysupgrade -f <自制包>` 喂给 sysupgrade —— 它会跳过 `create_backup_archive`，
   直接用这份包，全程不改 `/lib/upgrade/keep.d` 任何文件。

## 持久分区（可选，但强烈建议）

卡上若有一块刷写不会碰的分区（本方案是 p3，ext4，标签 `fwstore`，挂 `/mnt/fwstore`），
插件会用它做三件事：

- **完整备份**：`sysupgrade -b` 的 27 MB 全量包存 `backup/`，保留最近 3 份；
- **开机补齐**：`97_*` 脚本用它把第 2 步剔除掉的文件补回 `/etc`，所以剔除不产生真实丢失；
- **镜像缓存**：下载过的固件留 `images/`，同版本重刷不再走流量。

为什么这块分区能存活：`platform_do_upgrade()` 在分区表没变时，是按**镜像里列出的分区**
逐个 `dd` 的，最后只回写 MBR 偏移 440 的 4 字节磁盘签名。镜像里只有 p1、p2，
所以 p3 一个字节都不会被碰。判断「分区表变了」用的是
`grep -v -f 现网分区表 镜像分区表` —— 只看镜像里多出来的分区，磁盘上多一个 p3 不触发。

没有这块分区时，插件自动退化：只用 p1 + 精简包，OpenClash 资源由它自己重新下载。

## 升级结果自证

刷写前把 `pending.json`（目标版本、镜像 sha256、开始时间）和 `pending.list`
（每个文件的 sha256）**打进配置包本身** —— 因为 `/etc` 会被整体替换，只有包里的东西
能跨过重启。

开机后 `97_*` 脚本（早于任何服务启动）逐文件核对，写出 `result.json`：

| status | 含义 |
|---|---|
| `ok` | 版本已到目标值，备份里的文件一个不少 |
| `partial` | 版本已变，但有文件没恢复（真正需要警惕的） |
| `notapplied` | 版本没变，刷写没生效或中途取消 |
| `unknown` | 版本变成了第三个值 |

页面首屏读它，在顶部显示「上次升级成功：A → B · 配置 111/111 项全部到位 · 用时 95 秒」。

设计上有三个刻意的选择：

1. **`check` 只调 GitHub API**（秒级返回），40MB 的下载不在 rpcd 里做，避免 HTTP 请求超时。
2. **`start` 把 `fwupdate -y` 丢到后台**，立刻返回；页面每 1.5 秒轮询 `log`，
   读 `/tmp/fwupdate.log` 和已下载字节数画进度环。
3. **自更新先 reload 不行**：`selfupdate` 是 rpcd 自己在处理，重启 rpcd 会把回包弄丢，
   前端看到超时（实测踩过）。所以 apk 覆盖后不重启，靠下一次调用生效。

## 安装

### 用 apk 装（推荐，便于管理）

```sh
# 取最新构建（tag 就是 commit 短 sha）
URL=$(wget -qO- https://api.github.com/repos/novzhhho/luci-app-fwupdate/releases/latest \
      | jsonfilter -e '@.assets[*].browser_download_url' | grep '\.apk$')
wget -O /tmp/p.apk "$URL"
apk add --allow-untrusted /tmp/p.apk     # 装
apk list -I luci-app-fwupdate            # 看版本
apk del luci-app-fwupdate                # 卸（含所有文件）
```

装好之后也可以完全在网页里更新：**固件升级 → 插件版本 → 检查插件更新 → 更新插件**。

### 编进固件

```sh
git clone https://github.com/novzhhho/luci-app-fwupdate package/luci-app-fwupdate
make menuconfig     # LuCI → Applications → luci-app-fwupdate
make package/luci-app-fwupdate/compile
```

ImageBuilder 的话，把编好的 `.apk` 丢进 `packages/` 并加进 `PACKAGES=` 即可。

## 配置

`/etc/config/fwupdate`：

```
config fwupdate 'main'
	option repo 'novzhhho/immortalwrt-r66s-firmware'
	option mirror ''
```

- `repo`：`owner/repo`，Release 里要有一个 `.img.gz` 或 `.img` 资产，最好还有 `.img.gz.sha256`
- `mirror`：可选下载加速前缀，例如 `https://ghfast.top/`（只作用于下载，不影响 API）

也可以在网页的「高级设置」里改。

## 版本比对逻辑

**固件**用 tag 字符串比对，不用语义化版本：`/etc/fw-version` 存的是构建时的 tag，
和 Release 的 `tag_name` 不同就认为有新版。上游任何一个组件变化、CI 生成了新 tag，页面就会提示更新。

**插件自身**用 commit 短 sha 比对：构建时把 sha 写进 `/usr/share/luci-app-fwupdate/build`，
Release 的 tag 就是那个 sha，两者不同即视为有新版本。

两个副作用：

- CI **强制重建但上游版本没变**时固件 tag 不变，页面显示「已是最新」。这时在 SSH 里
  `fwupdate -f` 强制重刷。
- 手动刷过比 Release 更新的自编包时，`/etc/fw-version` 与 Release 不一致，会一直提示有新版。

## 依赖

运行时：`curl`、`jsonfilter`、`rpcd`、`luci-base`（Makefile 里已声明）。
`fwupdate` 还用到 `hexdump`（ImmortalWrt 的 apk 版**没有 `od`**，脚本里已做 hexdump→od 回退）、
`tar` / `sha256sum`（busybox 自带）、`flock`（有就加锁，没有则跳过）。
第 6 步读取 p1 可用空间时会 source `/lib/functions.sh` 与 `/lib/upgrade/common.sh`
（`export_partdevice` 依赖前者，少 source 一个会静默失败）。

## License

MIT
