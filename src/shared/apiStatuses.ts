import type { ApiStatus, Project } from './types'

export const DEFAULT_API_STATUSES: ApiStatus[] = [
  { id: '1', name: '开发中', color: '#3865f5' },
  { id: '2', name: '已完成', color: '#00c9a7' },
  { id: '3', name: '需修改', color: '#ffbf00' },
  { id: '4', name: '已废弃', color: '#ff4b2b' }
]
export function apiStatuses(project: Project | null): ApiStatus[] {
  return project?.api_statuses?.length ? project.api_statuses : DEFAULT_API_STATUSES
}
export function defaultApiStatus(project: Project | null): string {
  const statuses = apiStatuses(project)
  return statuses.some(status => status.id === project?.default_api_status_id) ? project!.default_api_status_id! : statuses[0].id
}
