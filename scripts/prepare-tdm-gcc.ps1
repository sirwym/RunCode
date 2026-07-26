#!/usr/bin/env pwsh
# RunCode Windows 构建准备脚本：下载并精简 TDM-GCC 到 src-tauri/resources/tdm-gcc/
#
# TDM-GCC 10.3.0 (tdm64) 是 MinGW-w64 based 的稳定版编译器，支持 C++17。
# 官方下载：https://jmeubank.github.io/tdm-gcc/
#
# 本脚本：
#   1. 下载 TDM-GCC NSIS 安装器（76.6MB）
#   2. NSIS 静默安装（/S /D=）到 src-tauri/resources/tdm-gcc/
#   3. 精简：删 GDB、mingw32-make、文档
#
# 用法：在 Windows 上执行 `./scripts/prepare-tdm-gcc.ps1`
# 说明：使用 NSIS 静默安装而非 7z 解压，因为 TDM-GCC 安装器内部还嵌套着
#       7z/LZMA 压缩包，7z 解压只能拿到 NSIS 容器，拿不到实际文件。

set-strictmode -version latest
$ErrorActionPreference = "stop"

# 切换到项目根目录
cd "$(split-path $myinvocation.mycommand.path -parent)/.."

# 配置
$tdmVersion = "10.3.0-2"
$tdmUrl = "https://github.com/jmeubank/tdm-gcc/releases/download/v10.3.0-tdm64-2/tdm64-gcc-$tdmVersion.exe"
$buildDir = "build"
$installerPath = "$buildDir/tdm64-installer.exe"
$dest = "src-tauri/resources/tdm-gcc"

write-host "=== RunCode TDM-GCC 准备脚本 ===" -foregroundcolor cyan
write-host "TDM-GCC 版本: $tdmVersion"
write-host "目标路径: $dest"
write-host ""

# 1. 创建构建目录
if (-not (test-path $buildDir)) {
    new-item -itemtype directory -path $buildDir | out-null
}

# 2. 下载 TDM-GCC 安装器（若已存在则跳过）
if (-not (test-path $installerPath)) {
    write-host "=== 下载 TDM-GCC 安装器 ===" -foregroundcolor yellow
    write-host "URL: $tdmUrl"
    invoke-webrequest $tdmUrl -outfile $installerPath
    $sizeMB = [math]::round((get-item $installerPath).length / 1mb, 1)
    write-host "✓ 下载完成: $installerPath ($sizeMB MB)"
} else {
    write-host "✓ 已存在安装器: $installerPath（跳过下载）" -foregroundcolor green
}

# 3. NSIS 静默安装到目标目录
write-host "=== NSIS 静默安装 TDM-GCC ===" -foregroundcolor yellow
if (test-path $dest) {
    write-host "清理已有目标目录: $dest"
    remove-item $dest -recurse -force
}

# /D= 必须是最后一个参数，不能含引号，必须是绝对路径
$destAbs = (resolve-path -path ".").path + "\$dest"
write-host "安装到: $destAbs"
& $installerPath /S /D=$destAbs

# 4. 验证安装成功
if (-not (test-path "$dest/bin/g++.exe")) {
    throw "NSIS 安装失败：未找到 $dest/bin/g++.exe"
}
write-host "✓ 安装完成: $dest/bin/g++.exe" -foregroundcolor green

# 5. 精简：删除教学不需要的组件
write-host "=== 精简：删除冗余组件 ===" -foregroundcolor yellow

$removeFiles = @(
    "$dest/bin/gdb.exe",
    "$dest/bin/gdbserver.exe",
    "$dest/bin/mingw32-make.exe",
    "$dest/bin/gfortran.exe",
    "$dest/bin/gccbug",
    "$dest/bin/cc1.exe",
    "$dest/bin/cc1plus.exe",
    "$dest/bin/collect2.exe",
    "$dest/bin/cpp.exe",
    "$dest/bin/gcov.exe",
    "$dest/bin/addr2line.exe",
    "$dest/bin/nm.exe",
    "$dest/bin/objdump.exe",
    "$dest/bin/objcopy.exe",
    "$dest/bin/readelf.exe",
    "$dest/bin/strip.exe",
    "$dest/bin/strings.exe",
    "$dest/bin/windres.exe",
    "$dest/bin/windmc.exe",
    "$dest/bin/size.exe"
)

foreach ($f in $removeFiles) {
    if (test-path $f) {
        remove-item $f -force -erroraction silentlycontinue
    }
}

$removeDirs = @(
    "$dest/share/doc",
    "$dest/share/info",
    "$dest/share/man",
    "$dest/share/locale",
    "$dest/opt",
    "$dest/lib/gcc/x86_64-w64-mingw32/10.3.0/include/objc",
    "$dest/lib/gcc/x86_64-w64-mingw32/10.3.0/include/g++-v10.3.0/backward"
)

foreach ($d in $removeDirs) {
    if (test-path $d) {
        remove-item $d -recurse -force -erroraction silentlycontinue
    }
}

write-host "✓ 精简完成"

# 6. 体积验证
$size = (get-childitem $dest -recurse | measure-object length -sum).sum / 1mb
$sizeRounded = [math]::round($size, 1)
write-host ""
write-host "=== 完成 ===" -foregroundcolor cyan
write-host "精简后 TDM-GCC 体积: $sizeRounded MB"

if ($size -gt 200) {
    throw "体积异常，预期 < 200MB，实际 $sizeRounded MB"
}

# 7. 最终验证
if (-not (test-path "$dest/bin/g++.exe")) {
    throw "未找到 $dest/bin/g++.exe，精简可能过度"
}

write-host "✓ g++.exe 验证通过" -foregroundcolor green
write-host ""
write-host "TDM-GCC 已就绪，可执行 ./scripts/build-windows.ps1 构建安装包"
