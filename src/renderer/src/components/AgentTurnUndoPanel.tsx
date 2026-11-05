import { useEffect, useState } from 'react'
import { Alert, App, Button, Card, Drawer, Radio, Space, Tag } from 'antd'
import type { AgentTurnUndo, AgentTurnSummary } from '@shared/agentTurnUndo'
import type { AgentConflictChoice } from '@shared/agentDraft'
import type { Result } from '@shared/types'
import { flushAgentDrafts } from '../agentDraftSync'
import SnapshotDiff from './SnapshotDiff'
const unwrap = <T,>(r: Result<T>): T => { if (!r.ok) throw new Error(r.error); return r.data }
export default function AgentTurnUndoPanel({ projectId }: { projectId: string }): JSX.Element {
  const { modal } = App.useApp()
  const [open,setOpen]=useState(false), [busy,setBusy]=useState(false), [error,setError]=useState('')
  const [turns,setTurns]=useState<AgentTurnSummary[]>([]),[history,setHistory]=useState<AgentTurnUndo[]>([]),[review,setReview]=useState<AgentTurnUndo|null>(null)
  const [choices,setChoices]=useState<Record<string,Record<string,AgentConflictChoice>>>({})
  async function load(): Promise<void> { setTurns(unwrap(await window.api.agent.listUndoTurns(projectId)));setHistory(unwrap(await window.api.agent.listTurnUndos(projectId))) }
  useEffect(()=>{if(open) void load().catch(e=>setError(e.message))},[open,projectId])
  async function preview(planId: string): Promise<void> { setBusy(true);try { await flushAgentDrafts();setReview(unwrap(await window.api.agent.previewTurnUndo(projectId,planId)));setChoices({});setError('');await load() }catch(e){setError((e as Error).message)}finally{setBusy(false)} }
  async function apply(): Promise<void> { if(!review)return;setBusy(true);try { await flushAgentDrafts();setReview(unwrap(await window.api.agent.applyTurnUndo(projectId,review.undo_id,review.review_id,choices)));setChoices({});setError('');await load() }catch(e){setError((e as Error).message)}finally{setBusy(false)} }
  function remove(): void { modal.confirm({title:'删除本项目全部 Agent 记录？',content:'会话、计划、工具结果、Agent 报告、候选、Agent 草稿、墓碑和撤销审计将从本机删除。正式接口、Flow、手动运行报告、纯人工草稿及模型连接保留。已删除记录无法恢复。',okText:'删除全部 Agent 记录',okButtonProps:{danger:true},cancelText:'取消',onOk:async()=>{ await flushAgentDrafts();unwrap(await window.api.agent.deleteProjectAgentRecords(projectId));setOpen(false) }}) }
  return <><Button onClick={()=>setOpen(true)}>整轮撤销与记录</Button><Drawer title="整轮本地撤销" width="92vw" open={open} onClose={()=>setOpen(false)}>
    <Alert type="warning" message="仅撤销本地草稿修改，不会隐式正式保存。远端请求及外部副作用无法撤销；逐对象处理，不保证整批原子回滚。" />
    <Space wrap style={{margin:'16px 0'}}><Button danger onClick={remove}>删除本项目 Agent 记录</Button><Button onClick={()=>void load()}>刷新记录</Button></Space>
    {error&&<Alert type="error" message={error}/>}
    {turns.map(turn=><Card key={turn.plan_id} size="small" title={turn.name}><Space><Tag>{turn.applied_count} 个已应用候选</Tag><Button loading={busy} onClick={()=>void preview(turn.plan_id)}>预览整轮撤销</Button></Space></Card>)}
    {!!history.length&&<section aria-label="撤销审计"><h3>本机撤销审计</h3>{history.map(item=><Button key={item.undo_id} onClick={()=>{setReview(item);setChoices({})}}>{item.updated_at} · {item.status==='cancelled'?'已放弃':item.status==='completed'?'已完成':item.status==='partial'?'部分完成 / 待审阅':'待审阅'}</Button>)}</section>}
    {review&&<section aria-label="整轮撤销审阅"><h3>本轮 {review.plan_id}</h3>{!!review.pending_candidate_ids?.length&&<p>{review.pending_candidate_ids.length} 个未应用候选将标记为未采纳，保留审阅历史。</p>}{review.entries.map(entry=><Card key={entry.key} title={`${entry.kind==='api'?'接口 / 用例':'Flow'} · ${entry.name}`} style={{marginBottom:16}}>
      <Tag>{({ready:'可撤销',conflict:'撤销冲突',blocked:'已暂停',completed:'已撤销'})[entry.status]}</Tag>
      {entry.error&&<Alert type="warning" message={entry.error}/>}
      {entry.new_object&&<p>新建对象保留身份，恢复创建前的初始草稿；正式定义如已保存，需另行手动处理。</p>}
      {entry.deletion_id&&<p>已删除对象将恢复到本机草稿，正式恢复保存仍是独立操作。</p>}
      <SnapshotDiff before={entry.current} after={entry.result} beforeLabel="当前内容" afterLabel="撤销后草稿"/>
      {entry.conflicts.map(conflict=><section key={conflict.id} aria-label={`撤销冲突 ${conflict.path}`}><h4>{conflict.path}</h4><div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:8}}>
        {(['base','current','agent'] as const).map(side=><div key={side}><strong>{{base:'应用后快照',current:'当前内容',agent:'应用前内容'}[side]}</strong><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{conflict[`${side}_present`]?JSON.stringify(conflict[side],null,2):'字段不存在 / 删除'}</pre></div>)}
        <div><strong>合并结果</strong><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{choices[entry.key]?.[conflict.id]?JSON.stringify(conflict[choices[entry.key][conflict.id]],null,2):'等待选择'}</pre></div></div>
        <Radio.Group value={choices[entry.key]?.[conflict.id]} onChange={e=>setChoices(previous=>({...previous,[entry.key]:{...previous[entry.key],[conflict.id]:e.target.value}}))}><Radio value="current">保留当前</Radio><Radio value="agent">恢复应用前</Radio><Radio value="base">恢复应用后</Radio></Radio.Group>
      </section>)}
    </Card>)}{['review','partial'].includes(review.status)&&<Space><Button onClick={()=>void window.api.agent.cancelTurnUndo(projectId,review.undo_id).then(unwrap).then(result=>{setReview(result);return load()}).catch(e=>setError(e.message))}>放弃本次撤销</Button><Button type="primary" loading={busy} disabled={review.entries.some(e=>e.conflicts.some(c=>!choices[e.key]?.[c.id]))} onClick={()=>void apply()}>确认整轮撤销到草稿</Button></Space>}</section>}
  </Drawer></>
}
