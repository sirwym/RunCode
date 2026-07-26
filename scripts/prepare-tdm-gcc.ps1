#!/usr/bin/env pwsh
# RunCode Windows 构建准备脚本：下载并精简 TDM-GCC 到 src-tauri/resources/tdm-gcc/
#
# TDM-GCC 10.3.0 (tdm64) 是 MinGW-w64 based 的稳定版编译器，支持 C++17。
# 官方下载：https://jmeubank.github.io/tdm-gcc/
#
# 本脚本：
#   1. 下载 TDM-GCC 安装器（NSIS .exe，76.6MB）
#   2. 用 7z 解压 NSIS 安装器，提取 TDM-GCC 根目录（含 bin/lib/include/opt/share）
#   3. 精简：删 GDB、mingw32-make、文档
#   4. 复制到 src-tauri/resources/tdm-gcc/
#
# 用法：在 Windows 上执行 `./scripts/prepare-tdm-gcc.ps1`
# 依赖：7-Zip（需在 PATH 中，或通过 7z 命令调用）

set-strictmode -version latest
$ErrorActionPreference = "stop"

# 切换到项目根目录
cd "$(split-path $myinvocation.mycommand.path -parent)/.."

# 配置
$tdmVersion = "10.3.0-2"
$tdmUrl = "https://github.com/jmeubank/tdm-gcc/releases/download/v10.3.0-tdm64-2/tdm64-gcc-$tdmVersion.exe"
$buildDir = "build"
$installerPath = "$buildDir/tdm64-installer.exe"
$extractDir = "$buildDir/tdm-extracted"
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

# 3. 检查 7z 是否可用
$7z = get-command 7z -erroraction silentlycontinue
if (-not $7z) {
    # 尝试常见安装路径
    $7zPaths = @(
        "C:\Program Files\7-Zip\7z.exe",
        "C:\Program Files (x86)\7-Zip\7z.exe"
    )
    foreach ($p in $7zPaths) {
        if (test-path $p) {
            $7z = $p
            break
        }
    }
}
if (-not $7z) {
    throw "未找到 7z，请安装 7-Zip: https://www.7-zip.org/"
}

# 4. 解压 NSIS 安装器
if (-not (test-path $extractDir)) {
    write-host "=== 解压 TDM-GCC 安装器 ===" -foregroundcolor yellow
    & $7z x $installerPath "-o$extractDir" -y | out-null
    write-host "✓ 解压完成: $extractDir"
} else {
    write-host "✓ 已存在解压目录: $extractDir（跳过解压）" -foregroundcolor green
}

# 5. 查找 TDM-GCC 根目录（通过 g++.exe 定位，不依赖固定目录名）
write-host "=== 查找 g++.exe ===" -foregroundcolor yellow
$gppExe = get-childitem -path $extractDir -recurse -file -filter "g++.exe" | select-object -first 1
if (-not $gppExe) {
    throw "未找到 g++.exe，请检查解压结果: $extractDir"
}
# g++.exe 在 bin/ 下，bin/ 的父目录就是 TDM-GCC 根目录（含 bin/lib/include/opt/share）
$tdmSrc = $gppExe.directory.parent
write-host "✓ 找到: $($tdmSrc.fullname)"

# 6. 复制到目标路径
write-host "=== 复制到 $dest ===" -foregroundcolor yellow
if (test-path $dest) {
    remove-item $dest -recurse -force
}
copy-item $tdmSrc.fullname $dest -recurse

# 7. 精简：删除教学不需要的组件
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
    "$bin/addr2line.exe",
    "$bin/nm.exe",
    "$bin/objdump.exe",
    "$bin/objcopy.exe",
    "$bin/readelf.exe",
    "$bin/strip.exe",
    "$bin/strings.exe",
    "$bin/windres.exe",
    "$bin/windmc.exe",
    "$bin/size.exe"
) | where-object { $_ -ne $null }

foreach ($f in $removeFiles) {
    $fullPath = $f -replace '\$bin', "$dest/bin"
    if (test-path $fullPath) {
        remove-item $fullPath -force -erroraction silentlycontinue
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

# 8. 体积验证
$size = (get-childitem $dest -recurse | measure-object length -sum).sum / 1mb
$sizeRounded = [math]::round($size, 1)
write-host ""
write-host "=== 完成 ===" -foregroundcolor cyan
write-host "精简后 TDM-GCC 体积: $sizeRounded MB"

if ($size -gt 200) {
    throw "体积异常，预期 < 200MB，实际 $sizeRounded MB"
}

# 9. 验证 g++.exe 存在
if (-not (test-path "$dest/bin/g++.exe")) {
    throw "未找到 $dest/bin/g++.exe，精简可能过度"
}

write-host "✓ g++.exe 验证通过" -foregroundcolor green
write-host ""
write-host "TDM-GCC 已就绪，可执行 ./scripts/build-windows.ps1 构建安装包"
