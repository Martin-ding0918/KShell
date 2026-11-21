# 架构设计

> 本文描述 KShell 的代码组织与核心设计决策。面向贡献者与 AI 代理，配合根目录 [AGENTS.md](../AGENTS.md) 使用。

## 总体结构

```
KShell/                            # npm workspaces monorepo
├── packages/
│   ├── core-shell/              # 零框架依赖的纯 TS 核心
│   └── patch-bundle/            # 注入官方页面的行为补丁
├── apps/
│   └── mobile/                  # React Native 应用（仅 Android）
└── patches/                     # npm patchedDependencies 补丁
```

## 核心设计决策

### 1. core-shell 零框架依赖 + 严格 TS 子集

全部业务逻辑（配对 URL 解析、endpoint 双线选择、状态机、机器注册表、应用锁模型、
SHA-256/HMAC/PBKDF2/Base64）放在 `packages/core-shell`，**不 import 任何框架**，
并以严格 TS 子集编写（无 `any`、类型显式）——**逻辑单源**。

配套约束：平台能力一律通过端口接口注入（`src/ports.ts`）：

| 端口 | Android 实现（当前） |
|---|---|
| `SecureKvStore` | MMKV withEncryption（Keystore 托管密钥） |
| `BiometricAuth` | react-native-biometrics |

### 2. 壳路线：官方页面是产品主体

KShell 的 WebView 加载官方远程控制台——Kimi Code（`code-rc.kimi.com/devices/<id>/`）
与 ZCode（`zcode.z.ai|zcode.chatglm.site/remote/v3|v4`，relay v2 配对）——
中继连接、配对或账号登录、会话桥全部由官方页面自身完成。壳的增值全部在页面之外：
加密凭据管理、多机管理、应用锁、本地通知、移动端缺陷补丁。

### 3. patch-bundle 自防护纪律

注入官方页面的补丁（`injectedJavaScriptBeforeContentLoaded`，document-start 时机）
必须满足三条纪律，否则随官方改版碎裂：

1. **全包裹 try/catch + 重入标志**（`__zshellPatchApplied`）——补丁永不弄崩页面；
2. **环境探针自退役**——环境本身正常时补丁自动失效（如 matchMedia 已正确上报）；
3. **只针对精确字符串**——影响面收敛到单一检测点，不做大范围覆盖。

补丁以 JS 字符串形式导出（`packages/patch-bundle`），与宿主框架无关，`buildPatchSource()`
全量拼接后统一注入。当前补丁：P-1 matchMedia 移动端输入判定、P-2 relay WebSocket
只读观察器（Kimi 远程控制隧道走 `wss://code-rc.kimi.com|ai`，ZCode relay 走
`zcode.z.ai|zcode.chatglm.site` 或带 `/ws` 的 socket）、P-3
`AbortSignal.any` polyfill（Kimi Code 登录依赖它，模拟器/容器常见的旧版系统 WebView
没有）、P-4 `Promise.withResolvers` polyfill（旧 WebView 缺失时会话与工作区列表
打不开）。P-3/P-4 在环境已原生支持时自动不注入。

`apps/mobile/src/kimiTopbar.ts` 与 `apps/mobile/src/zcodeTopbar.ts` 是按宿主注入的
**样式补丁**（不在 patch-bundle 里，因为它们依赖宿主桥的消息名）。
kimiTopbar 将 Kimi 窄屏页头缩为 48px 单行，胶囊紧跟标题，设置按钮靠右。
zcodeTopbar 把 ZCode 会话页原本的四条栏（原生壳条 + 网页 mobile 头部 + 工作区头部）
合并为一条 48px 单行：`‹网页返回 | 会话标题 | ●连接胶囊 | 侧栏`，连接胶囊是唯一
菜单入口（断线时直接变「重连」）；锚点只用稳定属性（`data-mobile-page`、
`data-testid`），原按钮保留原处理器仅改 flex order，工作区头部行收缩为零高隐形盒
（Radix 弹层仍可从胶囊菜单转发触发）。
所需锚点缺失时，补丁恢复网页原布局并上报 `header-off`。ZCode 加载失败时显示原生状态条。在会话页和任务列表之外，断线或会话被顶下线时也会显示原生状态条。
两个补丁共用 `apps/mobile/src/topbarActivity.ts`。控制台可见时，DOM 观察器、SPA 路由回调和每 1.2 秒的兜底扫描共同维护顶栏。退回列表、打开下载管理、锁定应用或切后台时，壳通知隐藏的页面断开 DOM 观察器并停止定时扫描。再次显示时立即补扫，同时恢复观察和兜底扫描。

ZCode 支持于 0.0.1.8 移除、0.0.1.12 恢复：配对（扫码/手动链接/备份恢复）与控制台
回到 core-shell 既有逻辑，入口策略闸门在 `apps/mobile/src/storage.ts` 的
`acceptsCredentials`（官方 Kimi 设备页 + 官方 ZCode 来源，DSH 仍不接受）。
Kimi Code 的账号登录由官方页面在壳内覆盖层完成，登录态（Cookie）由系统 WebView
保管、可在设置一键清除；ZCode 的账号登录由页面自身完成。

### 4. 自管理导航栈 + 系统返回优先级

App.tsx 用栈状态自管理导航（未引入 react-navigation，保持依赖精简）。系统返回键
（BackHandler）的优先级：**控制台页 → 网页自身历史（WebView goBack）→ 应用栈
逐级返回 → 根页面默认退出**。

`App.tsx` 最多保留三台最近使用的控制台。返回列表时隐藏 WebView，重新打开时可复用仍在运行的会话。只有应用在前台且对应控制台可见时，`ConsoleScreen` 才自动恢复连接已断开、加载失败或渲染进程已退出的会话。隐藏的渲染进程退出后会移除失效的 WebView，等该控制台再次可见再重建。仍在线的隐藏会话继续监听中继事件并按用户设置发送本地通知。

下载列表打开、从后台回来或完成一次管理操作后会立即查询系统下载记录。只有下载列表可见且有未完成任务时，才继续每约 1.5 秒查询一次。实际下载由 Android DownloadManager 执行。

### 5. 边到边适配策略

容器（卓易通）与 Android 15+ 会强制 edge-to-edge，且 `adjustResize` 随之失效。
统一解法在 MainActivity：把系统栏 + 刘海 + IME 的 inset 全部转为根视图内边距
（普通设备 insets 已被 decor 消费，天然无副作用），并把窗口背景设为应用背景色
（`values` / `values-night` 两套），避免让出的区域露出默认白底。

### 6. 深色模式

外观偏好（跟随系统 / 浅色 / 深色）存于原生 SharedPreferences，经
`AppCompatDelegate.setDefaultNightMode` 生效：冷启动在 `MainApplication.onCreate`
即应用，首帧窗口色就正确，系统对话框也随之切换。Manifest 声明了 `uiMode`
配置变更，切换不重建 Activity（保活中的控制台不受影响），由
`MainActivity.onConfigurationChanged` 重新取窗口 / 系统栏颜色与图标明暗。
JS 侧 `ThemeProvider` 按偏好或 `useColorScheme()` 选调色板，样式用
`makeStyles` 按方案缓存生成。

控制台直接导航到目标页面，等待时由 React Native 遮罩覆盖 WebView。网页探针优先等到首次内容绘制（FCP），在信号不可用时使用双 `requestAnimationFrame`，然后上报 `zshell:first-paint`。`patches/rn-webview-kshell.patch` 对官方 HTTPS 控制台的这条消息等待 Android WebView 的 `postVisualStateCallback` 及后续绘制帧，再转发给 React Native 撤下遮罩。15 秒内收不到信号时显示超时页，用户可以重试、返回列表或复制本次诊断摘要。

