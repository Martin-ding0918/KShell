# 发版流程

公开版在 KShell 发布，仅提供 `arm64-v8a` APK。私有自用版已停止构建和发布。

## 版本规范

- 公开版 APK 使用四段版本号。npm 工作区由脚本换算为等价 SemVer。
- 版本号**一律用脚本同步，勿手改**（发版检查单第 3 条）：

  ```bash
  node scripts/bump-version.mjs 0.0.1.11
  ```

  脚本一次写入：根 `package.json`、`apps/mobile/package.json`、
  `android/app/build.gradle`（versionName + versionCode，缺省 +1）、`src/version.ts`，
  并顺带同步 `package-lock.json` 头部两处 workspace 版本。
  正常升级应递增 `versionCode`，省略第二个参数即可自动加一。

## 发布步骤

1. 更新版本和 `CHANGELOG.md`，运行 `AGENTS.md` 发版检查单中的测试。
2. 按 [构建指南](./build.md) 加载正式签名，从 Android 目录运行 `./gradlew clean assemblePublicRelease`。
3. 在 `app/build/outputs/apk/public/release/` 核对只有一个 `KShell-<版本>-arm64-v8a-publicRelease.apk`。用 `aapt dump badging` 核对 `native-code: 'arm64-v8a'`、包名 `io.github.martinding0918.kshell` 和内部版本。用 `apksigner verify --print-certs` 核对正式签名，再生成该 APK 的 SHA-256。
4. 在实机安装上一步校验过的 APK，完成下方控制台冒烟和 `AGENTS.md` 的其余检查项。
5. 将源码提交到 fork 的 `main`。在 [KShell Releases](https://github.com/Martin-ding0918/KShell/releases) 创建指向该源码提交的 `v<版本>`，上传该 ARM64 APK 和对应 SHA-256 校验文件。

CI 可以构建和校验 ARM64 产物，GitHub Release 仍手动发布。
0.0.1.11 及更旧的公开 APK 内置 KShell-public 更新地址。用新地址构建的首个正式版还需将同一签名 APK 同步到 KShell-public，作为旧版的过渡更新，不能只改文档或删除旧仓库。

## 控制台实机冒烟

使用开启深色模式和手势导航的 Android 实机，准备已配对、已登录且在线的 Kimi Code 和 ZCode 桌面端，各选一个已有会话。两个控制台分别执行以下步骤。

1. 强制停止 KShell 并重新打开，从「我的机器」进入控制台。如果先看到任务列表，打开准备好的会话。检查加载过程无整页白屏，会话可见且状态为「已连接」。
2. 打开连接状态菜单，点「重新加载」。等会话恢复到「已连接」后重复一次。两次都检查加载遮罩能消失，会话可操作。
3. 从系统手势回桌面，等待约 5 秒后重新打开 KShell。检查能回到原会话并恢复可用。如果启用了应用锁，先按正常流程解锁。
4. 从当前会话侧滑返回。网页有历史时可以先返回上一条真实网页记录。从控制台入口再侧滑一次应回到「我的机器」，中途不应出现空白中间页。

记录验收包版本和 SHA-256、手机型号、Android 与系统 WebView 版本，以及两个控制台各自的结果。

## Release 说明规范

- 标题使用标签名，例如 `v0.0.1.11`。
- 正文使用 CHANGELOG 对应版本段落。
- 面向用户的表述：写「解决了什么问题」而非「改了哪个文件」
- 破坏性变更（存储格式、配对方式变化）必须置顶加粗说明

## 回滚

- 代码回滚：revert 提交后按正常流程发新版本（不发递减版本号）
- 仅需撤 Release：GitHub 网页删除 Release 与标签（APK 产物随之失效）
