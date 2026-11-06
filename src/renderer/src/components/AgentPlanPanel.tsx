import { useEffect, useState } from 'react'
import { Alert, Empty } from 'antd'
import type { AgentPlan } from '@shared/agentPlan'
import type { Result } from '@shared/types'
import AgentPlanCard from './AgentPlanCard'

function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error); return result.data }

/** Inline plan history. Plans are approved in place beside the conversation, never in a nested drawer. */
export default function AgentPlanPanel({ projectId }: { projectId: string }): JSX.Element {
  const [plans, setPlans] = useState<AgentPlan[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let mounted = true
    const off = window.api.agent.onPlanChanged(event => {
      if (event.project_id !== projectId) return
      setPlans(previous => event.plan ? [event.plan, ...previous.filter(plan => plan.plan_id !== event.plan_id)] : previous.filter(plan => plan.plan_id !== event.plan_id))
    })
    window.api.agent.listPlans(projectId).then(result => mounted && setPlans(unwrap(result))).catch(e => mounted && setError(e.message))
    return () => { mounted = false; off() }
  }, [projectId])
  return <section className="agent-plans" aria-label="Agent 计划">
    {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
    {!plans.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有计划" />}
    {plans.map(plan => <AgentPlanCard key={plan.plan_id} plan={plan} projectId={projectId} />)}
  </section>
}
