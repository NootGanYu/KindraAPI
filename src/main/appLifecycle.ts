/**
 * Deliberate relaunch is a quit: it must pass the same Renderer confirmation and async
 * prepareQuit drain as Cmd+Q/tray quit. IPC only arms the request; the main lifecycle decides
 * when (and whether) to schedule app.relaunch.
 */
export interface AppLifecycleHandlers {
  requestRelaunch(): void
  cancelRelaunch(): void
}
let handlers: AppLifecycleHandlers | null = null
export function registerAppLifecycle(value: AppLifecycleHandlers): void { handlers = value }
export function requestRelaunch(): void {
  if (!handlers) throw new Error('应用尚未完成启动，无法重启')
  handlers.requestRelaunch()
}
export function cancelRelaunch(): void { handlers?.cancelRelaunch() }
