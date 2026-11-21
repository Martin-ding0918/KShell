# 构建与开发指南

## 环境要求

| 工具 | 版本 | 说明 |
|---|---|---|
| Node | ≥ 22（推荐 24） | npm 12 需要 Node ≥ 22（`engines` 已声明） |
| npm | ≥ 12 | `patchedDependencies` 需要（Node 20 自带的 npm 10 不支持） |
| JDK | 17–21 | gradle-plugin 子工程 toolchain 17；本机由 `D:\android-build\jdk17.0.21_0` 经 `JAVA_HOME` 提供 |
| Android SDK | API 36 + Build-Tools 36.0.0 | NDK 27.1（缺失时自动下载） |

## 常用命令

```bash
npm install                                  # 根目录：全部 workspace + npm patch
npx vitest run                               # core-shell 单元测试
cd apps/mobile/android && ./gradlew assembleDebug     # 调试包
cd apps/mobile/android && ./gradlew assemblePublicRelease # 发布包（JS 已内置，可独立运行）
cd apps/mobile && npm start                  # Metro（调试包热更新）
```

设置 `CHROME_PATH` 指向 Chrome 或 Chromium 后，可在仓库根目录运行
`node apps/mobile/__tests__/kimiTopbar.browser.mjs`，验证 Kimi 顶栏切换及窄屏布局。

公开版签名：`assemblePublicRelease` 必须提供 `ZS_STORE_FILE` 和 `ZS_STORE_PASSWORD`，
默认别名为 `kshell`。通过本机环境变量 `ORG_GRADLE_PROJECT_ZS_STORE_FILE`、
`ORG_GRADLE_PROJECT_ZS_STORE_PASSWORD` 传入，不把口令写进命令参数或仓库。
没有正式密钥时构建会失败，不回退到调试签名。后续升级必须继续使用相同的密钥。

当前仅构建公开版 `io.github.martinding0918.kshell`。正式包位于
`apps/mobile/android/app/build/outputs/apk/public/release/`，文件名为
`KShell-<版本>-arm64-v8a-publicRelease.apk`。

## 小米 17 真机调试（Windows + USB）

1. 在小米 17 开启「开发者选项」里的「USB 调试」，用数据线连接电脑。在手机上允许这台电脑调试。在仓库根目录运行 `adb devices -l`，确认手机状态为 `device`，并记下第一列序列号。如果显示 `unauthorized`，解锁手机并确认授权弹窗。
2. 准备一个 ARM64 调试 APK。可从 [Android Actions](https://github.com/Martin-ding0918/KShell/actions/workflows/android.yml) 成功运行的 **Artifacts** 下载 `kshell-arm64-debug-apk` 并解压。需要验证还未推送的原生改动时，在已安装依赖的仓库中用 PowerShell 本地构建。

   ```powershell
   Push-Location apps/mobile/android
   .\gradlew.bat assemblePublicDebug
   Pop-Location
   ```

   本地 APK 位于 `apps/mobile/android/app/build/outputs/apk/public/debug/`，文件名为 `KShell-<版本>-public-arm64-v8a-publicDebug.apk`。调试包使用独立包名 `io.github.martinding0918.kshell.debug`，可和正式版并排安装，配对和登录状态各自保存。
3. 在承载当前源码和依赖的 checkout 中启动 Metro，并保持终端运行。若使用本地盘构建副本，先把要测的改动同步过去，再从该副本启动 Metro。

   ```powershell
   Set-Location apps/mobile
   npm start
   ```

4. 在另一个 PowerShell 窗口安装并启动调试包。将下面的序列号和路径换成实测值；路径应指向解压后的 `.apk`。

   ```powershell
   $serial = '手机序列号'
   $apk = 'C:\path\to\KShell-debug.apk'
   adb -s $serial reverse tcp:8081 tcp:8081
   adb -s $serial install -r $apk
   adb -s $serial shell am start -n io.github.martinding0918.kshell.debug/com.zshell.MainActivity
   ```

5. 修改并保存 JS、TS 或 TSX，查看手机上的 Fast Refresh 结果。需要整页重载时，在 Metro 终端按 `r`。如果手机仍显示旧代码，先用 `adb -s $serial reverse --list` 检查 `tcp:8081` 转发，再重载并查看 Metro 是否收到打包请求。当前调试 APK 也内置构建时的 JS，能打开 App 这一点不足以确认已连上 Metro。换线或重连后可重新执行端口转发。改动 Kotlin、Java、Android 资源或原生依赖后，重新构建并覆盖安装调试 APK。

## 已知坑与解法（务必先读）

### monorepo 提升路径
依赖全部提升到根 `node_modules`，RN 模板的 `../node_modules` 相对路径假设失效。
相关配置**不要改回模板默认**：
- `android/settings.gradle`：gradle-plugin 提升路径解析
- `android/app/build.gradle` 的 `react{}`：reactNativeDir / codegenDir / cliFile
  （相对 `android/app` 解析，四级 `../` 到仓库根）与 **hermesc 全平台显式路径**
  （插件自动解析在提升布局下于 Windows 与 Linux 均失效）

### npm 补丁（foojay）
RN 0.82.1 自带 foojay-resolver 0.5.0 与 Gradle 9 不兼容（`IBM_SEMERU` 已移除），
通过根 `package.json` 的 `patchedDependencies` 移除。重装依赖后自检：

```bash
grep foojay node_modules/@react-native/gradle-plugin/settings.gradle.kts   # 应无结果
```
（CI 中此自检失败会直接终止构建。）

### Windows 260 字符路径限制
`.cxx` 构建对象路径在深目录 + 重 codegen 依赖下会超限
（`Filename longer than 260 characters`，先例：react-native-safe-area-context）。
**新增原生依赖前评估其 codegen 产物路径长度**；`core.longpaths=true` 只救 git，救不了 ninja。

### 国内网络
- 本机工具链与 Gradle 缓存集中在 `D:\android-build\`（`GRADLE_USER_HOME` 固定指向
  `D:\android-build\gradle`，C 盘 `~/.gradle` 已弃用）；机器相关，不进仓库——
  新机器按本节与仓库 AGENTS.md 的「构建环境备忘（本机）」重建
- Gradle 分发：`gradle-wrapper.properties` 已用腾讯镜像
- npm：仓库 lock 文件统一使用官方注册表地址（CI 与贡献者兼容）；
  本机可用 npmmirror，但**不要**把镜像地址提交进 lock

## CI（GitHub Actions）

`.github/workflows/android.yml` 在主分支推送或手动触发时运行 Vitest、移动端类型检查和 Jest。
三项通过后，工作流执行 `assemblePublicDebug`，校验 APK 只包含 `arm64-v8a` 原生库，再上传调试产物。正式签名和发布在本机完成，见 [发版流程](./release.md)。

## 代码规范速查

- 主题 token 一律取自 `apps/mobile/src/theme.ts`：样式用 `makeStyles((colors, font) => ({…}))`
  生成 hook，行内颜色用 `useTheme()`；浅 / 深两套调色板须同时补齐
- 屏幕组件单文件置于 `src/screens/`；导航用 App.tsx 栈状态
- core-shell 新增逻辑必须带 vitest 用例（含向量/边界）
- 法律文本双源：仓库 `docs/*.md` 与 `src/legal.ts` 同步（见发版检查单）
