import { Fragment } from 'react'
import { Tag, Typography } from 'antd'
import type { AgentActivity, AgentConversation, AgentMessage } from '@shared/agent'
import AgentToolCard from './AgentToolCard'

interface Turn {
  turn_id: string
  user?: AgentMessage
  assistant?: AgentMessage
  activities: AgentActivity[]
}

function groupTurns(conversation: AgentConversation): Turn[] {
  const turns: Turn[] = []
  const byId = new Map<string, Turn>()
  const ensure = (turnId: string): Turn => {
    const existing = byId.get(turnId)
    if (existing) return existing
    const turn: Turn = { turn_id: turnId, activities: [] }
    byId.set(turnId, turn)
    turns.push(turn)
    return turn
  }
  let current: Turn | undefined
  for (const message of conversation.messages) {
    if (message.role === 'user') {
      current = ensure(message.turn_id ?? message.message_id)
      current.user = message
    } else {
      const turn = message.turn_id ? ensure(message.turn_id) : current ?? ensure(message.message_id)
      turn.assistant = message
      if (!message.turn_id) current = turn
    }
  }
  for (const activity of conversation.activities ?? []) {
    ensure(activity.turn_id).activities.push(activity)
  }
  for (const turn of turns) turn.activities.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return turns
}

function MessageBody({ message }: { message: AgentMessage }): JSX.Element {
  return <>
    <Typography.Text strong>{message.role === 'user' ? '你' : 'Agent'}</Typography.Text>
    <div className="agent-message-text">{message.content || (message.status === 'streaming' ? '正在回复…' : '未收到回复')}</div>
    {message.status === 'interrupted' && <Tag>已中断</Tag>}
    {message.status === 'error' && <Tag color="error">回复失败</Tag>}
  </>
}

/** Renders one user turn, its ordered tool cards, then the final answer. */
export default function AgentTimeline({ conversation, onApproval }: {
  conversation: AgentConversation
  onApproval?: (activityId: string, decision: 'approved' | 'denied') => void
}): JSX.Element {
  return <div className="agent-timeline" aria-label="Agent 时间线">
    {groupTurns(conversation).map(turn => <Fragment key={turn.turn_id}>
      {turn.user && <article className="agent-message user"><MessageBody message={turn.user} /></article>}
      {turn.activities.length > 0 && <section className="agent-timeline-tools" aria-label="工具调用">
        {turn.activities.map(activity => <AgentToolCard key={activity.activity_id} activity={activity} onApproval={onApproval} />)}
      </section>}
      {turn.assistant && <article className={`agent-message ${turn.assistant.role}`}><MessageBody message={turn.assistant} /></article>}
    </Fragment>)}
  </div>
}
