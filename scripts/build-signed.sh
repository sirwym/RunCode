#!/usr/bin/env bash
# Developer ID 签名 + Apple 公证构建脚本（正式分发用）
#
# 前置条件：
# 1. Apple Developer 账号（$99/年）
# 2. Developer ID Application 证书已导入钥匙串
# 3. 设置环境变量：
#    - APPLE_SIGNING_IDENTITY：证书名称，如 "Developer ID Application: Your Name (TeamID)"
#    - APPLE_ID：Apple ID 邮箱
#    - APPLE_PASSWORD：app-specific 密码（https://appleid.apple.com → 应用专用密码）
#    - APPLE_TEAM_ID：Team ID（https://developer.apple.com/account → Membership）
#
# 用法: ./scripts/build-signed.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# ============ 环境变量检查 ============
echo "=== 检查签名/公证环境变量 ==="

if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "✗ 缺少 APPLE_SIGNING_IDENTITY"
  echo "  在钥匙串中查找：security find-identity -v -p codesigning | grep 'Developer ID'"
  echo "  然后设置：export APPLE_SIGNING_IDENTITY='Developer ID Application: Your Name (TeamID)'"
  exit 1
fi

if [ -z "${APPLE_ID:-}" ]; then
  echo "✗ 缺少 APPLE_ID（Apple ID 邮箱）"
  exit 1
fi

if [ -z "${APPLE_PASSWORD:-}" ]; then
  echo "✗ 缺少 APPLE_PASSWORD（app-specific 密码）"
  echo "  生成：https://appleid.apple.com → 登录 → 应用专用密码"
  exit 1
fi

if [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "✗ 缺少 APPLE_TEAM_ID"
  echo "  查找：https://developer.apple.com/account → Membership Details → Team ID"
  exit 1
fi

echo "✓ APPLE_SIGNING_IDENTITY: $APPLE_SIGNING_IDENTITY"
echo "✓ APPLE_ID: $APPLE_ID"
echo "✓ APPLE_TEAM_ID: $APPLE_TEAM_ID"
echo "✓ APPLE_PASSWORD: [已设置]"

# ============ 验证证书存在 ============
echo ""
echo "=== 验证证书 ==="
if ! security find-identity -v -p codesigning | grep -q "$APPLE_SIGNING_IDENTITY"; then
  echo "✗ 钥匙串中未找到证书: $APPLE_SIGNING_IDENTITY"
  echo "  可用证书："
  security find-identity -v -p codesigning
  exit 1
fi
echo "✓ 证书验证通过"

# ============ 导出签名环境变量 ============
export APPLE_SIGNING_IDENTITY
export APPLE_ID
export APPLE_PASSWORD
export APPLE_TEAM_ID

# ============ 构建前端 ============
echo ""
echo "=== 构建前端 ==="
pnpm build

# ============ 构建 Tauri（签名+公证）============
# tauri.conf.json 中 signingIdentity 改为 "${APPLE_SIGNING_IDENTITY}"
# 或通过环境变量覆盖
echo ""
echo "=== 构建 Tauri（Developer ID 签名 + Apple 公证）==="
# 临时替换 signingIdentity
TAURI_CONF="src-tauri/tauri.conf.json"
cp "$TAURI_CONF" "$TAURI_CONF.bak"
trap 'cp "$TAURI_CONF.bak" "$TAURI_CONF" && rm "$TAURI_CONF.bak"' EXIT

# 用 jq 替换 signingIdentity（如果 jq 不可用则用 sed）
if command -v jq &>/dev/null; then
  jq --arg id "$APPLE_SIGNING_IDENTITY" \
    '.bundle.macOS.signingIdentity = $id' \
    "$TAURI_CONF" > "$TAURI_CONF.tmp" && mv "$TAURI_CONF.tmp" "$TAURI_CONF"
else
  sed -i '' "s/\"signingIdentity\": \"-\"/\"signingIdentity\": \"$APPLE_SIGNING_IDENTITY\"/" "$TAURI_CONF"
fi

pnpm tauri build

# ============ 验证签名 ============
echo ""
echo "=== 验证签名 ==="
APP_PATH="src-tauri/target/release/bundle/macos/RunCode.app"
DMG_PATH=$(ls src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null | head -1 || true)

if [ -d "$APP_PATH" ]; then
  echo "--- .app 签名信息 ---"
  codesign -dv --verbose=2 "$APP_PATH" 2>&1 | head -8
fi

if [ -n "$DMG_PATH" ]; then
  echo ""
  echo "--- DMG 签名信息 ---"
  codesign -dv --verbose=2 "$DMG_PATH" 2>&1 | head -5

  echo ""
  echo "=== Gatekeeper 验证 ==="
  if spctl --assess --type install --verbose "$DMG_PATH" 2>&1; then
    echo "✓ Gatekeeper 验证通过"
  else
    echo "⚠ Gatekeeper 验证未通过（可能公证仍在传播，等待 5-10 分钟后重试）"
  fi

  echo ""
  echo "=== Stapler 验证 ==="
  if xcrun stapler validate "$DMG_PATH" 2>&1; then
    echo "✓ Stapler 验证通过"
  else
    echo "⚠ Stapler 验证未通过"
  fi
fi

echo ""
echo "=== 构建完成 ==="
echo "签名+公证的 DMG 可直接双击安装，无需右键打开"
