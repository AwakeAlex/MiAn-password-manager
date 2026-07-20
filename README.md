# 密安密码本（Mian Password Manager）

一个基于 **Web Crypto API** 和 **IndexedDB** 的纯本地密码管理器。所有数据均在本地加密、本地存储，**不联网、不上传、不上云**。支持手机浏览器、PWA 安装以及 Android APK 安装。

> 本仓库为有限开源版本：核心加密逻辑、UI 源码和构建流程均开放，方便社区审计；签名证书、构建产物等敏感/本地文件已排除。

---

## 安全声明

- **纯本地运行**：没有任何后端服务器，不会收集、上传或同步用户数据。
- **本地加密**：主密码通过 PBKDF2（60 万次迭代）派生密钥，使用 AES-256-GCM 加密每条记录。
- **密钥派生分离**：主密钥经 HKDF 扩展后分别用于验证和数据库加密，降低泄露风险。
- **开源可审计**：核心代码完全开放，欢迎安全爱好者审查并提出改进建议。
- **数据归属用户**：所有数据保存在你的浏览器或设备本地，卸载或清除数据即丢失，请定期导出备份。

---

## 已实现功能

- **本地加密保险库**：PBKDF2 + AES-256-GCM，主密码是解密的唯一钥匙。
- **登录安全锁定**：连续输错 5 次锁定 30 秒、10 次锁定 5 分钟、15 次永久锁定（需重置保险库）。
- **跨平台 PWA**：可安装到手机主屏和桌面，支持离线使用。
- **密码管理**：新增、编辑、删除、搜索、收藏密码记录。
- **密码生成器**：随机密码、助记密码、PIN 三种模式。
- **导入/导出**：导出加密备份 JSON，可在同设备或不同设备导入。
- **修改主密码**：可更换主密码并重新加密所有记录。
- **安全声明页面**：在设置中查看应用的隐私与安全说明。
- **重置保险库**：一键清空本地数据。

---

## 目录结构

```
V1-0-1/
├── index.html                # 应用入口（PWA / Capacitor）
├── app.js                    # 业务逻辑：加密、数据库、UI、锁定策略
├── styles.css                # 移动端优先样式
├── manifest.json             # PWA 配置
├── icon.svg                  # 应用图标
├── sw.js                     # Service Worker（离线缓存）
├── server.js                 # 本地开发服务器
├── build-local.js            # 构建单文件 HTML 脚本
├── capacitor.config.json     # Capacitor 配置
├── android/                  # Android 原生工程
│   ├── app/                  # Android 应用源码
│   ├── build.gradle
│   └── ...
├── 使用说明.md                # 用户操作说明
└── dist/                     # 构建产物（被 .gitignore 排除）
```

---

## 快速开始

### 1. 直接运行网页版（开发调试）

```powershell
cd "d:\AI 项目\密安\V1-0-1"
node server.js
```

然后访问 http://localhost:5173

### 2. 构建单文件 HTML（可离线分发）

```powershell
cd "d:\AI 项目\密安\V1-0-1"
node build-local.js
```

产物位于 `dist/mian-password-local.html`，单个文件可直接用浏览器打开。

### 3. 构建 Android APK

需要配置好 Java 21、Android SDK、Gradle，然后运行：

```powershell
cd "d:\AI 项目\密安\V1-0-1\android"
.\gradlew.bat assembleDebug
```

构建完成后 APK 位于：

```
android/app/build/outputs/apk/debug/app-debug.apk
```

> 注意：项目已排除 `android/local.properties`，首次构建前请在该文件中配置你的本地 Android SDK 路径。

---

## 使用说明

详见 [`使用说明.md`](./使用说明.md)。

---

## 技术栈

- 原生 HTML5 / CSS3 / JavaScript（无前端框架依赖）
- Web Crypto API（PBKDF2、AES-GCM、HMAC、SHA-256）
- IndexedDB（本地数据库）
- Service Worker（PWA 离线支持）
- Capacitor（Android 原生包装壳）

---

## 贡献

欢迎提交 Issue 和 Pull Request，特别是：

- 安全审计与加密逻辑改进
- 密码强度分析
- 导入/导出格式增强
- 无障碍与多语言支持
- Bug 修复

---

## 许可证

本项目采用 [MIT License](./LICENSE) 开源。

---

## 免责声明

本软件按"原样"提供，作者不对因使用本软件导致的任何数据丢失或安全事件承担责任。请务定期导出加密备份，并妥善保管主密码。

---

## 后续优化方向

1. 增加生物识别解锁（WebAuthn / 系统凭据 API）。
2. 增加密码强度审计（重复、弱密码检测）。
3. 增加分类管理和自定义字段。
4. 增加加密云同步（WebDAV / 用户自选存储）。
5. 增加系统级自动填充（Android Autofill / iOS Password AutoFill）。
