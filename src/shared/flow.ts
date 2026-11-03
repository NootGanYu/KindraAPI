import type { FlowRunStatus } from './types'

const activeStatus: Record<FlowRunStatus, boolean> = {
  running: true,
  pausing: true,
  paused: true,
  cancelling: true,
  permission_revoked: true,
  cancelled: false,
  passed: false,
  failed: false,
  interrupted: false,
  unknown: false,
  blocked: false
}

/** Activity includes a retained execution stack waiting for user review. */
export function isActiveFlowRunStatus(status: FlowRunStatus): boolean {
  return activeStatus[status] === true
}
