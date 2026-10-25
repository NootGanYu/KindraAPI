import { app, BrowserWindow, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { applyDebugSwitch, ensureDefaultProject } from './storage/store'
import { shutdownMcp, startMcpServer } from './mcp/server'
import { shutdownDocs, startDocServer } from './docs/server'

const appData = app.getPath('appData')
const legacyUserData = path.join(appData, 'api-workbench')
const openPostUserData = path.join(appData, 'openPost')
if (!process.env.OPENPOST_USER_DATA && !fs.existsSync(openPostUserData) && fs.existsSync(legacyUserData)) {
  try {
    fs.cpSync(legacyUserData, openPostUserData, { recursive: true })
  } catch (error) {
    console.error('Failed to migrate api-workbench data to openPost:', error)
  }
}
app.setName('openPost')
// 测试/自动化使用独立 userData，避免污染真实项目。
app.setPath('userData', process.env.OPENPOST_USER_DATA || openPostUserData)

// 远程调试开关在启动阶段生效，必须在 app ready 之前读取配置。
applyDebugSwitch()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#FAF5EA',
    trafficLightPosition: { x: 12, y: 14 },
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
  process.env.OPENPOST_DISABLE_SINGLE_INSTANCE === '1'
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
    electronApp.setAppUserModelId('local.openpost')
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
  })
}
