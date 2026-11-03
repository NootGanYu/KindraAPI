import { shutdownAgent, agentCommands } from './agent/service'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import appIcon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { applyDebugSwitch, ensureDefaultProject } from './storage/store'
import { shutdownMcp, startMcpServer } from './mcp/server'
import { shutdownDocs, startDocServer } from './docs/server'
import { shutdownMqtt } from './mqtt/sessionManager'

const appData = app.getPath('appData')
const legacyUserDataDirs = ['JinLoomAPI', 'openPost', 'api-workbench'].map((name) =>
  path.join(appData, name)
)
const kindraAPIUserData = path.join(appData, 'KindraAPI')
if (!process.env.KINDRAAPI_USER_DATA && !fs.existsSync(kindraAPIUserData)) {
  const legacyUserData = legacyUserDataDirs.find((dir) => fs.existsSync(dir))
  if (legacyUserData) {
    try {
      fs.cpSync(legacyUserData, kindraAPIUserData, { recursive: true })
    } catch (error) {
      console.error('Failed to migrate legacy data to KindraAPI:', error)
    }
  }
}
app.setName('KindraAPI')
// 测试/自动化使用独立 userData，避免污染真实项目。
app.setPath('userData', process.env.KINDRAAPI_USER_DATA || kindraAPIUserData)

// 远程调试开关在启动阶段生效，必须在 app ready 之前读取配置。
applyDebugSwitch()

const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.png')
  : appIcon

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
// allowClose 现在表示“允许真正退出应用”，窗口关闭默认只隐藏到托盘。
let allowClose = false

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function sendRequestClose(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('app:request-close')
    })
    return
  }
  mainWindow.webContents.send('app:request-close')
}

// 退出前先把窗口显示出来，渲染层的未保存确认弹窗才可见。
function requestQuit(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void agentCommands.prepareQuit().then(() => { allowClose = true; app.quit() })
    return
  }
  showMainWindow()
  sendRequestClose()
}

function createTray(): void {
  if (tray) return
  const icon = nativeImage.createFromPath(appIconPath)
  const sized = process.platform === 'win32' ? icon.resize({ width: 16, height: 16 }) : icon
  tray = new Tray(sized)
  tray.setToolTip('KindraAPI')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showMainWindow() },
      { type: 'separator' },
      { label: '退出 KindraAPI', click: () => requestQuit() }
    ])
  )
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

// macOS 用内嵌红绿灯；Windows 交给 Window Controls Overlay 绘制原生按钮；
// 其余平台保持原来的无边框窗口。
const windowChrome: Electron.BrowserWindowConstructorOptions =
  process.platform === 'darwin'
    ? {
        frame: false,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 12, y: 14 }
      }
    : process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: '#F4EDDF', symbolColor: '#2C2214', height: 44 }
        }
      : { frame: false, titleBarStyle: 'hidden' }

function createWindow(): void {
  allowClose = false
  mainWindow = new BrowserWindow({
    ...windowChrome,
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#FAF5EA',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Cmd+W 由渲染层关闭当前标签，而不是关闭窗口。
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      input.meta &&
      !input.control &&
      !input.alt &&
      input.key.toLowerCase() === 'w'
    ) {
      event.preventDefault()
      mainWindow?.webContents.send('app:close-tab')
    }
  })

  // 关闭窗口只隐藏到托盘；真正退出由托盘菜单或系统退出流程触发，
  // 退出前仍交给渲染层确认未保存标签。
  mainWindow.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    mainWindow?.hide()
  })

  // Windows 注销/关机时不要再拦截关闭。
  mainWindow.on('session-end', () => {
    allowClose = true
  })

  ipcMain.removeHandler('app:confirm-close')
  ipcMain.handle('app:confirm-close', async () => {
    await agentCommands.prepareQuit()
    allowClose = true
    app.quit()
    return { ok: true, data: true }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//.test(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.ELECTRON_RENDERER_URL
    if (allowed && url.startsWith(allowed)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const gotLock =
  process.env.KINDRAAPI_DISABLE_SINGLE_INSTANCE === '1'
    ? true
    : app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('local.kindraapi')
    if (process.platform === 'darwin') app.dock?.setIcon(appIconPath)
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    ensureDefaultProject()
    registerIpc()
    void startMcpServer()
    void startDocServer()
    createWindow()
    createTray()

    app.on('activate', () => {
      showMainWindow()
    })
  })

  // 窗口关闭只是隐藏到托盘，因此不能因窗口全部关闭而退出应用。
  app.on('window-all-closed', () => {
    if (allowClose) app.quit()
  })

  // 系统退出（Cmd+Q、注销等）同样走未保存确认流程。
  app.on('before-quit', (event) => {
    if (allowClose) return
    event.preventDefault()
    requestQuit()
  })

  // will-quit 在所有窗口关闭后触发；若关闭被未保存守卫拦截，不会执行。
  app.on('will-quit', () => {
    shutdownAgent()
    tray?.destroy()
    tray = null
    void shutdownMcp()
    void shutdownDocs()
    shutdownMqtt()
  })
}
