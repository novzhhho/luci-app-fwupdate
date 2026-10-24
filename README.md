# luci-app-fwupdate

给 OpenWrt / ImmortalWrt 用的 LuCI 插件：**在网页上检查 GitHub Release 有没有新固件，点一下直接升级**。
不依赖 Attended Sysupgrade（ASU）服务，也不需要 SSH。

```
LuCI → 系统 → 固件升级
  ├─ 版本对比      当前版本 → 可升级到，附镜像大小 / 发布时间 / 状态徽章
  ├─ 检查更新      查 GitHub Releases，展示更新说明
  ├─ 立即升级      后台下载 → sha256 → 魔数校验 → sysupgrade
  │                升级时切换成四步流程 + 进度环 + 控制台日志
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
| `root/usr/bin/fwupdate` | 升级引擎（纯 shell）：查 Release → 下载 → sha256 → gzip 魔数 → `sysupgrade` |
| `root/usr/libexec/rpcd/luci.fwupdate` | rpcd 后端：`status` `check` `log` `start` `setconfig` + `selfstatus` `selfcheck` `selfupdate` |
| `htdocs/.../view/fwupdate/overview.js` | LuCI 页面（原生 JS 视图，自带作用域 CSS） |
| `root/usr/share/luci/menu.d/` | 挂到「系统 → 固件升级」 |
| `root/usr/share/rpcd/acl.d/` | 只放行上面 8 个 ubus 方法 |
| `root/etc/config/fwupdate` | UCI 配置：`repo`、`mirror` |
| `.github/workflows/apk.yml` | 每次 push 打 apk 并发 Release（tag = commit 短 sha） |

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
`fwupdate` 还用到 `hexdump`（ImmortalWrt 的 apk 版**没有 `od`**，脚本里已做 hexdump→od 回退）。

## License

MIT
