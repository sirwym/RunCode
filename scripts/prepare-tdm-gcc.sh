#!/usr/bin/env bash
# RunCode macOS/Linux 用的 TDM-GCC 下载缓存脚本
#
# 本脚本仅在 macOS/Linux 上预下载 TDM-GCC 安装器到 build/ 目录，
# 供 GitHub Actions CI 缓存使用。不在 macOS 上解压（7z 可能不可用）。
#
# 实际解压和精简由 prepare-tdm-gcc.ps1 在 Windows runner 上执行。

set -euo pipefail

# 切换到项目根目录
cd "$(dirname "$0")/.."

TDM_VERSION="10.3.0-2"
TDM_URL="https://github.com/jmeubank/tdm-gcc/releases/download/v10.3.0-tdm64-2/tdm64-gcc-${TDM_VERSION}.exe"
BUILD_DIR="build"
INSTALLER_PATH="${BUILD_DIR}/tdm64-installer.exe"

echo "=== RunCode TDM-GCC 下载缓存脚本 (macOS/Linux) ==="
echo "TDM-GCC 版本: ${TDM_VERSION}"
echo ""

mkdir -p "${BUILD_DIR}"

if [ -f "${INSTALLER_PATH}" ]; then
    SIZE_MB=$(du -m "${INSTALLER_PATH}" | cut -f1)
    echo "✓ 已存在安装器: ${INSTALLER_PATH} (${SIZE_MB} MB，跳过下载)"
    exit 0
fi

echo "=== 下载 TDM-GCC 安装器 ==="
echo "URL: ${TDM_URL}"
curl -L -o "${INSTALLER_PATH}" "${TDM_URL}"

SIZE_MB=$(du -m "${INSTALLER_PATH}" | cut -f1)
echo "✓ 下载完成: ${INSTALLER_PATH} (${SIZE_MB} MB)"
echo ""
echo "注意：macOS/Linux 上不解压 TDM-GCC，仅做缓存。"
echo "实际解压由 prepare-tdm-gcc.ps1 在 Windows runner 上执行。"
