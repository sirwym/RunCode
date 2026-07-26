# macOS 签名与公证配置指南

本文档说明如何为 C++ 教学编辑器配置 Developer ID 签名和 Apple 公证，实现正式分发。

## 当前状态

- **签名方式**：ad-hoc（`signingIdentity: "-"`）
- **Hardened Runtime**：已启用（`entitlements.plist`）
- **首次启动**：需右键 → 打开以绕过 Gatekeeper
- **正式分发**：❌ 未配置（需要 Apple Developer 账号）

## 升级到正式签名

### 1. 申请 Apple Developer 账号

1. 访问 https://developer.apple.com/programs/
2. 注册 Apple Developer Program（$99/年）
3. 完成身份验证

### 2. 创建 Developer ID 证书

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

### 3. 获取公证所需信息

| 环境变量 | 说明 | 获取方式 |
|---------|------|---------|
| `APPLE_SIGNING_IDENTITY` | 证书名称 | `security find-identity -v -p codesigning` 输出 |
| `APPLE_ID` | Apple ID 邮箱 | 注册时使用的邮箱 |
| `APPLE_PASSWORD` | app-specific 密码 | https://appleid.apple.com → 登录 → 应用专用密码 → 生成 |
| `APPLE_TEAM_ID` | Team ID | https://developer.apple.com/account → Membership Details |

### 4. 配置环境变量

在 `~/.zshrc` 或 `~/.bash_profile` 中添加：

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (XXXXXXXXXX)"
export APPLE_ID="your@email.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

> ⚠️ 不要将这些凭据提交到版本控制。建议使用 macOS 钥匙串或环境变量管理工具。

### 5. 执行正式构建

```bash
./scripts/build-signed.sh
```

脚本会自动：
1. 检查环境变量
2. 验证证书存在
3. 临时替换 `tauri.conf.json` 的 `signingIdentity`
4. 执行 `pnpm tauri build`（Tauri 2 内置公证）
5. 验证 Gatekeeper 和 Stapler

### 6. 验证分发

```bash
# Gatekeeper 验证
spctl --assess --type install --verbose "CppTeach_0.1.0_aarch64.dmg"

# Stapler 验证
xcrun stapler validate "CppTeach_0.1.0_aarch64.dmg"
```

通过后，用户可双击 DMG 直接安装，无需右键打开。

## Entitlements 说明

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

## 构建脚本说明

| 脚本 | 用途 | 签名方式 |
|------|------|---------|
| `scripts/build-dev.sh` | 本机开发/测试 | ad-hoc |
| `scripts/build-signed.sh` | 正式分发 | Developer ID + 公证 |

## 故障排查

### 证书未找到
```bash
# 查看所有代码签名证书
security find-identity -v -p codesigning

# 如果证书存在但无法使用，可能需要设置信任
# 钥匙串访问 → 证书 → 双击 → 信任 → 始终信任
```

### 公证失败
```bash
# 查看公证状态
xcrun notarytool history --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"

# 查看详细日志
xcrun notarytool log <submission-id> --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
```

### Gatekeeper 验证失败
- 公证完成后需要等待 5-10 分钟传播
- 使用 `xcrun stapler staple` 附加公证票据：
  ```bash
  xcrun stapler staple "CppTeach.app"
  xcrun stapler staple "CppTeach_0.1.0_aarch64.dmg"
  ```

## 多架构构建（未来扩展）

当前仅构建 aarch64。如需 Intel 支持：

```bash
# 添加 x86_64 目标
rustup target add x86_64-apple-darwin

# 构建通用二进制
pnpm tauri build --target universal-apple-darwin
```

通用二进制会增加体积约 2x，但可在 Intel 和 Apple Silicon 上运行。
