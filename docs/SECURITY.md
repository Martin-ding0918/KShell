# 安全说明（Security）

## 报告漏洞

请勿在公开 Issue 中提交安全漏洞细节。请通过 GitHub 仓库的 **Security Advisories（Report a vulnerability）** 提交，或联系维护者。我们会在确认后尽快修复并在致谢中感谢报告者（如你愿意）。

## 安全模型

### 凭据存储与隐私窗口

- 配对凭据（`sid` + `hash`）通过 MMKV **AES 加密**存储，加密密钥由 **Android Keystore** 托管（不落明文文件）；启用应用锁时，冷启动在解锁通过前不加载解密后的机器列表；
- 应用锁（指纹 / 人脸 / 图案 / 密码）在应用打开、后台恢复以及设置页变更/关闭解锁方式时强制验证；验证器采用 PBKDF2-HMAC-SHA256（随机盐 + 新设置 100,000 次迭代 + 常数时间比较，兼容既有验证器）并实施失败退避冷却；
- 锁屏与配对备份敏感界面强制启用 `FLAG_SECURE`，锁屏时立即关闭所有弹窗并清空内存中的备份密文与口令；
- 加密备份（ZSBK2）采用 PBKDF2-HMAC-SHA256（600,000 次迭代）+ Encrypt-then-MAC + 严格 canonical Base64 校验；
- Manifest 显式禁用 Android 云备份与 Android 12+ 设备间换机数据迁移（`allowBackup="false"`、`fullBackupContent="false"`、`dataExtractionRules` 全域排除）。

### 信任边界（使用者须知）

1. **配对 URL 即长期凭据**：拿到配对链接的任何人都能连接你的桌面端。请勿在不受信任的渠道传播；建议定期在桌面端执行凭据轮换（轮换后在本应用重新扫码即可，机器记录会自动合并）。
2. **中继链路**：远程会话经官方中继服务传输，本软件不新增暴露面，也无法提供端到端加密。敏感代码库慎用远程控制。
3. **HTTPS、WebView 隔离与更新校验**：
   - 控制台 WebView 仅允许访问官方 HTTPS 域名——Kimi Code（`code-rc.kimi.com`、`code-rc.kimi.ai` 及 `auth.kimi.com` 覆盖层授权页）与 ZCode（`zcode.z.ai`、`zcode.chatglm.site` 及对应官方登录域），拒绝非 HTTPS 协议与非白名单第三方子框架，非白名单顶层 HTTPS 外链交由系统浏览器打开；
   - 原生桥接消息仅接受官方控制台 HTTPS 主框架（`WebMessageListener` + `isMainFrame` + Origin 校验），不支持 `WebMessageListener` 的旧版 WebView 禁用无法核验发送方框架的 `JavascriptInterface` 回退桥；
   - 应用内更新仅从 GitHub Releases（`https://github.com/Martin-ding0918/KShell/releases/download/...`）下载，安装前在本地校验包名、签名证书与当前应用一致（以及官方发布的 SHA-256 摘要，如有）。
4. **第三方客户端的固有风险**：官方服务端可能随时收紧校验或变更协议，本软件可能因此部分失效。

### 已知限制（当前版本）

- 应用锁的图案秘密空间较小（3×3 点序），已用 PBKDF2 抬高离线爆破成本，但物理接触设备者仍可尝试——更高安全需求请使用密码锁或生物识别；
- WebView 内运行的是官方网页，其自身的安全更新由官方负责。

## 漏洞披露政策

- 收到报告后 72 小时内确认；
- 修复后按严重程度决定是否发布安全公告；
- 我们不会对善意报告漏洞的研究者采取法律行动。
