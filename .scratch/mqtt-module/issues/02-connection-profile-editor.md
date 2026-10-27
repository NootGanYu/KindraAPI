# 02: Connection Profile 编辑器

**What to build:** 右侧连接配置表单，覆盖地址、传输、协议版本、认证、TLS、Will、MQTT 5 连接属性、订阅列表与保留策略；提供默认值、即时校验与密码显隐。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 表单包含 host、port、transport（tcp/tls/ws/wss）、ws_path、protocol_version（4/5）、client_id、username、password、keepalive、clean_session、connect_timeout_ms
- [ ] 切换 transport 时按 1883/8883/8083/8084 预填端口（用户手动改过后不覆盖）
- [ ] 新建默认：MQTT 5.0、`kindraapi-<8hex>`、keepalive 60、clean session true、超时 10s
- [ ] TLS 折叠面板包含 CA 路径、客户端证书路径、私钥路径、passphrase、reject_unauthorized、servername、alpn、min_version
- [ ] Will 折叠面板包含 topic、payload、qos、retain；MQTT 5 下显示 delay_interval_s 与 user_properties
- [ ] MQTT 5 连接属性包含 session_expiry_interval_s、receive_maximum、topic_alias_maximum、user_properties
- [ ] 保留策略支持 max_messages、max_bytes、max_age_days，留空表示使用模块默认
- [ ] 订阅列表可增删 Topic Filter 与 QoS，并随 Profile 保存
- [ ] 密码支持显示/隐藏；证书字段旁显示「当前仅保存路径」提示
- [ ] 字段校验：host 非空、port 1-65535、client_id 非空、Topic Filter 非空且无空白
- [ ] 保存失败时保留表单内容并显示可读错误
- [ ] typecheck 通过
- [ ] UI 自动化覆盖新建、修改 transport、切换密码显隐、保存与重新打开
