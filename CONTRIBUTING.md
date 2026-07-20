# 贡献指南

感谢你对密安密码本的关注！欢迎任何形式的贡献。

## 报告安全漏洞

如果你发现安全漏洞，**请不要在公开 Issue 中报告**。请通过以下方式私下联系：

- 将漏洞细节发送到 Issues 面板，选择「Security Advisory」
- 或直接联系项目维护者

我们会在 48 小时内确认并回复。

## 如何贡献

### 报告 Bug

1. 在 [Issues](https://github.com/AwakeAlex/MiAn-password-manager/issues) 页面搜索是否已有相同问题。
2. 如果没有，创建新 Issue，请包含：
   - 浏览器 / Android 版本
   - 复现步骤
   - 预期行为与实际行为
   - 如可能，附上截图或控制台报错

### 提交 Pull Request

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/你的功能名`
3. 提交代码：`git commit -m "feat: 你的功能描述"`
4. 推送到你的 Fork：`git push origin feat/你的功能名`
5. 在 GitHub 上创建 Pull Request

### 代码风格

- 使用 2 空格缩进
- 变量和函数名使用驼峰命名（camelCase）
- 添加必要的注释，特别是加密逻辑部分
- 保持前端零依赖原则（不使用 npm 框架库）

### 提交信息规范

推荐使用约定式提交格式：

- `feat: 添加密码强度审计功能`
- `fix: 修复导入时盐值丢失问题`
- `docs: 更新 README 安全说明`
- `refactor: 优化密钥派生逻辑`

### 本地开发

```bash
# 启动开发服务器
node server.js
# 访问 http://localhost:5173
```

所有修改会热更新，无需重新构建。

## 审核流程

所有 PR 需要经过以下检查：

- 不引入外部依赖（NPM 包）
- 加密逻辑需有清晰注释
- 不影响现有安全机制

感谢你的贡献！
