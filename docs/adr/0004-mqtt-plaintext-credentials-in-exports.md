# MQTT 凭据明文存储，且随配置导出包含

## Status

accepted（2026-10-27）

## Context

ADR 0002 已确定 MySQL 凭据明文存储、不引入 `safeStorage`。MQTT 的凭据面更大：除用户名/密码外，还可能包含客户端私钥与 passphrase。设计时提供了两条路径：用 Electron `safeStorage` 加密，或沿用明文并规定导出/快照的剥离策略。

## Decision

1. MQTT 的用户名、密码、客户端私钥与 passphrase **明文保存在项目 MQTT 存储中**，与 ADR 0002 保持一致。
2. **Connection Profile 导出包含上述凭据**，不自动剥离；导出入口显示明确的敏感数据提示。
3. 由于 MQTT 是独立模块（ADR 0003），不进入 DocShare 与 OpenAPI，因此不存在对外分享页泄漏 MQTT 凭据的路径。

## Considered Options

- **`safeStorage` 加密**：安全性更高，但会与 ADR 0002 形成两套策略，并引入平台密钥、迁移与“解不开时如何恢复”的复杂度。
- **明文 + 强制剥离导出**：与现有策略一致且更安全，但用户明确要求导出可携带凭据以便搬运配置。

## Consequences

- 项目目录中的 MQTT 文件可直接读出 broker 凭据；任何获得项目目录或导出文件的人都能冒用该设备身份。
- 导出的 Connection Profile JSON 属于敏感文件，不应提交到版本库或分享给不受信任的第三方。
- MCP 工具读取 Connection Profile 时同样能看到凭据；服务本身仍受本地 MCP 的既有访问边界约束。
- 若未来改用 `safeStorage`，需要一次性的凭据迁移，并同步修改导出格式。
