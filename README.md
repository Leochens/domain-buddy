# Domain Buddy

一个本地运行的 Tauri 小工具，用于管理腾讯云 DNSPod 解析记录。

当前能力：

- 保存腾讯云 `SecretId` / `SecretKey` 到本机应用配置目录。
- 使用 `DescribeDomainList` 验证凭证和 DNSPod 权限。
- 按主域名列出解析记录。
- 新增、修改、删除子域名解析记录。

开发运行：

```bash
npm install
npm run tauri dev
```

构建前端：

```bash
npm run build
```

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
