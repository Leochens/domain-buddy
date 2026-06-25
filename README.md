# Domain Buddy

一个本地运行的 Tauri 小工具，用于管理域名 DNS 解析记录。

当前能力：

- 保存多个供应商凭证到本机应用配置目录。
- 已支持腾讯云 DNSPod 和 Cloudflare 共存。
- 阿里云 DNS 配置入口已预留，API 管理逻辑待接入。
- 验证凭证并聚合展示所有已配置供应商的账号域名列表。
- 点击账号域名后，按该域名所属供应商列出解析记录。
- 在表格中直接修改解析记录。
- 支持解析记录备注。
- 记录值可从当前已有记录值里选择，也可以手动输入。
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
