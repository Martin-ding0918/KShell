/**
 * In-app legal documents for the settings "法律与关于" section and the
 * first-launch consent gate.
 *
 * KEEP IN SYNC: docs/DISCLAIMER.md and docs/PRIVACY.md in the repository are
 * source of truth — when they change, bump LEGAL_DOC_VERSION and mirror
 * the substance here (see AGENTS.md release checklist).
 */

export interface LegalDoc {
  title: string;
  body: string;
}

/** Bump to re-prompt consent after material legal changes. */
export const LEGAL_DOC_VERSION = 10;

export const USER_AGREEMENT: LegalDoc = {
  title: '用户协议与免责声明',
  body: `最后更新：2026-11-25 · 适用版本：KShell v0.0.1.28

一、非官方声明
KShell 是一个非官方、未经授权的开源第三方客户端，与 Kimi、Moonshot AI、ZCode、智谱及其关联公司不存在任何隶属、代理、合作、赞助或认可关系。“Kimi”“ZCode”及相关商标归其各自权利人所有，这些名称仅用于描述互操作对象。

二、使用前提
1. 本应用不提供、不代理、不转售任何模型服务或计算资源；
2. 使用本应用需你本人合法使用 Kimi Code 或 ZCode 的远程控制功能。Kimi Code 的可用性由官方决定，ZCode 需使用与桌面端一致的账号；
3. 你应遵守各官方服务条款及所在辖区法律法规。未经授权连接或控制他人计算机属违法行为，本应用仅用于连接使用者本人的设备。

三、互操作性质
本应用为实现互操作，对配对链接格式与网页控制台行为进行了观察与描述：不包含、不分发任何官方受版权保护的源代码；不实施任何绕过鉴权或破解行为；所有连接均使用你本人的合法配对凭据或账号，经官方正常服务链路完成。

四、服务依赖与可用性
本应用依赖官方中继服务与网页控制台。官方可能随时变更协议、收紧校验或停止服务，届时本应用部分或全部功能可能失效，本应用不承担因此产生的责任。

五、安全须知
1. Kimi Code 的配对链接包含设备标识与来源参数，ZCode 新版链接包含中继会话标识，旧版链接可能包含配对凭据。账号登录由官方页面处理，Cookie 由系统 WebView 保管。本应用加密保存配对信息，提供应用锁及清除网页登录数据的功能。请勿转发配对链接；
2. 远程会话内容经官方中继传输，其可见性由官方服务的安全设计决定，本应用不新增额外暴露面，也无法提供端到端加密。处理高度敏感代码库请谨慎评估。

六、免责与担保
本应用按"现状"与"现有"基础提供，不附带任何明示或默示担保。因使用本应用造成的任何直接或间接损失（包括数据丢失、业务中断等），作者不承担责任。

七、法律适用
本协议的解释与争议解决适用中华人民共和国法律。若官方服务条款限制第三方客户端接入，你应停止使用或仅作个人学习研究之用。本项目以 MIT 许可证开源分发。`,
};

export const PRIVACY_POLICY: LegalDoc = {
  title: '隐私政策',
  body: `最后更新：2026-11-25 · 适用版本：KShell v0.0.1.28

KShell 的隐私设计只有一条原则：零收集。本应用没有自建服务器、没有账号体系、没有崩溃收集 SDK、没有广告和分析组件。所有功能均在你本人的设备上完成。

一、我们收集哪些个人信息
无。本应用不向开发者或任何第三方传输、上报任何个人信息或使用数据。

二、本地存储的数据（永不离开你的设备）
1. 机器列表：保存已配对桌面端的名称、地址、配对信息、收藏和排序。配对信息包括 Kimi Code 设备标识与来源参数、ZCode 中继会话标识或旧版配对凭据。使用 AES 加密存储（MMKV），密钥由 Android Keystore 托管；
2. 应用锁与偏好设置：锁定方式、PBKDF2 验证器（盐 + 哈希）、失败次数及等待时间、通知/更新/登录保留偏好及法律同意记录（同上加密存储）；
3. 连接诊断与本地缓存：最近 200 条不含凭据的连接事件保存在本机非加密诊断存储，下载任务元数据与外观/遮罩偏好保存在应用私有 SharedPreferences；失败或超时时，你可以主动复制当次连接的耗时、状态和错误码摘要；
4. 网页登录数据：Kimi Code 和 ZCode 的 Cookie 与站点数据由系统 WebView 保管，默认跨重启保留，可在设置中关闭或一键清除（同时卸载在线控制台）；
5. 你导出的配对备份由你设置的口令加密，应用不保存口令、也无法解密丢失口令的备份；
6. 应用已禁用系统云备份与 Android 12+ 换机数据迁移。卸载应用或清除应用数据会移除应用内部数据，公共下载文件及已导出的备份文件由你管理。

三、权限用途
1. 相机：仅用于扫描配对二维码，不拍照、不录像、不保存图像；
2. 生物识别：仅调用系统本机验证完成应用锁解锁，不接触、不存储生物特征数据；
3. 照片：仅在你主动选择「从相册识别二维码」时读取所选单张图片，识别完成即丢弃；
4. 网络：使用官方 HTTPS 域名（code-rc.kimi.com、code-rc.kimi.ai、auth.kimi.com、zcode.z.ai、zcode.chatglm.site 等官方控制台与登录域）打开控制台，登录由官方页面处理。KShell 通过 GitHub Releases 检查并下载自身更新，可在设置关闭自动检查。系统 DownloadManager 将更新包保存到应用专用目录，将控制台内主动选取的下载保存到公共下载目录；
5. 通知：由设备本机发出断线、会话被其他设备接管、等待批准、版本更新及下载暂停/超时取消提醒，可在设置中关闭或配置免打扰时段；
6. 安装应用：下载完成后先校验安装包包名、签名证书（及官方 SHA-256 摘要，如有），通过后交由系统安装器安装更新；需要你在系统里授予「来自此来源的应用安装」权限，安装与否始终由你确认。

四、第三方组件
以下开源组件均为本地功能实现，不进行任何数据上报：react-native / react-native-webview（应用框架与控制台容器）、react-native-camera-kit / ZXing（相机取景和本地扫码，已移除闭源 GMS / MLKit 依赖）、react-native-image-picker（相册选图）、react-native-mmkv-storage（加密存储）、react-native-biometrics（系统生物识别）、jsQR / jpeg-js / pako（本地二维码图片识别）。

五、数据安全
配对凭据 AES 加密存储、密钥托管于 Android Keystore，启用应用锁时在解锁完成前不加载机器列表；应用锁（生物识别/图案/密码）防止他人查看或使用，锁屏与备份敏感界面禁止截屏录屏；凭据校验采用 PBKDF2-HMAC-SHA256（新设置默认 100,000 次迭代 + 随机盐 + 常数时间比较，兼容既有验证器）并带失败退避冷却。请知悉：远程会话内容经官方中继服务传输，该环节不在本应用控制范围内（见《用户协议与免责声明》第五条）。

六、未成年人
本应用面向开发者群体，不建议未成年人使用。

七、政策变更
政策如有重大变更将随版本发布更新；继续使用即表示接受更新后的政策。行使个人信息权利或对本政策有疑问，请通过仓库 Issue 或安全渠道联系。`,
};

export const OSS_LICENSES: LegalDoc = {
  title: '开源许可',
  body: `KShell 本体以 MIT 许可证开源分发（© 2026 ZShell Contributors），完整文本见仓库 LICENSE 文件。

本应用使用的主要开源组件及其许可证：
· react-native / react —— MIT License
· react-native-webview —— MIT License
· react-native-camera-kit —— MIT License
· ZXing —— Apache License 2.0
· react-native-image-picker —— MIT License
· react-native-mmkv-storage（内含 Tencent MMKV）—— MIT License
· react-native-biometrics —— MIT License
· jsQR —— Apache License 2.0
· jpeg-js —— BSD 3-Clause License
· pako —— MIT AND Zlib License

以上组件的完整许可证文本可在其各自仓库获取。所有组件仅用于本地功能实现，不改变本应用的零数据收集承诺。`,
};
