# 构建与签名指南（macOS + Windows）

本文档说明如何为 RunCode 构建 macOS DMG 和 Windows NSIS 安装包，并配置代码签名与公证。

## macOS 构建

### 当前状态

- **签名方式**：ad-hoc（`signingIdentity: "-"`）
- **Hardened Runtime**：已启用（`entitlements.plist`）
- **首次启动**：需右键 → 打开以绕过 Gatekeeper
- **正式分发**：❌ 未配置（需要 Apple Developer 账号）

### 升级到正式签名

#### 1. 申请 Apple Developer 账号

1. 访问 https://developer.apple.com/programs/
2. 注册 Apple Developer Program（$99/年）
3. 完成身份验证

#### 2. 创建 Developer ID 证书

1. 登录 https://developer.apple.com/account/
2. Certificates, Identifiers & Profiles → Certificates → +
3. 选择 **Developer ID Application**（用于签名 .app）
4. 上传 Certificate Signing Request (CSR)
   - 钥匙串访问 → 证书助理 → 从证书颁发机构请求证书
5. 下载并双击安装 .cer 文件

验证证书：
```bash
security find-identity -v -p codesigning | grep "Developer ID"
```

#### 3. 获取公证所需信息

| 环境变量 | 说明 | 获取方式 |
|---------|------|---------|
| `APPLE_SIGNING_IDENTITY` | 证书名称 | `security find-identity -v -p codesigning` 输出 |
| `APPLE_ID` | Apple ID 邮箱 | 注册时使用的邮箱 |
| `APPLE_PASSWORD` | app-specific 密码 | https://appleid.apple.com → 登录 → 应用专用密码 → 生成 |
| `APPLE_TEAM_ID` | Team ID | https://developer.apple.com/account → Membership Details |

#### 4. 配置环境变量

在 `~/.zshrc` 或 `~/.bash_profile` 中添加：

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (XXXXXXXXXX)"
export APPLE_ID="your@email.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

> ⚠️ 不要将这些凭据提交到版本控制。建议使用 macOS 钥匙串或环境变量管理工具。

#### 5. 执行正式构建

```bash
./scripts/build-signed.sh
```

脚本会自动：
1. 检查环境变量
2. 验证证书存在
3. 临时替换 `tauri.conf.json` 的 `signingIdentity`
4. 执行 `pnpm tauri build`（Tauri 2 内置公证）
5. 验证 Gatekeeper 和 Stapler

#### 6. 验证分发

```bash
# Gatekeeper 验证
spctl --assess --type install --verbose "RunCode_0.1.2_aarch64.dmg"

# Stapler 验证
xcrun stapler validate "RunCode_0.1.2_aarch64.dmg"
```

通过后，用户可双击 DMG 直接安装，无需右键打开。

### Entitlements 说明

`src-tauri/entitlements.plist` 配置了 Hardened Runtime 权限：

| 权限 | 值 | 说明 |
|------|---|------|
| `com.apple.security.cs.allow-jit` | true | V8/Monaco 需要 JIT |
| `com.apple.security.cs.allow-unsigned-executable-memory` | true | V8/WebAssembly 需要 |
| `com.apple.security.cs.allow-dyld-environment-variables` | false | 发布时关闭 |
| `com.apple.security.get-task-allow` | false | 发布时禁止调试器附加 |
| `com.apple.security.network.client` | false | 不需要网络 |
| `com.apple.security.network.server` | false | 不需要网络 |
| `com.apple.security.files.user-selected.read-write` | true | 用户通过 dialog 选择的文件 |

### 构建脚本说明

| 脚本 | 用途 | 签名方式 |
|------|------|---------|
| `scripts/build-dev.sh` | 本机开发/测试 | ad-hoc |
| `scripts/build-signed.sh` | 正式分发 | Developer ID + 公证 |

### 故障排查

#### 证书未找到
```bash
# 查看所有代码签名证书
security find-identity -v -p codesigning

# 如果证书存在但无法使用，可能需要设置信任
# 钥匙串访问 → 证书 → 双击 → 信任 → 始终信任
```

#### 公证失败
```bash
# 查看公证状态
xcrun notarytool history --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"

# 查看详细日志
xcrun notarytool log <submission-id> --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
```

#### Gatekeeper 验证失败
- 公证完成后需要等待 5-10 分钟传播
- 使用 `xcrun stapler staple` 附加公证票据：
  ```bash
  xcrun stapler staple "RunCode.app"
  xcrun stapler staple "RunCode_0.1.2_aarch64.dmg"
  ```

## Windows 构建

### 开发构建（NSIS 安装包）

```powershell
./scripts/build-windows.ps1
```

脚本会自动：
1. 构建 Tauri NSIS 安装包（`pnpm tauri build`，会自动触发 `beforeBuildCommand: pnpm build`）
2. 输出产物路径和体积

TDM-GCC 已内置并提交到仓库（`src-tauri/resources/tdm-gcc/`），clone 后即用，无需额外准备。

产出：`src-tauri/target/release/bundle/nsis/RunCode_0.1.2_x64-setup.exe`

预估体积：~40 MB（NSIS LZMA 压缩后；TDM-GCC 原始资源约 280MB 压缩至 ~30MB + RunCode ~10MB）。安装后展开约 290 MB。

### WebView2 Runtime 说明

RunCode 依赖 WebView2 Runtime 渲染前端。安装包使用 `downloadBootstrapper` 模式，体积小但首次安装需联网下载 WebView2 Runtime（约 2MB）。

- **Windows 11 / Windows 10 较新版本**：系统预装，无需额外下载
- **全新机器 / 无 WebView2 的环境**：安装器会自动联网下载并安装
- **离线机房（无外网）**：需提前预装 WebView2 Runtime，下载地址 https://developer.microsoft.com/microsoft-edge/webview2/
  - 推荐机房管理员批量部署 `MicrosoftEdgeWebView2RuntimeInstallerX64.exe` 后再安装 RunCode
  - 如需完全离线安装包，可将 `src-tauri/tauri.conf.json` 中的 `webviewInstallMode.type` 改为 `embedBootstrapper`（会增加约 150MB 体积）或 `offlineInstaller`

### TDM-GCC 维护

- **当前版本**：TDM-GCC 10.3.0-2 (tdm64)
- **下载源**：https://github.com/jmeubank/tdm-gcc/releases
- **官方网站**：https://jmeubank.github.io/tdm-gcc/
- **升级流程**：修改 `scripts/prepare-tdm-gcc.ps1` 中的 `$tdmUrl` 和 `$tdmVersion`，执行该脚本重新生成 `src-tauri/resources/tdm-gcc/`，然后将更新后的目录提交到仓库
- **精简策略**：删 GDB、mingw32-make、Fortran、LTO、32 位库、文档/locale/man（精简后仍约 280MB，主要体积来自 mingw-w64 runtime 头文件与 libstdc++）

许可证：
- **GCC/binutils**：GPLv3+，见 [LICENSES/TDM-GCC-GPLv3.txt](./LICENSES/TDM-GCC-GPLv3.txt)
- **libstdc++**：GCC Runtime Library Exception（用户编译的程序不感染 GPL）
- **mingw-w64 runtime**：BSD/ZPL 等，见 [LICENSES/TDM-GCC-runtime.txt](./LICENSES/TDM-GCC-runtime.txt)

### Authenticode 签名（可选）

教学场景可不做。Windows SmartScreen 会显示警告，用户点「仍要运行」即可安装。

如需签名（消除 SmartScreen 警告）：
1. 购买 OV（组织验证）代码签名证书（约 $200/年）
2. 安装证书到本地证书存储
3. 用 `signtool.exe` 签名安装包：
   ```powershell
   signtool.exe sign /a /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 `
     "src-tauri/target/release/bundle/nsis/RunCode_0.1.2_x64-setup.exe"
   ```
4. 验证签名：
   ```powershell
   signtool.exe verify /pa /v "RunCode_0.1.2_x64-setup.exe"
   ```

> 注：2023 年 6 月起，新的 OV 证书需要 Hardware Root of Trust（USB token），EV 证书可直接 USB token。教学场景建议直接跳过签名。

## 多架构构建（未来扩展）

### macOS 通用二进制

当前仅构建 aarch64。如需 Intel 支持：

```bash
# 添加 x86_64 目标
rustup target add x86_64-apple-darwin

# 构建通用二进制
pnpm tauri build --target universal-apple-darwin
```

通用二进制会增加体积约 2x，但可在 Intel 和 Apple Silicon 上运行。

### Windows ARM64

TDM-GCC 暂不支持 ARM64。如需 ARM64 支持，可改用 LLVM MinGW（experimental）或微软 Visual Studio Build Tools。
