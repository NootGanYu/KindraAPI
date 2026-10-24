# 数据库连接首版只做 MySQL，凭据明文存本地

## Status

accepted（2026-10-25）

## Context

原应用支持多种数据库，并把连接信息保存在项目级 `settings/db_links.json`。本轮需要真实连接、测试并导入表结构；同时要决定首版数据库类型、凭据保护方式和 SSH 范围。

## Decision

1. **仅支持 MySQL**，使用 `mysql2` 直连；其他数据库类型后续迭代。
2. **密码等凭据明文保存在 `settings/db_links.json`**，与原应用一致；不引入 `safeStorage`。
3. **SSH 配置只记录、不执行**：`ssh` 字段按截图保存（启用、host/port、用户名、密码、认证方式、私钥、passphrase），本轮测试连接与导入表结构只走直连；UI 对启用的 SSH 明确提示“后续支持”。
4. 不做按环境覆盖连接参数，只保留 `config.default`。

## Considered Options

- **safeStorage 加密**：更安全，但会引入平台密钥与迁移成本，且原应用为明文。
- **多数据库驱动**：覆盖面大，但驱动、类型映射与验证成本高；本轮先验证 MySQL 链路。
- **实现 SSH 隧道**：需要 `ssh2`、私钥管理与更多验证；用户明确后续迭代。
- **环境覆盖**：原应用有 `config[env_id]`，但本轮 UI 只需“默认配置”，避免未验证的复杂度。

## Consequences

- 项目目录中的连接文件可直接读出密码；只适合本地单机使用，导出、分享与 MCP 输出都必须脱敏。
- MCP 的 `list_db_connections` 只返回连接元信息；测试与导入需要 `allow_execute`。
- 数据文件保留 `ssh` 结构，后续实现隧道时无需迁移；但在此之前 SSH 启用不会改变连接行为。
- 如果未来改用 safeStorage，需要一次性的凭据迁移。
