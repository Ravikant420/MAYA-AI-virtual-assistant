/**
 * scripts/afterpack.js
 * Runs automatically after electron-builder packages the app.
 * 1. Copies dist/frontend/ → Resources/frontend/
 * 2. chmod +x backend binary
 * 3. Verifies hey-maya.ppn is present
 */

'use strict'

const fs   = require('fs')
const path = require('path')

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir
  const appName   = context.packager.appInfo.productFilename
  const resDir    = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources')
  const projDir   = context.packager.projectDir

  console.log('\n[afterPack] Running post-pack steps...')

  // ── 1. Copy frontend ──────────────────────────────────────────────────────
  const frontendSrc  = path.join(projDir, 'dist', 'frontend')
  const frontendDest = path.join(resDir, 'frontend')

  if (!fs.existsSync(frontendSrc)) {
    throw new Error(
      `[afterPack] Frontend build missing: ${frontendSrc}\n` +
      `Run: cd frontend && npm run build`
    )
  }

  if (fs.existsSync(frontendDest)) {
    fs.rmSync(frontendDest, { recursive: true, force: true })
  }
  copyDir(frontendSrc, frontendDest)
  console.log(`[afterPack] ✓ Frontend copied (${countFiles(frontendDest)} files)`)

  // Warn if assets still use absolute paths
  const indexPath = path.join(frontendDest, 'index.html')
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, 'utf8')
    if (html.includes('src="/assets/')) {
      console.warn('[afterPack] ⚠ index.html has absolute /assets/ paths — add base:"./" to vite.config.js')
    } else {
      console.log('[afterPack] ✓ index.html uses relative paths')
    }
  }

  // ── 2. chmod backend binary ───────────────────────────────────────────────
  const backendBin = path.join(resDir, 'backend', 'maya-backend', 'maya-backend')
  if (fs.existsSync(backendBin)) {
    fs.chmodSync(backendBin, 0o755)
    console.log('[afterPack] ✓ Backend binary chmod +x')
  } else {
    console.warn(`[afterPack] ⚠ Backend binary not found: ${backendBin}`)
  }

  // ── 3. Verify ppn file ────────────────────────────────────────────────────
  const ppn = path.join(resDir, 'models', 'porcupine', 'hey-maya.ppn')
  console.log(`[afterPack] ${fs.existsSync(ppn) ? '✓ hey-maya.ppn present' : '⚠ hey-maya.ppn not found'}`)

  console.log('[afterPack] Done.\n')
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name)
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d)
  }
}

function countFiles(dir) {
  let n = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1
  }
  return n
}
