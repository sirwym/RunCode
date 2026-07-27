#!/usr/bin/env bash
# ad-hoc 签名构建脚本（本机开发/测试用）
#
# 生成 ad-hoc 签名 + Hardened Runtime 的 .app 和 .dmg
# 首次启动需右键 → 打开以绕过 Gatekeeper
#
# 用法: ./scripts/build-dev.sh

set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== 构建前端 ==="
pnpm build

echo "=== 构建 Tauri（ad-hoc 签名）==="
# tauri build 会自动用 signingIdentity="-" 做 ad-hoc 签名
pnpm tauri build

echo "=== 构建完成 ==="
APP_PATH="src-tauri/target/release/bundle/macos/RunCode.app"
DMG_DIR="src-tauri/target/release/bundle/dmg"

if [ -d "$APP_PATH" ]; then
  echo "✓ .app: $APP_PATH"
  codesign -dv --verbose=2 "$APP_PATH" 2>&1 | head -5
fi

# DMG 可能因 TRAE 沙箱限制无法创建，提供手动命令
if [ ! -d "$DMG_DIR" ]; then
  echo ""
  echo "⚠ DMG 未自动生成（可能因沙箱限制），手动执行："
  echo "  hdiutil create -volname RunCode -srcfolder '$APP_PATH' -ov -format UDZO '$(dirname $DMG_DIR)/RunCode_0.1.0_aarch64.dmg'"
fi

echo ""
echo "首次启动：右键 .app → 打开（绕过 Gatekeeper）"
