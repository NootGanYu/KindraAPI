import * as store from '../../storage/store'
import type { AgentToolDefinition } from '../core/registry'
import { requiredString } from '../core/registry'

/** Read-only environment/variable tools. Variable values are never returned. */
export const configTools: AgentToolDefinition[] = [
  {
    name: 'list_environments',
    description: '列出项目环境编号与名称。不返回变量值。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    readOnly: true,
    handler: (_args, { projectId }) => {
      const items = store.listEnvironments(projectId).map(environment => ({ env_id: environment.env_id, name: environment.name }))
      return { output: { items, total: items.length }, summary: `环境目录 ${items.length} 项` }
    }
  },
  {
    name: 'get_environment',
    description: '读取一个环境的名称与变量清单（仅变量名、说明、是否启用）。变量值被明确排除。',
    parameters: { type: 'object', properties: { env_id: { type: 'string' } }, required: ['env_id'], additionalProperties: false },
    risk: 'read',
    readOnly: true,
    handler: (args, { projectId }) => {
      const envId = requiredString(args, 'env_id')
      const environment = store.listEnvironments(projectId).find(item => item.env_id === envId)
      if (!environment) throw new Error('环境不存在')
      const variables = Object.entries(environment.env_var_list).map(([key, variable]) => ({
        name: key,
        description: variable.description ?? '',
        enabled: variable.is_checked === 1
      }))
      return {
        output: { env_id: environment.env_id, name: environment.name, variables },
        summary: `读取环境：${environment.name}（变量 ${variables.length} 项，未包含变量值）`
      }
    }
  },
  {
    name: 'list_global_vars',
    description: '列出项目全局变量的名称与说明。变量值被明确排除。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    readOnly: true,
    handler: (_args, { projectId }) => {
      const vars = store.getGlobalVars(projectId).vars
      const items = Object.entries(vars).map(([name, variable]) => ({ name, description: variable.description ?? '' }))
      return { output: { items, total: items.length }, summary: `全局变量 ${items.length} 项（未包含变量值）` }
    }
  }
]
