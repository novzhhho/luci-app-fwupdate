#
# luci-app-fwupdate —— 从 GitHub Release 一键升级固件
#
# This is free software, licensed under the MIT License.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI app to check and install firmware updates from GitHub Releases
LUCI_DEPENDS:=+luci-base +curl +jsonfilter +rpcd
LUCI_MAINTAINER:=novzhhho
LUCI_URL:=https://github.com/novzhhho/luci-app-fwupdate

# 版本由 CI 改写：PKG_RELEASE 取 commit 数，保证每次构建版本号递增，
# 这样路由器上 apk add 才会真正覆盖安装（详见 .github/workflows/apk.yml）
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=LICENSE

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
