# 09: MQTT 5 特性与 TLS 交互面

**What to build:** 在连接、发布、遗嘱与订阅中暴露 MQTT 5 常用属性；把原因码翻译为可读解释；完善 TLS 配置的校验与错误提示。

**Blocked by:** 02, 06, 08

**Status:** ready-for-agent

- [ ] MQTT 5 原因码展示为「数字 + 可读解释」，覆盖 CONNACK、PUBACK、SUBACK、DISCONNECT
- [ ] 连接、发布、遗嘱与订阅均支持 User Properties 的增删改
- [ ] 连接支持 Session Expiry Interval、Receive Maximum、Topic Alias Maximum
- [ ] 遗嘱支持 Will Delay Interval 与 User Properties（MQTT 5）
- [ ] Topic Alias 由客户端库自动管理；UI 至少展示当前配置与是否启用
- [ ] `$share/<group>/<topic>` 在订阅列表与消息主题中被标注为共享订阅
- [ ] TLS 表单校验：证书/私钥路径存在且可读；私钥与证书不匹配时给出可读错误
- [ ] `reject_unauthorized=false` 时显示醒目警告，说明会跳过证书校验
- [ ] TLS 握手失败、证书过期、主机名不匹配、ALPN 不匹配分别给出可读提示
- [ ] MQTT 3.1.1 下隐藏或禁用 v5 专属字段，切回 5.0 时恢复
- [ ] typecheck 通过
- [ ] smoke 或 UI 自动化覆盖：v5 属性发送、原因码展示、TLS 校验错误、共享订阅标注
