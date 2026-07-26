#!/usr/bin/env pwsh
# RunCode TDM-GCC 升级工具（仅升级时使用，日常构建不需要）
#
# 用途：在 Windows 上重新生成 src-tauri/resources/tdm-gcc/
# 触发场景：TDM-GCC 版本升级时，手动运行此脚本，生成后提交到仓库
# 日常构建：无需运行本脚本，TDM-GCC 已提交到仓库，clone 后直接 ./scripts/build-windows.ps1
#
# TDM-GCC 10.3.0 (tdm64) 是 MinGW-w64 based 的稳定版编译器，支持 C++17。
# 官方下载：https://jmeubank.github.io/tdm-gcc/
#
# 本脚本使用 7z 解压方案（而非 NSIS 静默安装），因为 NSIS /S 静默安装
# 在部分 Windows 环境下会崩溃（0xC0000005）。7z 方案更可靠：
#   1. 下载 TDM-GCC NSIS 安装器（76.6MB）
#   2. 用 7z 解压 NSIS 安装器 → 得到 $PLUGINSDIR 下的 .tar.xz 包
#   3. 用 7z 解压需要的 .tar.xz → .tar → 实际文件
#   4. 精简：删 GDB、make、LTO、32 位库、文档
#
# 7z 依赖：需要系统有 7z.exe（PATH 中或常见安装路径）。
#   - 7-Zip: https://www.7-zip.org/
#   - 或 Git for Windows 自带的 7z
#
# 用法：在 Windows 上执行 `./scripts/prepare-tdm-gcc.ps1`

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
$staging = "$buildDir/tdm-extract"

# 需要的 tar.xz 包（跳过 gdb、make）
$neededPackages = @(
    "gcc-10.3.0-tdm64-1-core.tar.xz",
    "gcc-10.3.0-tdm64-1-c++.tar.xz",
    "binutils-2.36.1-tdm64-1.tar.xz",
    "mingw64runtime-v8-git2021050601-gcc10-tdm64-1.tar.xz",
    "libiconv-1.14-4-mingw32-dll-2.tar.xz",
    "libintl-0.18.3.2-2-mingw32-dll-8.tar.xz",
    "windows-default-manifest-6.4-x86_64_multi.tar.xz",
    "gcc-10.3.0-tdm-1-dw2-libgcc.tar.xz"
)

write-host "=== RunCode TDM-GCC 升级工具 ===" -foregroundcolor cyan
write-host "TDM-GCC 版本: $tdmVersion"
write-host "目标路径: $dest"
write-host ""

# 0. 检测 7z
$sevenZip = $null
foreach ($candidate in @(
    (get-command 7z -erroraction silentlycontinue).Source,
    "C:\Program Files\7-Zip\7z.exe",
    "C:\Program Files (x86)\7-Zip\7z.exe"
)) {
    if ($candidate -and (test-path $candidate)) {
        $sevenZip = $candidate
        break
    }
}
if (-not $sevenZip) {
    throw "未找到 7z.exe，请安装 7-Zip: https://www.7-zip.org/"
}
write-host "✓ 7z: $sevenZip" -foregroundcolor green

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

# 3. 解压 NSIS 安装器
write-host "=== 解压 NSIS 安装器 ===" -foregroundcolor yellow
if (test-path $staging) {
    remove-item $staging -recurse -force
}
& $sevenZip x $installerPath "-o$staging" -y | out-null
if (-not (test-path "$staging/`$PLUGINSDIR")) {
    throw "NSIS 解压失败：未找到 $staging/`$PLUGINSDIR"
}
write-host "✓ NSIS 解压完成" -foregroundcolor green

# 4. 解压 tar.xz 包到目标目录
write-host "=== 解压 tar.xz 包 ===" -foregroundcolor yellow
if (test-path $dest) {
    remove-item $dest -recurse -force
}
new-item -itemtype directory -path $dest -force | out-null

$pluginsDir = "$staging/`$PLUGINSDIR"
foreach ($pkg in $neededPackages) {
    $pkgPath = join-path $pluginsDir $pkg
    if (-not (test-path $pkgPath)) {
        write-host "⚠ 未找到 $pkg，跳过" -foregroundcolor yellow
        continue
    }
    write-host "  解压 $pkg ..."
    # 7z 解压 .tar.xz 需要两步：先 .xz → .tar，再 .tar → 文件
    & $sevenZip x $pkgPath "-o$dest" -y | out-null
    # 解压得到的 .tar 文件
    $tarFile = join-path $dest ($pkg -replace '\.xz$', '')
    if (test-path $tarFile) {
        & $sevenZip x $tarFile "-o$dest" -y | out-null
        remove-item $tarFile -force
    }
}
write-host "✓ tar.xz 解压完成" -foregroundcolor green

# 5. 验证安装成功
if (-not (test-path "$dest/bin/g++.exe")) {
    throw "解压失败：未找到 $dest/bin/g++.exe"
}
write-host "✓ 安装完成: $dest/bin/g++.exe" -foregroundcolor green

# 6. 精简：删除教学不需要的组件
write-host "=== 精简：删除冗余组件 ===" -foregroundcolor yellow

$removeFiles = @(
    # GDB 及调试工具
    "$dest/bin/gdb.exe", "$dest/bin/gdbserver.exe",
    # make
    "$dest/bin/mingw32-make.exe",
    # Fortran
    "$dest/bin/gfortran.exe", "$dest/bin/gccbug",
    # 编译器内部工具（编译器核心 cc1/cc1plus/collect2 在 libexec 下，保留）
    "$dest/bin/cpp.exe", "$dest/bin/gcov.exe", "$dest/bin/gcov-dump.exe", "$dest/bin/gcov-tool.exe",
    # binutils 工具
    "$dest/bin/addr2line.exe", "$dest/bin/nm.exe", "$dest/bin/objdump.exe",
    "$dest/bin/objcopy.exe", "$dest/bin/readelf.exe", "$dest/bin/strip.exe",
    "$dest/bin/strings.exe", "$dest/bin/windres.exe", "$dest/bin/windmc.exe",
    "$dest/bin/size.exe", "$dest/bin/ranlib.exe", "$dest/bin/ar.exe",
    "$dest/bin/dlltool.exe",
    # LTO（教学用 -O0，不需要链接时优化）
    "$dest/bin/lto-dump.exe",
    "$dest/libexec/gcc/x86_64-w64-mingw32/10.3.0/lto1.exe",
    "$dest/libexec/gcc/x86_64-w64-mingw32/10.3.0/lto-wrapper.exe",
    # 性能分析/名称解构
    "$dest/bin/gprof.exe", "$dest/bin/c++filt.exe",
    # 重复的前缀可执行文件
    "$dest/bin/x86_64-w64-mingw32-c++.exe",
    "$dest/bin/x86_64-w64-mingw32-g++.exe",
    "$dest/bin/x86_64-w64-mingw32-gcc-10.3.0.exe",
    "$dest/bin/x86_64-w64-mingw32-gcc.exe"
)

foreach ($f in $removeFiles) {
    if (test-path $f) {
        remove-item $f -force -erroraction silentlycontinue
    }
}

$removeDirs = @(
    "$dest/share/doc", "$dest/share/info", "$dest/share/man", "$dest/share/locale",
    "$dest/opt",
    "$dest/share/gcc-10.3.0", "$dest/share/gdb",
    # 32 位库（教学用 64 位编译）
    "$dest/x86_64-w64-mingw32/lib32",
    # Objective-C / backward 兼容头文件
    "$dest/lib/gcc/x86_64-w64-mingw32/10.3.0/include/objc",
    "$dest/lib/gcc/x86_64-w64-mingw32/10.3.0/include/g++-v10.3.0/backward"
)

foreach ($d in $removeDirs) {
    if (test-path $d) {
        remove-item $d -recurse -force -erroraction silentlycontinue
    }
}

write-host "✓ 精简完成"

# 7. 清理临时目录
remove-item $staging -recurse -force -erroraction silentlycontinue

# 8. 体积验证
$size = (get-childitem $dest -recurse | measure-object length -sum).sum / 1mb
$sizeRounded = [math]::round($size, 1)
write-host ""
write-host "=== 完成 ===" -foregroundcolor cyan
write-host "精简后 TDM-GCC 体积: $sizeRounded MB"

if ($size -gt 300) {
    throw "体积异常，预期 < 300MB，实际 $sizeRounded MB"
}

# 9. 最终验证
if (-not (test-path "$dest/bin/g++.exe")) {
    throw "未找到 $dest/bin/g++.exe，精简可能过度"
}

write-host "✓ g++.exe 验证通过" -foregroundcolor green
write-host ""
write-host "TDM-GCC 已就绪，请将 src-tauri/resources/tdm-gcc/ 提交到仓库"
