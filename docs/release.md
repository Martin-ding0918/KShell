# 发版流程

只发布 KShell-public 的 `arm64-v8a` APK。私有自用版已停止构建和发布。

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

1. 更新版本和 `CHANGELOG.md`，完成 `AGENTS.md` 的发版检查单。
2. 按 [构建指南](./build.md) 加载正式签名，从 Android 目录运行 `./gradlew clean assemblePublicRelease`。
3. 在 `app/build/outputs/apk/public/release/` 核对只有一个 `KShell-<版本>-arm64-v8a-publicRelease.apk`。用 `aapt dump badging` 核对 `native-code: 'arm64-v8a'`、包名 `io.github.martinding0918.kshell` 和内部版本。用 `apksigner verify --print-certs` 核对正式签名，再生成该 APK 的 SHA-256。
4. 将源码提交到 fork 的 `main`。在 [KShell-public Releases](https://github.com/Martin-ding0918/KShell-public/releases) 创建 `v<版本>`，上传该 ARM64 APK 和对应 SHA-256 校验文件。

源码 fork 的 CI 可以构建和校验 ARM64 产物。GitHub Release 由 KShell-public 仓库手动发布。

## Release 说明规范

- 标题使用标签名，例如 `v0.0.1.11`。
- 正文使用 CHANGELOG 对应版本段落。
- 面向用户的表述：写「解决了什么问题」而非「改了哪个文件」
- 破坏性变更（存储格式、配对方式变化）必须置顶加粗说明

## 回滚

- 代码回滚：revert 提交后按正常流程发新版本（不发递减版本号）
- 仅需撤 Release：GitHub 网页删除 Release 与标签（APK 产物随之失效）
