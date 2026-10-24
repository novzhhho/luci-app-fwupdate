# luci-app-fwupdate

给 OpenWrt / ImmortalWrt 用的 LuCI 插件：**在网页上检查 GitHub Release 有没有新固件，点一下直接升级**。
不依赖 Attended Sysupgrade（ASU）服务，也不需要 SSH。

```
LuCI → 系统 → 固件升级
  ├─ 检查更新      查 GitHub Releases，显示新版本号、大小、发布时间、更新说明
  └─ 立即升级      后台下载 → sha256 校验 → sysupgrade，页面实时显示进度
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
| `root/usr/libexec/rpcd/luci.fwupdate` | rpcd 后端，暴露 `status` / `check` / `start` / `log` / `setconfig` |
| `htdocs/.../view/fwupdate/overview.js` | LuCI 页面（原生 JS 视图） |
| `root/usr/share/luci/menu.d/` | 挂到「系统 → 固件升级」 |
| `root/usr/share/rpcd/acl.d/` | 只放行这 5 个 ubus 方法 |
| `root/etc/config/fwupdate` | UCI 配置：`repo`、`mirror` |

设计上有两个刻意的选择：

1. **`check` 只调 GitHub API**（秒级返回），40MB 的下载不在 rpcd 里做，避免 HTTP 请求超时。
2. **`start` 把 `fwupdate -y` 丢到后台**（`start-stop-daemon -b`，退化为 `setsid`），立刻返回；
   页面每 1.5 秒轮询 `log`，读取 `/tmp/fwupdate.log` 和已下载字节数画进度条。

## 安装

### 编进固件（推荐）

```sh
# 在 OpenWrt/ImmortalWrt 源码或 SDK 里
git clone https://github.com/novzhhho/luci-app-fwupdate package/luci-app-fwupdate
make menuconfig     # LuCI → Applications → luci-app-fwupdate
make package/luci-app-fwupdate/compile
```

ImageBuilder 的话，把编好的 `.apk` 丢进 `packages/`，并加进 `PACKAGES=` 即可。

### 只装插件（固件已就绪）

把 [Releases](https://github.com/novzhhho/luci-app-fwupdate/releases) 里的
`luci-app-fwupdate-*.apk` 传到路由器：

```sh
apk add --allow-untrusted ./luci-app-fwupdate-1.0.0-r1.apk
/etc/init.d/rpcd reload
```

## 配置

`/etc/config/fwupdate`：

```
config fwupdate 'main'
	option repo 'novzhhho/immortalwrt-r66s-firmware'
	option mirror ''
```

- `repo`：`owner/repo`，Release 里要有一个 `.img.gz` 或 `.img` 资产，最好还有 `.img.gz.sha256`
- `mirror`：可选下载加速前缀，例如 `https://ghfast.top/`（只作用于下载，不影响 API）

也可以在网页里直接改。

## 版本比对逻辑

用 **tag 字符串** 比对，不用语义化版本：`/etc/fw-version` 存的是构建时的 tag，
和 Release 的 `tag_name` 不同就认为有新版。所以上游任何一个组件变化、CI 生成了新 tag，
页面就会提示更新。

注意两个副作用：

- CI **强制重建但上游版本没变**时 tag 不变，页面会显示「已是最新」。这种时候在 SSH 里
  `fwupdate -f` 强制重刷。
- 手动刷过比 Release 更新的自编包时，`/etc/fw-version` 与 Release 不一致，会一直提示有新版。

## 依赖

运行时：`curl`、`jsonfilter`、`rpcd`、`luci-base`（Makefile 里已声明）。
`fwupdate` 还用到 `hexdump`（ImmortalWrt 的 apk 版**没有 `od`**，脚本里已做 hexdump→od 回退）。

## License

MIT
