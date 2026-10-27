# 06: 多订阅管理与自动重订阅

**What to build:** 一个会话支持多个 Topic Filter 与独立 QoS，订阅列表随 Profile 持久化，重连后自动重订阅；订阅/取消订阅返回 SUBACK 结果并区分 ACL 失败；识别共享订阅。

**Blocked by:** 03, 04

**Status:** ready-for-agent

- [ ] 右侧连接区展示订阅列表，可新增、编辑、删除 Topic Filter 与 QoS
- [ ] 订阅列表随 Connection Profile 保存与加载
- [ ] 会话连接成功后自动订阅 Profile 中保存的全部 Topic Filter
- [ ] 手动订阅/取消订阅立即生效，并更新 UI 状态
- [ ] SUBACK 结果按主题展示授权 QoS 或失败原因码
- [ ] 订阅失败（如 0x87 Not authorized）归类为 `acl` 并给出可读提示
- [ ] `$share/<group>/<topic>` 被识别为 Shared Subscription 并在 UI 标注
- [ ] 非法 Topic Filter（空、含空格、非法通配符位置）在提交前被拒绝
- [ ] 断线期间订阅状态显示为「待恢复」，重连成功后恢复为「已订阅」
- [ ] IPC：`mqtt:subscribe`、`mqtt:unsubscribe`、`mqtt:subscriptions:list`
- [ ] typecheck 通过
- [ ] smoke 覆盖：多主题订阅、QoS 1/2、ACL 拒绝、取消订阅、重连自动重订阅、共享订阅识别
