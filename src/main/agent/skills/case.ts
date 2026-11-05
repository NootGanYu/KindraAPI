import * as store from '../../storage/store'
import { readApiDetail } from '../../business/apiRead'
import type { AgentToolDefinition } from '../core/registry'
import { pageItems, requiredString } from '../core/registry'

export const caseTools: AgentToolDefinition[] = [
  {
    name: 'list_cases',
    description: '列出一个接口的用例目录（编号、名称、是否启用），分页返回；不包含断言与覆盖值。',
    parameters: {
      type: 'object',
      properties: {
        target_id: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      },
      required: ['target_id'],
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const targetId = requiredString(args, 'target_id')
      const target = store.getTarget(projectId, targetId)
      if (!target) throw new Error('接口不存在')
      const cases = target.cases ?? []
      const page = pageItems(cases, args.cursor, args.limit)
      return {
        output: { target_id: targetId, total: page.total, next_cursor: page.next_cursor, items: page.items.map(item => ({ case_id: item.case_id, name: item.name, is_enabled: item.is_enabled })) },
        summary: `用例目录 ${page.items.length}/${page.total} 项`,
        ...(page.next_cursor ? { cursor: page.next_cursor } : {})
      }
    }
  },
  {
    name: 'get_case',
    description: '按接口与用例编号读取一个用例的完整定义（覆盖参数与断言）。',
    parameters: {
      type: 'object',
      properties: { target_id: { type: 'string' }, case_id: { type: 'string' } },
      required: ['target_id', 'case_id'],
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const targetId = requiredString(args, 'target_id')
      const caseId = requiredString(args, 'case_id')
      const api = readApiDetail(projectId, targetId).api
      const found = (api.cases ?? []).find(item => item.case_id === caseId)
      if (!found) throw new Error('用例不存在')
      return { output: { target_id: api.target_id, case: found }, summary: `读取用例：${found.name}` }
    }
  }
]
