#!/usr/bin/env pwsh
# RunCode Windows 一键构建脚本
#
# 流程：
#   1. 构建 Tauri NSIS 安装包（pnpm tauri build，会自动触发 beforeBuildCommand: pnpm build）
#   2. 输出产物路径和体积
#
# TDM-GCC 已内置并提交到仓库（src-tauri/resources/tdm-gcc/），clone 后即用，无需额外准备。
#
# 用法：在 Windows 上执行 `./scripts/build-windows.ps1`
# 产出：src-tauri/target/release/bundle/nsis/RunCode_1.0.2_x64-setup.exe

set-strictmode -version latest
$ErrorActionPreference = "stop"

# 切换到项目根目录
cd "$(split-path $myinvocation.mycommand.path -parent)/.."

write-host "=== RunCode Windows 构建脚本 ===" -foregroundcolor cyan
write-host ""
write-host "✓ TDM-GCC 已就绪: src-tauri/resources/tdm-gcc/bin/g++.exe" -foregroundcolor green
write-host ""

# 1. 构建 Tauri（NSIS 安装包，会自动触发前端构建）
write-host "=== 构建 Tauri (NSIS) ===" -foregroundcolor yellow
pnpm tauri build
write-host ""

# 2. 输出产物路径
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
