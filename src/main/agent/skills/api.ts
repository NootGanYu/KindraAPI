import * as store from '../../storage/store'
import { readApiDetail } from '../../business/apiRead'
import type { AgentToolDefinition } from '../core/registry'
import { cursorNumber, limitNumber, optionalString, pageItems, requiredString } from '../core/registry'

const API_SECTIONS = ['summary', 'request', 'response', 'cases'] as const
type ApiSection = (typeof API_SECTIONS)[number]

function catalogEntry(target: ReturnType<typeof store.listTargets>[number]): Record<string, unknown> {
  return {
    target_id: target.target_id,
    name: target.name,
    target_type: target.target_type,
    parent_id: target.parent_id,
    ...(target.method ? { method: target.method } : {})
  }
}

function chunkSection(targetId: string, section: ApiSection, value: unknown, args: Record<string, unknown>, redact?: (value: unknown) => unknown): { output: unknown; cursor?: string } {
  const text = JSON.stringify(redact ? redact(value) : value)
  const start = cursorNumber(args.cursor)
  const size = limitNumber(args.limit, 8_000, 16_000)
  if (start === 0 && text.length <= size) return { output: { target_id: targetId, section, data: value } }
  const chunk = text.slice(start, start + size)
  const next = start + chunk.length < text.length ? String(start + chunk.length) : undefined
  return {
    output: { target_id: targetId, section, chunk, total_chars: text.length, next_cursor: next ?? null },
    ...(next ? { cursor: next } : {})
  }
}

export const apiTools: AgentToolDefinition[] = [
  {
    name: 'list_apis',
    description: '列出项目接口目录。只返回编号、名称、类型、父目录和 HTTP 方法；不含 URL、描述或定义。可按父目录或名称关键词过滤并分页。',
    parameters: {
      type: 'object',
      properties: {
        parent_id: { type: 'string', description: '只列出该父目录的直接子项' },
        keyword: { type: 'string', description: '按名称模糊匹配' },
        cursor: { type: 'string', description: '上一页返回的 next_cursor' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '每页条数，默认 20' }
      },
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const parentId = optionalString(args.parent_id)
      const keyword = optionalString(args.keyword)?.toLowerCase()
      const targets = store.listTargets(projectId).filter(target =>
        (!parentId || target.parent_id === parentId) && (!keyword || target.name.toLowerCase().includes(keyword)))
      const page = pageItems(targets, args.cursor, args.limit)
      return { output: { ...page, items: page.items.map(catalogEntry) }, summary: `接口目录 ${page.items.length}/${page.total} 项`, ...(page.next_cursor ? { cursor: page.next_cursor } : {}) }
    }
  },
  {
    name: 'get_api',
    description: '按需读取一个接口的指定部分：summary（名称、URL、描述等摘要）、request（请求定义）、response（响应定义）或 cases（用例目录）。request/response 过长时返回 chunk 与 next_cursor，按 cursor 继续读取。',
    parameters: {
      type: 'object',
      properties: {
        target_id: { type: 'string' },
        section: { type: 'string', enum: [...API_SECTIONS], description: '默认 summary' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      },
      required: ['target_id'],
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId, redact }) => {
      const targetId = requiredString(args, 'target_id')
      const section = (optionalString(args.section) ?? 'summary') as ApiSection
      if (!API_SECTIONS.includes(section)) throw new Error('未知接口分段')
      const api = readApiDetail(projectId, targetId).api
      if (section === 'summary') {
        return {
          output: {
            target_id: api.target_id, target_type: api.target_type, parent_id: api.parent_id,
            name: api.name, method: api.method, url: api.url, description: api.description,
            protocol: api.protocol, tags: api.tags, status: api.status,
            case_count: api.cases?.length ?? 0,
            has_request: !!api.request, has_response: !!api.response
          },
          summary: `读取接口摘要：${api.name}`
        }
      }
      if (section === 'cases') {
        const page = pageItems(api.cases ?? [], args.cursor, args.limit)
        return {
          output: {
            target_id: api.target_id, section, total: page.total, next_cursor: page.next_cursor,
            items: page.items.map(item => ({ case_id: item.case_id, name: item.name, is_enabled: item.is_enabled }))
          },
          summary: `读取用例目录 ${page.items.length}/${page.total} 项`,
          ...(page.next_cursor ? { cursor: page.next_cursor } : {})
        }
      }
      const value = section === 'request' ? api.request : api.response
      return { ...chunkSection(api.target_id, section, value ?? null, args, redact as ((value: unknown) => unknown) | undefined), summary: `读取接口 ${section}：${api.name}` }
    }
  },
  {
    name: 'list_runs',
    description: '列出接口发送历史摘要（编号、接口、方法、状态、耗时），可按接口过滤并分页。',
    parameters: {
      type: 'object',
      properties: {
        target_id: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      },
      additionalProperties: false
    },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const targetId = optionalString(args.target_id)
      const records = store.listSendRecords(projectId).filter(record => !targetId || record.target_id === targetId)
      const page = pageItems(records, args.cursor, args.limit)
      return { output: page, summary: `发送记录 ${page.items.length}/${page.total} 条`, ...(page.next_cursor ? { cursor: page.next_cursor } : {}) }
    }
  },
  {
    name: 'get_run',
    description: '按编号读取一次发送记录的完整请求、响应与断言结果。',
    parameters: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'], additionalProperties: false },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const runId = requiredString(args, 'run_id')
      const record = store.getSendRecord(projectId, runId)
      if (!record) throw new Error('发送记录不存在')
      return { output: record, summary: `读取发送记录 ${record.target_name}` }
    }
  }
]
