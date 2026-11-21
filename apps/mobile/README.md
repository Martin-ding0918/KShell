# KShell Mobile（apps/mobile）

Kimi Code 和 ZCode 远程控制手机壳的 React Native Android 应用。项目总览与合规文档见[仓库根 README](../../README.md)。

## 常用命令

```bash
npm start                 # 启动 Metro（在本目录）
npm run android           # 构建并安装到已连接的 Android 设备/模拟器
npm test                  # 应用层 jest 测试
npm run typecheck         # TypeScript 类型检查

# 手动构建 APK
cd android && ./gradlew assemblePublicDebug
# APK 位于 apps/mobile/android/app/build/outputs/apk/public/debug/
```

## 结构

- `App.tsx` 管理导航栈、应用锁、机器列表及控制台是否可见。
- `src/screens/` 包含配对、控制台、下载管理、连接诊断及设置等界面。
- `src/topbarActivity.ts` 管理两个控制台顶栏的观察和扫描，在界面再次可见时恢复。
- `src/storage.ts` — MMKV 加密存储适配器（实现 core-shell 的 `SecureKvStore` 端口）
- `src/biometric.ts` — 生物识别适配器（实现 `BiometricAuth` 端口）
- `src/qrFromFile.ts` + `src/PngDecoder.ts` — 相册二维码截图识别（纯 JS）
- `src/PatternPad.tsx` — 图案锁组件

开发约束与构建环境备忘见 [AGENTS.md](../../AGENTS.md)。控制台保活、首帧绘制和下载管理见[架构设计](../../docs/architecture.md)。
