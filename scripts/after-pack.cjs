const { execFileSync } = require('node:child_process')
const path = require('node:path')

// electron-builder skips signing when mac.identity is null. Without any
// signature the packaged bundle only carries Electron's linker signature,
// which no longer matches the added resources and makes Gatekeeper report
// the app as damaged. Re-sign ad-hoc so the bundle is internally valid.
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )
  console.log(`ad-hoc signing ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit'
  })
}
