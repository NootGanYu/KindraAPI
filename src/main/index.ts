import { app, BrowserWindow, shell } from 'electron'
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
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    void shutdownMcp()
    void shutdownDocs()
    shutdownMqtt()
  })
}
