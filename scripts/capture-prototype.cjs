'use strict'
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.disableHardwareAcceleration()
app.dock?.hide()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 1000,
    show: false,
    webPreferences: { backgroundThrottling: false }
  })
  await win.loadFile(path.join(__dirname, '..', 'prototype', 'ui-1to1-debug.html'))
  await new Promise((resolve) => setTimeout(resolve, 900))
  const rect = await win.webContents.executeJavaScript(
    `(() => { const r = document.getElementById('designWrap').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })()`
  )
  const image = await win.webContents.capturePage(rect)
  const resized = image.resize({ width: 1162, height: 656 })
  fs.writeFileSync('/tmp/our-design.png', resized.toPNG())
  console.log('captured', JSON.stringify(rect), 'image', resized.getSize())
  app.quit()
})
