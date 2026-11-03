import type { McpConfig } from '@shared/types'

/** Common policy for project-bound MCP tools and continued MCP-issued runs. */
export function projectPermissionError(
  config: McpConfig,
  projectId: string,
  requirements: { write?: boolean; execute?: boolean } = {}
): string | null {
  if (!config.enabled) return 'MCP 未开启'
  if (!projectId) return '缺少 project_id'
  if (!config.allowed_project_ids.includes(projectId)) return '项目不在授权列表'
  if (requirements.write && !config.allow_write) return '未开启写入权限 allow_write'
  if (requirements.execute && !config.allow_execute) return '未开启接口执行权限 allow_execute'
  return null
}
