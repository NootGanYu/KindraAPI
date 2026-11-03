export interface ApiStatusOption {
  value: number
  label: string
  color: string
}

/** 依据 docs/03-数据模型与本地存储.md 的默认状态标记 1–4。 */
export const API_STATUS_OPTIONS: ApiStatusOption[] = [
  { value: 1, label: '开发中', color: '#2857FF' },
  { value: 2, label: '已完成', color: '#26CEA4' },
  { value: 3, label: '需修改', color: '#FA8C16' },
  { value: 4, label: '已废弃', color: '#8E8069' }
]

export function apiStatusOption(status?: number): ApiStatusOption {
  return (
    API_STATUS_OPTIONS.find((option) => option.value === status) ?? {
      value: status ?? 1,
      label: status ? `状态 ${status}` : '开发中',
      color: '#8E8069'
    }
  )
}

export function apiStatusLabel(status?: number): string {
  return apiStatusOption(status).label
}

export function apiStatusColor(status?: number): string {
  return apiStatusOption(status).color
}
