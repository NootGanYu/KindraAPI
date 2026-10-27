# 11: 三类导出

**What to build:** 提供三份彼此独立的导出：Connection Profile JSON、消息 JSONL/CSV、Connection Attempt JSONL；Profile 导出包含明文凭据并在入口提示风险。

**Blocked by:** 02, 03, 07

**Status:** ready-for-agent

- [ ] Profile 导出为单个 JSON，包含完整配置（含 username/password/私钥/passphrase）
- [ ] Profile 导出前显示「该文件包含明文凭据」确认框；取消则不写文件
- [ ] 导出时可选择将证书/私钥内嵌 PEM 或保留路径引用
- [ ] 消息导出支持 JSONL 与 CSV；字段含 seq、direction、topic、payload、payload_encoding、qos、retain、received_at
- [ ] 消息导出按当前 Profile 或全部 Profile 二选一；二进制 payload 标注 base64
- [ ] Attempt 导出为 JSONL，字段与 `MqttAttempt` 一致
- [ ] 三种导出均使用系统保存对话框，默认文件名含 Profile 名与时间戳
- [ ] 目标路径不可写、磁盘空间不足、用户取消时返回明确结果且不留下半截文件
- [ ] 导出不修改源数据，不触发轮转
- [ ] IPC：`mqtt:profiles:export`、`mqtt:messages:export`、`mqtt:attempts:export`
- [ ] typecheck 通过
- [ ] smoke 覆盖：三种导出文件内容、凭据包含、内嵌 PEM 选项、取消与写失败
