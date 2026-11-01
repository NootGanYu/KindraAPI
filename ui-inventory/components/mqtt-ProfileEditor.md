# 组件：ProfileEditor.tsx

- 源码：`src/renderer/src/components/mqtt/ProfileEditor.tsx`
- 行数：988
- 静态统计：JSX 207 / 提示 5 / 菜单 16 / Tooltip 1 / Placeholder 18 / IPC 2

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Tag` | tls.reject_unauthorized ? '校验证书' : '跳过校验' | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:257 |
| `Input` | /path/to/ca.pem | value=tls.ca_path ?? '' placeholder=/path/to/ca.pem | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:270 |
| `Input` | /path/to/client.crt | value=tls.cert_path ?? '' placeholder=/path/to/client.crt | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:278 |
| `Input` | /path/to/client.key | value=tls.key_path ?? '' placeholder=/path/to/client.key | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:286 |
| `Input.Password` | — | value=tls.passphrase ?? '' | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:294 |
| `Input` | broker.example.com | value=tls.servername ?? '' placeholder=broker.example.com | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:301 |
| `Select` | 默认 | value=tls.min_version placeholder=默认 options=[ { value: 'TLSv1.2', label: 'TLSv1.2' }, { value: 'TLSv1.3', label: 'TLSv1.3' } ] | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:309 |
| `Input` | mqtt, h2 | value=(tls.alpn ?? []).join(', ') placeholder=mqtt, h2 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:322 |
| `Switch` | — | checked=tls.reject_unauthorized | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:337 |
| `Alert` | — | type=warning message=已关闭证书校验，连接可能遭受中间人攻击，仅建议用于本地或自签名环境。 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:344 |
| `Tag` | 已启用 | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:358 |
| `Switch` | — | checked=Boolean(will) | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:365 |
| `Input` | devices/client/status | value=will.topic placeholder=devices/client/status | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:381 |
| `Select` | — | value=will.qos options=QOS_OPTIONS | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:389 |
| `Input.TextArea` | — | value=will.payload | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:397 |
| `Switch` | — | checked=will.retain | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:405 |
| `InputNumber` | 0 | value=will.delay_interval_s ?? null placeholder=0 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:413 |
| `Tag` | 3.1.1 不支持 | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:451 |
| `Alert` | — | type=info message=当前协议为 MQTT 3.1.1，以下 MQTT 5 连接属性不会生效。 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:457 |
| `InputNumber` | 默认 | disabled=protocolVersion === 4 value=mqtt5.session_expiry_interval_s ?? null placeholder=默认 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:467 |
| `InputNumber` | 默认 | disabled=protocolVersion === 4 value=mqtt5.receive_maximum ?? null placeholder=默认 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:483 |
| `InputNumber` | 默认 | disabled=protocolVersion === 4 value=mqtt5.topic_alias_maximum ?? null placeholder=默认 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:499 |
| `Tag` | profile.subscriptions.length | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:530 |
| `Input` | sensors/+/temperature 或 $share/group/topic | status=valid ? undefined : 'error' value=sub.filter placeholder=sensors/+/temperature 或 $share/group/topic | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:545 |
| `Tag` | 共享 sharedSubscriptionGroup(sub.filter) ?? '?' | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:554 |
| `Select` | — | value=sub.qos options=QOS_OPTIONS | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:559 |
| `Tooltip` | 删除订阅 | title=删除订阅 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:565 |
| `Button` | — | type=text danger=true | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:566 |
| `Button` | 添加订阅 | size=small type=dashed | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:578 |
| `Tag` | 本地 | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:594 |
| `InputNumber` | 10000 | value=profile.retention?.max_messages ?? null placeholder=10000 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:603 |
| `InputNumber` | 52428800 | value=profile.retention?.max_bytes ?? null placeholder=52428800 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:618 |
| `InputNumber` | 7 | value=profile.retention?.max_age_days ?? null placeholder=7 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:633 |
| `Tag` | protocolLabel(protocolVersion) | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:658 |
| `Space` | sessionActive ? ( <Button danger icon={<DisconnectOutlined />} loading={connecting} onClick={() => v | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:664 |
| `Button` | 保存 | type=primary loading=saving | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:665 |
| `Space` | — | size=4 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:673 |
| `Button` | 测试连接 | loading=testing | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:674 |
| `Checkbox` | 往返验证 | checked=roundTrip | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:681 |
| `Button` | 断开 | danger=true loading=connecting | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:689 |
| `Button` | 连接 | loading=connecting | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:698 |
| `Button` | 复制 | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:706 |
| `Button` | 版本历史 | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:709 |
| `Alert` | — | type=warning message=请先修正以下字段 description=issues.map((issue) => issue.message).join('；') | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:716 |
| `Input` | — | value=profile.name status=issueFor('name') ? 'error' : undefined | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:731 |
| `Input` | 未分组 | value=profile.group ?? '' placeholder=未分组 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:739 |
| `Input` | localhost | value=profile.host status=issueFor('host') ? 'error' : undefined placeholder=localhost | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:747 |
| `InputNumber` | — | status=issueFor('port') ? 'error' : undefined value=profile.port | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:756 |
| `Select` | — | value=profile.transport options=TRANSPORT_OPTIONS | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:770 |
| `Input` | /mqtt | value=profile.ws_path ?? '' status=issueFor('ws_path') ? 'error' : undefined placeholder=/mqtt | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:784 |
| `Select` | — | value=protocolVersion options=[ { value: 4, label: 'MQTT 3.1.1 (v4)' }, { value: 5, label: 'MQTT 5.0 (v5)' } ] | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:794 |
| `Input` | — | value=profile.client_id status=issueFor('client_id') ? 'error' : undefined | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:805 |
| `Input` | — | value=profile.username ?? '' | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:813 |
| `Input.Password` | — | value=profile.password ?? '' | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:820 |
| `InputNumber` | — | status=issueFor('keepalive') ? 'error' : undefined value=profile.keepalive | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:828 |
| `InputNumber` | — | status=issueFor('connect_timeout_ms') ? 'error' : undefined value=profile.connect_timeout_ms | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:841 |
| `Switch` | — | checked=profile.clean_session | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:858 |
| `Tag` | testResult.success ? '成功' : '失败' | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:870 |
| `Tag` | testResult.error.category | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:921 |
| `Collapse` | — | items=collapseItems | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:930 |
| `Button` | 刷新 | size=small type=link | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:939 |
| `Tag` | attempt.kind === 'test' ? '测试' : '连接' | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:950 |
| `Tag` | attempt.success ? '成功' : '失败' | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:953 |
| `VersionDrawer` | — | open=versionOpen | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:975 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 添加订阅 | size=small type=dashed | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:578 |
| Button | 保存 | type=primary loading=saving | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:665 |
| Button | 测试连接 | loading=testing | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:674 |
| Button | 断开 | danger=true loading=connecting | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:689 |
| Button | 连接 | loading=connecting | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:698 |
| Button | 复制 |  | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:706 |
| Button | 版本历史 |  | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:709 |
| Button | 刷新 | size=small type=link | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:939 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `issues.map((issue) => issue.message).join('；')` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:211 |
| `message.error` | `issues.map((issue) => issue.message).join('；')` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:219 |
| `message.success` | `连接测试成功` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:232 |
| `message.error` | `attempt.error?.message ?? '连接测试失败'` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:233 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:235 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `QoS 0` | `` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:74 |
| `QoS 1` | `` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:75 |
| `QoS 2` | `` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:76 |
| `TCP (mqtt)` | `` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:80 |
| `TLS (mqtts)` | `` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:81 |
| `WebSocket (ws)` | `` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:82 |
| `WebSocket TLS (wss)` | `` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:83 |
| `( <span className="mqtt-collapse-label"> TLS <Tag color={tls.reject_unauthorized` | `tls` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:252 |
| `TLSv1.2` | `` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:314 |
| `TLSv1.3` | `` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:315 |
| `( <span className="mqtt-collapse-label"> 遗嘱 Will {will ? <Tag color="blue">已启用</` | `will` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:353 |
| `( <span className="mqtt-collapse-label"> MQTT 5 属性 {protocolVersion === 4 ? <Tag` | `mqtt5` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:446 |
| `( <span className="mqtt-collapse-label"> 订阅 <Tag color="blue">{profile.subscript` | `subscriptions` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:525 |
| `( <span className="mqtt-collapse-label"> 保留策略 <Tag color="default">本地</Tag> </sp` | `retention` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:589 |
| `MQTT 3.1.1 (v4)` | `` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:797 |
| `MQTT 5.0 (v5)` | `` | — | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:798 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `删除订阅` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:565 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `/path/to/ca.pem` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:272 |
| `/path/to/client.crt` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:280 |
| `/path/to/client.key` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:288 |
| `broker.example.com` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:303 |
| `默认` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:312 |
| `mqtt, h2` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:324 |
| `devices/client/status` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:383 |
| `0` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:417 |
| `默认` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:472 |
| `默认` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:488 |
| `默认` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:504 |
| `sensors/+/temperature 或 $share/group/topic` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:548 |
| `10000` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:607 |
| `52428800` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:623 |
| `7` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:637 |
| `未分组` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:741 |
| `localhost` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:750 |
| `/mqtt` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:787 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.mqtt.attempts.list` | `projectId, profile.connection_id, 20` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:137 |
| `window.api.mqtt.test` | `projectId, profile, { round_trip: roundTrip }` | `src/renderer/src/components/mqtt/ProfileEditor.tsx`:229 |

> 返回 [组件索引](README.md)
