# Domain Buddy

一个本地运行的 Tauri 小工具，用于管理腾讯云 DNSPod 解析记录。

当前能力：

- 保存腾讯云 `SecretId` / `SecretKey` 到本机应用配置目录。
- 使用 `DescribeDomainList` 验证凭证和 DNSPod 权限，并同步账号域名列表。
- 点击账号域名后，按主域名列出解析记录。
- 在表格中直接修改解析记录。
- 使用弹窗新增子域名解析记录。
- 删除子域名解析记录。

开发运行：

```bash
npm install
npm run tauri dev
```

构建前端：

```bash
npm run build
```

图标母版：

- `assets/domain-buddy-icon-transparent.png`
