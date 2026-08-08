# 更新日志

本文件记录 Domain Buddy 的重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- 暂无。

## [0.1.0] - 2026-08-08

### Added

- 基于 Tauri 2 与 React 的本地 DNS 管理桌面应用。
- 腾讯云 DNSPod、Cloudflare 和火山引擎 DNS 的凭证验证、域名聚合与记录管理。
- DNS 记录新增、修改、状态切换、备注和删除能力。
- 阿里云 DNS 的界面位置和供应商数据结构预留；未接入前禁用入口且不保存凭证。
- 使用操作系统凭证库存储敏感凭证，并限制请求到供应商官方 HTTPS Endpoint。
- 开源许可证、协作指南、安全政策、行为准则、Issue / PR 模板与基础 CI。

[Unreleased]: https://github.com/Leochens/domain-buddy/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Leochens/domain-buddy/tree/v0.1.0
