# 参与贡献

感谢你愿意改进 Domain Buddy。项目仍在早期阶段，提交应尽量聚焦、可验证，并优先保护用户凭证和 DNS 数据安全。

## 开始之前

- 普通 Bug 和功能建议请使用对应的 GitHub Issue 模板。
- 安全漏洞不要公开提交，按照 [SECURITY.md](SECURITY.md) 私密报告。
- 较大的功能、供应商接入或架构调整，建议先创建 Issue 对齐范围。
- 参与社区互动即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 开发环境

请先安装 Node.js 22、npm 10、Rust stable，以及当前平台所需的 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/Leochens/domain-buddy.git
cd domain-buddy
npm ci
npm run tauri dev
```

## 开发约定

- React 界面代码位于 `src/`，Tauri / Rust 代码位于 `src-tauri/src/`。
- 供应商特有的签名、请求和响应转换应放在独立适配模块，避免继续放大共享文件。
- 不要在源码、测试、日志、截图或 Issue 中写入真实密钥、账号 ID、内部 Endpoint、域名或解析记录。
- 新增网络请求时只使用供应商官方 HTTPS Endpoint，并校验所有来自界面的输入。
- 新增凭证字段时必须接入操作系统凭证库，不能把密钥写入普通 JSON、日志或前端持久化存储。
- 使用模拟数据或专用测试账号验证危险操作；默认不要对生产域名执行增删改。
- 提交信息应简洁并表达一个完整改动，例如 `feat: 支持新的 DNS 供应商`、`fix: 修复记录状态同步`。

## 提交前检查

```bash
npm run check
```

如果修改了桌面打包或 Tauri 配置，还应在目标操作系统运行：

```bash
npm run tauri build
```

涉及界面的改动请附脱敏截图；涉及 DNS 行为的改动请说明验证供应商、记录类型和失败场景。不要提交包含真实用户数据的测试证据。

## Pull Request

Pull Request 应包含：

1. 改动目的与用户影响。
2. 对应 Issue（如有）。
3. 已执行的检查及结果。
4. 风险、兼容性或迁移说明。
5. UI 改动的脱敏截图，或说明为何不适用。

维护者会重点审查凭证边界、网络目标、错误信息、供应商兼容性和可回滚性。合并方式与发布时间由维护者根据改动范围决定。

## 发布约定

项目使用语义化版本。发布前由维护者更新版本号和 [CHANGELOG.md](CHANGELOG.md)，运行完整检查，并在实际发布平台验证生成的安装包。当前没有自动发布流程。
