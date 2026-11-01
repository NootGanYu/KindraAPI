# 组件：PublishPanel.tsx

- 源码：`src/renderer/src/components/mqtt/PublishPanel.tsx`
- 行数：556
- 静态统计：JSX 64 / 提示 15 / 菜单 3 / Tooltip 0 / Placeholder 2 / IPC 18

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Alert` | — | type=info message=当前连接未建立，连接后才能发布消息。 | `src/renderer/src/components/mqtt/PublishPanel.tsx`:323 |
| `Input` | devices/client/command | value=topic status=topicError ? 'error' : undefined placeholder=devices/client/command | `src/renderer/src/components/mqtt/PublishPanel.tsx`:334 |
| `Select` | — | value=view options=PAYLOAD_VIEW_OPTIONS | `src/renderer/src/components/mqtt/PublishPanel.tsx`:344 |
| `Select` | — | value=qos options=QOS_OPTIONS | `src/renderer/src/components/mqtt/PublishPanel.tsx`:352 |
| `Switch` | — | checked=retain | `src/renderer/src/components/mqtt/PublishPanel.tsx`:360 |
| `Input.TextArea` | view === 'json' ? '{\n "command": "ping"\n}' : 'payload' | value=payload placeholder=view === 'json' ? '{\n "command": "ping"\n}' : 'payload' | `src/renderer/src/components/mqtt/PublishPanel.tsx`:366 |
| `Button` | 发送 | type=primary loading=sending disabled=!canSend | `src/renderer/src/components/mqtt/PublishPanel.tsx`:383 |
| `Alert` | — | type=result.ok ? 'success' : 'error' message=<span> {result.ok ? '发布成功' : '发布失败'} {result.reason_text ? ` · ${result.reason_text}` : ''} {result.reason_code !== | `src/renderer/src/components/mqtt/PublishPanel.tsx`:395 |
| `Tag` | `0x${result.reason_code.toString(16).padStart(2, '0')}` | — | `src/renderer/src/components/mqtt/PublishPanel.tsx`:404 |
| `Tag` | 运行中 | — | `src/renderer/src/components/mqtt/PublishPanel.tsx`:431 |
| `InputNumber` | — | value=intervalMs | `src/renderer/src/components/mqtt/PublishPanel.tsx`:435 |
| `Radio.Group` | — | value=stopMode size=small | `src/renderer/src/components/mqtt/PublishPanel.tsx`:443 |
| `Radio.Button` | 按次数 | value=count | `src/renderer/src/components/mqtt/PublishPanel.tsx`:448 |
| `Radio.Button` | 按时长 | value=duration | `src/renderer/src/components/mqtt/PublishPanel.tsx`:449 |
| `InputNumber` | — | value=loopCount | `src/renderer/src/components/mqtt/PublishPanel.tsx`:452 |
| `InputNumber` | — | value=durationS | `src/renderer/src/components/mqtt/PublishPanel.tsx`:460 |
| `Button` | 停止 | danger=true | `src/renderer/src/components/mqtt/PublishPanel.tsx`:469 |
| `Button` | 启动循环 | loading=starting | `src/renderer/src/components/mqtt/PublishPanel.tsx`:477 |
| `Button` | 刷新 | size=small type=link loading=historyLoading | `src/renderer/src/components/mqtt/PublishPanel.tsx`:501 |
| `Tag` | entry.ok ? '成功' : '失败' | — | `src/renderer/src/components/mqtt/PublishPanel.tsx`:527 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 发送 | type=primary loading=sending disabled=!canSend | `src/renderer/src/components/mqtt/PublishPanel.tsx`:383 |
| Radio.Button | 按次数 | value=count | `src/renderer/src/components/mqtt/PublishPanel.tsx`:448 |
| Radio.Button | 按时长 | value=duration | `src/renderer/src/components/mqtt/PublishPanel.tsx`:449 |
| Button | 停止 | danger=true | `src/renderer/src/components/mqtt/PublishPanel.tsx`:469 |
| Button | 启动循环 | loading=starting | `src/renderer/src/components/mqtt/PublishPanel.tsx`:477 |
| Button | 刷新 | size=small type=link loading=historyLoading | `src/renderer/src/components/mqtt/PublishPanel.tsx`:501 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.success` | `\`发布成功：${publishResult.reason_text ?? '已发送'}\`` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:221 |
| `message.error` | `\`发布失败：${publishResult.reason_text ?? publishResult.error ?? '未知错误'}\`` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:224 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:227 |
| `message.error` | `请先连接 MQTT` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:235 |
| `message.error` | `encoded.error` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:239 |
| `message.error` | `topicError` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:243 |
| `message.error` | `payload 超过 1MB 限制，无法发送` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:247 |
| `message.error` | `发送次数必须大于 0` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:252 |
| `message.error` | `持续时间必须大于 0 秒` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:256 |
| `modal.confirm` | `title=启动循环发布？; content=\`按 ${interval} ms 间隔发送，预计 ${estimated} 条。运行中可随时停止。\`; okText=启动; cancelText=取消` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:262 |
| `message.success` | `循环发布已启动` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:284 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:286 |
| `message.success` | `已停止循环发布` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:299 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:301 |
| `message.info` | `已回填发布历史` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:313 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `QoS 0` | `` | — | `src/renderer/src/components/mqtt/PublishPanel.tsx`:53 |
| `QoS 1` | `` | — | `src/renderer/src/components/mqtt/PublishPanel.tsx`:54 |
| `QoS 2` | `` | — | `src/renderer/src/components/mqtt/PublishPanel.tsx`:55 |

### 源码中的提示文案

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `devices/client/command` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:337 |
| `view === 'json' ? '{\n "command": "ping"\n}' : 'payload'` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:370 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.mqtt.publish
            .loopState(projectId, connectionId)
            .then((state) => {
              if (state.ok) setLoop(state.data)
            })
            .catch` | `() => undefined` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:114 |
| `window.api.mqtt.publish
            .loopState(projectId, connectionId)
            .then` | `(state) => { if (state.ok) setLoop(state.data) }` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:114 |
| `window.api.mqtt.publish
            .loopState` | `projectId, connectionId` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:114 |
| `window.api.mqtt.publish.history` | `projectId` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:129 |
| `window.api.mqtt.publish
      .loopState(projectId, connectionId)
      .then((state) => {
        if (alive && state.ok) setLoop(state.data.running ? state.data : null)
      })
      .catch` | `() => undefined` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:145 |
| `window.api.mqtt.publish
      .loopState(projectId, connectionId)
      .then` | `(state) => { if (alive && state.ok) setLoop(state.data.running ? state.data : null) }` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:145 |
| `window.api.mqtt.publish
      .loopState` | `projectId, connectionId` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:145 |
| `window.api.mqtt.publish
          .stopLoop(projectId, connectionId)
          .catch` | `() => undefined` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:155 |
| `window.api.mqtt.publish
          .stopLoop` | `projectId, connectionId` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:155 |
| `window.api.mqtt.publish
        .loopState(projectId, connectionId)
        .then((state) => {
          if (!alive) return
          if (state.ok) setLoop(state.data.running ? state.data : null)
        })
        .catch` | `() => undefined` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:166 |
| `window.api.mqtt.publish
        .loopState(projectId, connectionId)
        .then` | `(state) => { if (!alive) return if (state.ok) setLoop(state.data.running ? state.data : null)` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:166 |
| `window.api.mqtt.publish
        .loopState` | `projectId, connectionId` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:166 |
| `window.api.mqtt.publish
        .stopLoop(projectId, connectionId)
        .then((state) => {
          if (state.ok) setLoop(null)
        })
        .catch` | `() => undefined` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:182 |
| `window.api.mqtt.publish
        .stopLoop(projectId, connectionId)
        .then` | `(state) => { if (state.ok) setLoop(null) }` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:182 |
| `window.api.mqtt.publish
        .stopLoop` | `projectId, connectionId` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:182 |
| `window.api.mqtt.publish.send` | `projectId, connectionId, buildInput()` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:217 |
| `window.api.mqtt.publish.startLoop` | `projectId, connectionId, buildInput(), options` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:275 |
| `window.api.mqtt.publish.stopLoop` | `projectId, connectionId` | `src/renderer/src/components/mqtt/PublishPanel.tsx`:296 |

> 返回 [组件索引](README.md)
