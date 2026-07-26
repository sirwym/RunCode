#!/usr/bin/env pwsh
# RunCode Windows 一键构建脚本
#
# 流程：
#   1. 准备 TDM-GCC（若 resources/tdm-gcc/ 不存在则下载精简）
#   2. 构建前端（pnpm build）
#   3. 构建 Tauri NSIS 安装包（pnpm tauri build）
#   4. 输出产物路径和体积
#
# 用法：在 Windows 上执行 `./scripts/build-windows.ps1`
# 产出：src-tauri/target/release/bundle/nsis/RunCode_0.1.0_x64-setup.exe

set-strictmode -version latest
$ErrorActionPreference = "stop"

# 切换到项目根目录
cd "$(split-path $myinvocation.mycommand.path -parent)/.."

write-host "=== RunCode Windows 构建脚本 ===" -foregroundcolor cyan
write-host ""

# 1. 准备 TDM-GCC（若 resources/tdm-gcc/bin/g++.exe 不存在则下载）
$gppPath = "src-tauri/resources/tdm-gcc/bin/g++.exe"
if (-not (test-path $gppPath)) {
    write-host "=== 准备 TDM-GCC ===" -foregroundcolor yellow
    ./scripts/prepare-tdm-gcc.ps1
    write-host ""
} else {
    write-host "✓ TDM-GCC 已就绪: $gppPath（跳过准备）" -foregroundcolor green
    write-host ""
}

# 2. 构建前端
write-host "=== 构建前端 ===" -foregroundcolor yellow
pnpm build
write-host "✓ 前端构建完成"
write-host ""

# 3. 构建 Tauri（NSIS 安装包）
write-host "=== 构建 Tauri (NSIS) ===" -foregroundcolor yellow
pnpm tauri build
write-host ""

# 4. 输出产物路径
write-host "=== 构建完成 ===" -foregroundcolor cyan
$nsisPath = get-childitem "src-tauri/target/release/bundle/nsis/*.exe" -erroraction silentlycontinue | select-object -first 1
if ($nsisPath) {
    $sizeMB = [math]::round((get-item $nsisPath.fullname).length / 1mb, 1)
    write-host "✓ NSIS 安装包: $($nsisPath.fullname)" -foregroundcolor green
    write-host "  体积: $sizeMB MB"
    if ($sizeMB -gt 100) {
        write-host "⚠ 警告：体积超过 100MB，请检查 TDM-GCC 精简是否生效" -foregroundcolor yellow
    }
} else {
    write-host "⚠ 未找到 NSIS 安装包，请检查构建日志" -foregroundcolor red
    exit 1
}
