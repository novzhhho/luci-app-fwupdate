#
# luci-app-fwupdate —— 从 GitHub Release 一键升级固件
#
# This is free software, licensed under the MIT License.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI app to check and install firmware updates from GitHub Releases
LUCI_DEPENDS:=+luci-base +curl +jsonfilter +rpcd
LUCI_MAINTAINER:=novzhhho

PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=LICENSE

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
