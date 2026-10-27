# 05: 连接测试、往返验证与 Connection Attempt

**What to build:** 实现「测试连接」临时会话、CONNACK 元信息展示、可选 Round-trip Check，以及项目级 Connection Attempt 的摘要索引与 JSONL 落盘；在 Profile 详情与模块级「运行记录」两处展示。

**Blocked by:** 03, 04

**Status:** ready-for-agent

- [ ] 「测试连接」使用当前表单内容（允许未保存草稿），10 秒超时，结束后不留持久会话
- [ ] 成功时展示 CONNACK 返回码/原因码、协议版本、session present、broker 分配的 clientId 与总耗时
- [ ] 失败时展示分类、原始错误与建议
- [ ] 可选 Round-trip Check：默认关闭；开启时使用 `kindraapi/test/<session_id>`、QoS 0、retain false、3 秒超时，payload 含时间戳
- [ ] Round-trip 成功记录往返延迟；失败记录具体阶段（发布失败/未收到/ACL 拒绝）
- [ ] 「连接」成功或失败也写入一条 `kind: 'connect'` 的 Attempt；断线重连不重复写
- [ ] Attempt 存储：`offline-data-local/projects/<project_id>/mqtt/attempts/index.json`（最近 500 条摘要）与 `attempts/<connection_id>.jsonl`（追加写，2000 行或 10MB 轮转）
- [ ] 读取 JSONL 时跳过最后一行不完整记录，不因崩溃留下半行而报错
- [ ] Profile 详情展示该配置最近 Attempt；模块级「运行记录」可跨配置查看与筛选
- [ ] IPC：`mqtt:test`、`mqtt:attempts:list`
- [ ] typecheck 通过
- [ ] smoke 覆盖：成功、认证失败、DNS 失败、连接超时、Round-trip 成功与未收到、Attempt 落盘与轮转
