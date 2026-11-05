import * as store from '../../storage/store'
import type { AgentToolDefinition } from '../core/registry'
import { pageItems, requiredString } from '../core/registry'

export const flowTools: AgentToolDefinition[] = [
  {
    name: 'list_flows',
    description: '列出项目 Flow 目录，只返回编号与名称，分页返回；不包含事件定义。',
    parameters: {
      type: 'object',
      properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const flows = store.listFlows(projectId).map(flow => ({ flow_id: flow.flow_id, name: flow.name }))
      const page = pageItems(flows, args.cursor, args.limit)
      return { output: page, summary: `Flow 目录 ${page.items.length}/${page.total} 项`, ...(page.next_cursor ? { cursor: page.next_cursor } : {}) }
    }
  },
  {
    name: 'get_flow',
    description: '按需读取 Flow 的元信息与事件定义。事件按 cursor/limit 分页，未返回下一页时事件已读完。',
    parameters: {
      type: 'object',
      properties: {
        flow_id: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      },
      required: ['flow_id'],
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const flowId = requiredString(args, 'flow_id')
      const flow = store.getFlow(projectId, flowId)
      if (!flow) throw new Error('Flow 不存在')
      const page = pageItems(flow.events ?? [], args.cursor, args.limit)
      return {
        output: {
          flow_id: flow.flow_id, name: flow.name, description: flow.description, env_id: flow.env_id,
          total_events: page.total, events: page.items, next_cursor: page.next_cursor
        },
        summary: `读取 Flow：${flow.name}（事件 ${page.items.length}/${page.total}）`,
        ...(page.next_cursor ? { cursor: page.next_cursor } : {})
      }
    }
  }
]
