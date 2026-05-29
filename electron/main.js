/**
 * electron/main.js
 * Maya Desktop App — Complete Bootstrap System
 */

'use strict'

const { app, BrowserWindow, ipcMain, shell, nativeTheme, Tray, Menu, nativeImage } = require('electron')
const path   = require('path')
const fs     = require('fs')
const http   = require('http')
const https  = require('https')
const zlib   = require('zlib')
const os     = require('os')
const { spawn, execSync } = require('child_process')
const { checkInstalled, findOllama, getPiperURL, PIPER_BIN_NAME } = require('./dependency_checker')
const { getSecrets } = require('./key-manager')

// ── Auto-updater ──────────────────────────────────────────────────────────────
let autoUpdater = null
try {
  autoUpdater = require('electron-updater').autoUpdater
  autoUpdater.autoDownload         = true
  autoUpdater.autoInstallOnAppQuit = true
} catch {}

// ── Paths ─────────────────────────────────────────────────────────────────────
const IS_DEV     = !app.isPackaged
const DATA_DIR   = path.join(app.getPath('userData'), 'Maya')
const SETUP_FLAG = path.join(DATA_DIR, '.setup_complete')
const LOG_FILE   = path.join(DATA_DIR, 'maya.log')
const PIPER_DIR  = path.join(DATA_DIR, 'piper')
const MODELS_DIR = path.join(DATA_DIR, 'models', 'piper')
const BACKEND_BIN = IS_DEV
  ? path.join(__dirname, '../backend/main.py')
  : path.join(process.resourcesPath, 'backend', 'maya-backend', 'maya-backend')

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow     = null
let backendProcess = null
let backendPort    = 8000
let tray           = null

// ── Logger ────────────────────────────────────────────────────────────────────
fs.mkdirSync(DATA_DIR, { recursive: true })
// NEW: Backup the previous session's log before starting a new one
if (fs.existsSync(LOG_FILE)) {
  try { fs.renameSync(LOG_FILE, LOG_FILE + '.bak') } catch {}
}

const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
  console.log(msg)
}

// ── Free port finder ──────────────────────────────────────────────────────────
function findFreePort(start = 8000) {
  return new Promise(resolve => {
    const net = require('net')
    const s   = net.createServer()
    s.listen(start, () => { const p = s.address().port; s.close(() => resolve(p)) })
    s.on('error', () => resolve(findFreePort(start + 1)))
  })
}

// ── Kill any stale process holding a port ────────────────────────────────────
function killPortProcess(port) {
  try {
    const pids = execSync(`lsof -ti tcp:${port} 2>/dev/null || true`, { timeout: 3000, encoding: 'utf8' }).trim()
    if (pids) {
      for (const pid of pids.split('\n').filter(Boolean)) {
        try { execSync(`kill -9 ${pid}`, { timeout: 2000 }); log(`Killed stale PID ${pid} on port ${port}`) } catch {}
      }
    }
  } catch (e) { log(`Port ${port} already clear`) }
}

// ── Ollama process manager ───────────────────────────────────────────────────
let ollamaProcess  = null
let ollamaManaged  = false

function isOllamaRunning() {
  return new Promise(resolve => {
    const req = http.get('http://localhost:11434', { timeout: 2000 }, res => {
      res.resume()
      resolve(true)
    })
    req.on('error',   () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

async function startOllama() {
  if (await isOllamaRunning()) {
    log('Ollama already running — using existing instance')
    ollamaManaged = false
    return true
  }

  const ollamaPath = (() => {
    const { checkInstalled } = require('./dependency_checker')
    const s = checkInstalled(DATA_DIR)
    return s.ollamaPath
  })()

  if (!ollamaPath) {
    log('Ollama binary not found — cannot start')
    return false
  }

  log(`Starting Ollama: ${ollamaPath}`)
  ollamaProcess = spawn(ollamaPath, ['serve'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: require('os').homedir() },
    detached: false,
  })

  ollamaProcess.stdout.on('data', d => {
    const msg = d.toString().trim()
    if (msg) log(`[Ollama] ${msg}`)
  })
  ollamaProcess.stderr.on('data', d => {
    const msg = d.toString().trim()
    if (!msg) return
    const isNoise = msg.includes('level=info') || msg.includes('level=debug') ||
                    msg.includes('WARN[') || msg.includes('msg="')
    if (!isNoise) log(`[Ollama] ${msg}`)
  })

  let portBusy = false

  ollamaProcess.stdout.on('data', d => {
    const msg = d.toString().trim()
    if (msg) log(`[Ollama] ${msg}`)
  })
  ollamaProcess.stderr.on('data', d => {
    const msg = d.toString().trim()
    if (!msg) return
    if (msg.includes('address already in use') || msg.includes('bind:')) {
      portBusy = true
      log(`[Ollama] Port 11434 already in use — Ollama is running`)
    } else if (!msg.includes('level=info') && !msg.includes('level=debug')) {
      log(`[Ollama] ${msg}`)
    }
  })
  ollamaProcess.on('close', code => {
    if (code !== null && code !== 0) log(`Ollama exited (${code})`)
    ollamaProcess = null
  })
  ollamaManaged = true

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500))

    if (portBusy) {
      log('Ollama already running — using existing instance')
      ollamaManaged = false
      return true
    }

    if (await isOllamaRunning()) {
      if (!ollamaProcess) ollamaManaged = false
      log('Ollama ready')
      return true
    }

    if (!ollamaProcess && !portBusy) {
      await new Promise(r => setTimeout(r, 1000))
      const up = await isOllamaRunning()
      log(`Ollama process exited — port 11434: ${up ? 'open ✓' : 'closed ✗'}`)
      if (up) ollamaManaged = false
      return up
    }
  }

  log('Ollama did not respond in time')
  return false
}

function stopOllama() {
  if (!ollamaProcess || !ollamaManaged) return
  log('Stopping Ollama...')
  ollamaProcess.kill('SIGTERM')
  ollamaProcess = null
  ollamaManaged = false
}

// ── Download to disk ──────────────────────────────────────────────────────────
function downloadToDisk(url, destPath, onProgress, maxRetries = 3) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true })

    let attempt    = 0
    let received   = 0
    let total      = 0
    let lastTime   = Date.now()
    let lastBytes  = 0

    function tryDownload(reqUrl, startByte = 0) {
      attempt++
      log(`Download attempt ${attempt}/${maxRetries}: ${reqUrl.split('/').pop()} (from byte ${startByte})`)

      const file    = startByte > 0
        ? fs.createWriteStream(destPath, { flags: 'a' })
        : fs.createWriteStream(destPath)

      const headers = startByte > 0 ? { 'Range': `bytes=${startByte}-` } : {}
      const proto   = reqUrl.startsWith('https') ? https : http
      const options = { timeout: 120000, headers }

      const req = proto.get(reqUrl, options, (res) => {
        if ([301,302,307,308].includes(res.statusCode)) {
          file.close()
          let location = res.headers.location || ''
          if (location && !location.startsWith('http')) {
            try { location = new URL(location, reqUrl).href } catch { location = reqUrl }
          }
          if (!location) return reject(new Error('Redirect with no Location header'))
          return tryDownload(location, startByte)
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          file.close()
          return reject(new Error(`HTTP ${res.statusCode}: ${reqUrl.split('/').pop()}`))
        }

        const contentLen = parseInt(res.headers['content-length'] || '0', 10)
        total    = startByte + contentLen
        received = startByte

        res.pipe(file)
        res.on('data', chunk => {
          received += chunk.length
          const now     = Date.now()
          const elapsed = (now - lastTime) / 1000
          let speed     = 0
          if (elapsed > 0.5) {
            speed     = (received - lastBytes) / elapsed
            lastTime  = now
            lastBytes = received
          }
          onProgress({ received, total, percent: total > 0 ? Math.round(received / total * 100) : 0, speed })
        })

        file.on('finish', () => { file.close(); resolve(destPath) })
        file.on('error', e => { file.close(); handleError(e, reqUrl) })
      })

      req.on('error', e => { file.close(); handleError(e, reqUrl) })
      req.on('timeout', () => { req.destroy(); file.close(); handleError(new Error('Download timed out'), reqUrl) })
    }

    function handleError(err, reqUrl) {
      log(`Download error (attempt ${attempt}): ${err.message}`)
      if (attempt < maxRetries) {
        const partial = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0
        const delay   = attempt * 3000
        log(`Retrying in ${delay/1000}s from byte ${partial}...`)
        setTimeout(() => tryDownload(reqUrl, partial), delay)
      } else {
        try { fs.unlinkSync(destPath) } catch {}
        reject(new Error(`Download failed after ${maxRetries} attempts: ${err.message}`))
      }
    }

    tryDownload(url, 0)
  })
}

// ── Extract tar.gz ────────────────────────────────────────────────────────────
function extractTarGz(tarPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true })
    let buf = Buffer.alloc(0)

    const read   = fs.createReadStream(tarPath)
    const gunzip = zlib.createGunzip()
    read.pipe(gunzip)
    gunzip.on('data', chunk => { buf = Buffer.concat([buf, chunk]) })
    gunzip.on('error', reject)
    read.on('error', reject)

    gunzip.on('end', () => {
      let offset = 0
      while (offset + 512 <= buf.length) {
        const header  = buf.slice(offset, offset + 512)
        const name    = header.slice(0, 100).toString('utf8').replace(/\0+$/, '')
        const sizeOct = header.slice(124, 136).toString('utf8').replace(/\0+$/, '')
        const size    = parseInt(sizeOct, 8) || 0
        const type    = String.fromCharCode(header[156])
        offset += 512
        if (!name || name === '.' || name === './' || name === '\0') { offset += Math.ceil(size/512)*512; continue }
        const clean = name.replace(/^\.?\/?piper\//,'').replace(/^\.?\//,'')
        if (!clean) { offset += Math.ceil(size/512)*512; continue }
        const dest = path.join(destDir, clean)
        if (type === '5' || name.endsWith('/') || (size === 0 && !path.extname(name))) {
          fs.mkdirSync(dest, { recursive: true })
        } else {
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.writeFileSync(dest, buf.slice(offset, offset + size))
          if (clean === PIPER_BIN_NAME) { try { fs.chmodSync(dest, 0o755) } catch {} }
        }
        offset += Math.ceil(size/512)*512
      }
      const bin = path.join(destDir, PIPER_BIN_NAME)
      if (fs.existsSync(bin)) {
        try { fs.chmodSync(bin, 0o755) } catch {}
        log(`Piper extracted: ${bin}`)
        resolve(bin)
      } else {
        const found = fs.existsSync(destDir) ? fs.readdirSync(destDir) : []
        reject(new Error(`${PIPER_BIN_NAME} not found. Extracted: ${found.join(', ')}`))
      }
    })
  })
}

// ── Extract zip ───────────────────────────────────────────────────────────────
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell', ['-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`])
    ps.on('close', code => {
      if (code !== 0) return reject(new Error(`PowerShell unzip failed: ${code}`))
      const bin = path.join(destDir, 'piper', PIPER_BIN_NAME)
      if (fs.existsSync(bin)) resolve(bin)
      else reject(new Error('piper.exe not found after extraction'))
    })
    ps.on('error', reject)
  })
}

// ── Read .env ─────────────────────────────────────────────────────────────────
function readDotEnv() {
  const candidates = [
    path.join(__dirname, '../backend/.env'),
    path.join(DATA_DIR, '.env'),
  ]
  const vars = {}
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i < 0) continue
      const k = t.slice(0, i).trim()
      const v = t.slice(i+1).trim().replace(/^['"]|['"]$/g, '')
      if (k) vars[k] = v
    }
    log(`.env loaded from: ${p}`)
    break
  }
  return vars
}

// ══════════════════════════════════════════════════════════════════════════════
// IPC — Setup detection
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('is-setup-complete', () => {
  if (fs.existsSync(SETUP_FLAG)) {
    log('Setup flag exists — skipping setup')
    return true
  }
  const s = checkInstalled(DATA_DIR)
  log(`Check: ollama=${s.ollama} model=${s.model} piper_bin=${s.piper_bin} piper_en=${s.piper_en} piper_hi=${s.piper_hi}`)
  if (s.allDone) {
    log('All components present — writing flag')
    fs.writeFileSync(SETUP_FLAG, new Date().toISOString())
    return true
  }
  log(`Missing: ${['ollama','model','piper_bin','piper_en','piper_hi'].filter(k => !s[k]).join(', ')}`)
  return false
})

ipcMain.handle('get-install-status', () => {
  const s = checkInstalled(DATA_DIR)
  return { ollama: s.ollama, model: s.model, piper_bin: s.piper_bin, piper_en: s.piper_en, piper_hi: s.piper_hi }
})

// ══════════════════════════════════════════════════════════════════════════════
// IPC — Setup runner
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('run-setup', async () => {
  const send = data => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('setup-progress', data)
  }
  const prog = (id, pct, speed=0, recv=0, tot=0) =>
    send({ type:'progress', stepId:id, percent:pct, speed, received:recv, total:tot })
  const stat = (id, state, msg='') => {
    send({ type:'status', stepId:id, state, message:msg })
    log(`[Setup] ${id} → ${state} ${msg}`)
  }

  try {
    fs.mkdirSync(MODELS_DIR, { recursive: true })
    fs.mkdirSync(PIPER_DIR,  { recursive: true })

    const installed = checkInstalled(DATA_DIR)

    stat('ollama', 'active', 'Checking Ollama...')
    if (!installed.ollama) {
      stat('ollama', 'error', 'Ollama not found — install from ollama.com')
      return { ok: false, error: 'Ollama not installed. Download from https://ollama.com and retry.' }
    }
    const ollamaPath = installed.ollamaPath
    log(`Ollama: ${ollamaPath}`)
    prog('ollama', 100)
    stat('ollama', 'done', ollamaPath)

    if (installed.model) {
      prog('model', 100)
      stat('model', 'done', 'Already downloaded')
    } else {
      stat('model', 'active', 'Pulling llama3.2...')
      await new Promise((resolve, reject) => {
        const pull = spawn(ollamaPath, ['pull', 'llama3.2'], {
          stdio: ['ignore','pipe','pipe'],
          env: { ...process.env, HOME: os.homedir() }
        })
        pull.stdout.on('data', d => {
          const line  = d.toString().trim()
          const match = line.match(/(\d+)%/)
          if (match) prog('model', parseInt(match[1]))
          if (line)  stat('model', 'active', line.slice(0, 70))
        })
        pull.stderr.on('data', d => log(`[ollama] ${d.toString().trim()}`))
        pull.on('close', code => code === 0 ? resolve() : reject(new Error(`ollama pull exited ${code}`)))
        pull.on('error', reject)
      })
      prog('model', 100)
      stat('model', 'done')
    }

    const piperBin = path.join(PIPER_DIR, PIPER_BIN_NAME)
    if (installed.piper_bin) {
      prog('piper_bin', 100)
      stat('piper_bin', 'done', 'Already installed')
    } else {
      const url     = getPiperURL()
      const isZip   = url.endsWith('.zip')
      const tarDest = path.join(PIPER_DIR, isZip ? 'piper.zip' : 'piper.tar.gz')
      stat('piper_bin', 'active', `Downloading Piper (${process.arch})...`)
      await downloadToDisk(url, tarDest, p =>
        prog('piper_bin', Math.round(p.percent * 0.88), p.speed, p.received, p.total)
      )
      stat('piper_bin', 'active', 'Extracting...')
      if (isZip) await extractZip(tarDest, PIPER_DIR)
      else        await extractTarGz(tarDest, PIPER_DIR)
      try { fs.unlinkSync(tarDest) } catch {}
      prog('piper_bin', 100)
      stat('piper_bin', 'done')
    }

    const enOnnx = path.join(MODELS_DIR, 'en_US-lessac-medium.onnx')
    if (installed.piper_en) {
      prog('piper_en', 100)
      stat('piper_en', 'done', 'Already downloaded')
    } else {
      stat('piper_en', 'active', 'Downloading English voice model...')
      const base = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium'
      await downloadToDisk(`${base}/en_US-lessac-medium.onnx?download=true`,      enOnnx,         p => prog('piper_en', Math.round(p.percent*0.98), p.speed, p.received, p.total))
      await downloadToDisk(`${base}/en_US-lessac-medium.onnx.json?download=true`, enOnnx+'.json', () => {})
      prog('piper_en', 100)
      stat('piper_en', 'done')
    }

    const hiOnnx = path.join(MODELS_DIR, 'hi_IN-priyamvada-medium.onnx')
    if (installed.piper_hi) {
      prog('piper_hi', 100)
      stat('piper_hi', 'done', 'Already downloaded')
    } else {
      stat('piper_hi', 'active', 'Downloading Hindi voice model...')
      const base = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/priyamvada/medium'
      await downloadToDisk(`${base}/hi_IN-priyamvada-medium.onnx?download=true`,      hiOnnx,         p => prog('piper_hi', Math.round(p.percent*0.98), p.speed, p.received, p.total))
      await downloadToDisk(`${base}/hi_IN-priyamvada-medium.onnx.json?download=true`, hiOnnx+'.json', () => {})
      prog('piper_hi', 100)
      stat('piper_hi', 'done')
    }

    fs.writeFileSync(SETUP_FLAG, new Date().toISOString())
    send({ type: 'complete' })
    log('Setup complete')
    return { ok: true }

  } catch (err) {
    log(`Setup error: ${err.message}`)
    send({ type: 'error', message: err.message })
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('reset-setup', async () => {
  try { fs.unlinkSync(SETUP_FLAG) } catch {}
  log('Setup flag cleared — reinstall triggered')
  return { ok: true }
})

// ══════════════════════════════════════════════════════════════════════════════
// Backend process management
// ══════════════════════════════════════════════════════════════════════════════

async function startBackend() {
  if (backendProcess) return

  // ── FIX: Kill stale backend from previous run before checking port ─────────
  log('Clearing port 8000...')
  killPortProcess(8000)
  await new Promise(r => setTimeout(r, 400))
  // ── END FIX ───────────────────────────────────────────────────────────────

  backendPort = await findFreePort(8000)
  if (backendPort !== 8000) log(`Port 8000 busy — using ${backendPort}`)
  log(`Starting backend on :${backendPort}`)

  const dotenv  = readDotEnv()
  const secrets = getSecrets(dotenv)

  const env = {
    ...process.env,
    ...dotenv,
    ...secrets,
    TRANSFORMERS_OFFLINE: "1",
    HF_DATASETS_OFFLINE: "1",
    MAYA_DATA_DIR:  DATA_DIR,
    MAYA_ENV:       IS_DEV ? 'development' : 'production',
    MAYA_PORT:      String(backendPort),
    OLLAMA_HOST:    'http://localhost:11434',
    PIPER_MODEL_EN: path.join(MODELS_DIR, 'en_US-lessac-medium.onnx'),
    PIPER_MODEL_HI: path.join(MODELS_DIR, 'hi_IN-priyamvada-medium.onnx'),
    MAYA_DB_PATH:   path.join(DATA_DIR, 'maya.db'),
    MAYA_FAISS_DIR: path.join(DATA_DIR, 'faiss_index'),
    PORCUPINE_KEYWORD_PATH: (() => {
      if (secrets.PORCUPINE_KEYWORD_PATH && fs.existsSync(secrets.PORCUPINE_KEYWORD_PATH))
        return secrets.PORCUPINE_KEYWORD_PATH
      const bundled = path.join(process.resourcesPath, 'models', 'porcupine', 'hey-maya.ppn')
      if (fs.existsSync(bundled)) return bundled
      return path.join(__dirname, '../backend/models/porcupine/hey-maya.ppn')
    })(),
  }

  if (IS_DEV) {
    backendProcess = spawn('python3', [BACKEND_BIN], {
        cwd: path.join(__dirname, '../backend'), env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } else {
    try { fs.chmodSync(BACKEND_BIN, 0o755) } catch {}
      backendProcess = spawn(BACKEND_BIN, [], {
        cwd: path.dirname(BACKEND_BIN), env,
        stdio: ['ignore', 'pipe', 'pipe']
    })
    }

  backendProcess.stdout.on('data', d => log(`[Backend] ${d.toString().trim()}`))
  backendProcess.stderr.on('data', d => log(`[Backend ERR] ${d.toString().trim()}`))
  backendProcess.on('close', code => {
    log(`Backend exited (${code})`)
    backendProcess = null
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('backend-status', 'disconnected')
  })
}

function stopBackend() {
  if (!backendProcess) return
  log('Stopping backend...')
  backendProcess.kill('SIGTERM')
  backendProcess = null
}

function waitForBackend(retries = 60, delay = 1000) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const check = n => {
        const req = http.get(`http://127.0.0.1:${backendPort}/system_status`, { timeout: 3000 }, res => {
          res.resume()
          if (res.statusCode === 200) { log('Backend ready'); resolve() }
          else if (n > 0) setTimeout(() => check(n-1), delay)
          else reject(new Error(`Backend returned ${res.statusCode}`))
        })
        req.on('error', () => n > 0 ? setTimeout(() => check(n-1), delay) : reject(new Error('Backend unreachable')))
        req.on('timeout', () => { req.destroy(); n > 0 ? setTimeout(() => check(n-1), delay) : reject(new Error('Timeout')) })
      }
      check(retries)
    }, 2000)
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// IPC — All handlers
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('is-packaged',       () => app.isPackaged)
ipcMain.handle('get-data-dir',      () => DATA_DIR)
ipcMain.handle('get-backend-url',   () => `http://127.0.0.1:${backendPort}`)
ipcMain.handle('get-app-version',   () => app.getVersion())
ipcMain.handle('get-architecture',  () => process.arch)
ipcMain.handle('get-platform',      () => process.platform)
ipcMain.handle('quit-app',          () => app.quit())
ipcMain.on('setup-log', (_, msg)    => log(`[Setup] ${msg}`))

ipcMain.handle('restart-backend', async () => {
  stopBackend()
  await new Promise(r => setTimeout(r, 1000))
  await startBackend()
  return true
})

ipcMain.handle('backend-ready', async () => {
  try {
    await waitForBackend()
    if (mainWindow) mainWindow.webContents.send('backend-status', 'connected')
    return true
  } catch { return false }
})

ipcMain.handle('check-mic-permission', async () => {
  if (process.platform !== 'darwin') return 'granted'
  try {
    const { systemPreferences } = require('electron')
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'not-determined') {
      return await systemPreferences.askForMediaAccess('microphone') ? 'granted' : 'denied'
    }
    return status
  } catch { return 'unknown' }
})

// ══════════════════════════════════════════════════════════════════════════════
// Window
// ══════════════════════════════════════════════════════════════════════════════

function createWindow() {
  nativeTheme.themeSource = 'dark'

  const savedState = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR,'window.json'),'utf8')) }
    catch { return { w:1280, h:820 } }
  })()

  mainWindow = new BrowserWindow({
    width:       savedState.w || 1280,
    height:      savedState.h || 820,
    x:           savedState.x,
    y:           savedState.y,
    minWidth:    900,
    minHeight:   600,
    titleBarStyle:   'hiddenInset',
    trafficLightPosition: { x:16, y:18 },
    backgroundColor: '#070B0F',
    show:            false,
    webPreferences: {
      preload:         path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      devTools:         true,
      webSecurity:      false,
    }
  })

  mainWindow.webContents.on('console-message', (_, level, msg, line, src) => {
    const tags = ['verbose','info','warn','error']
    log(`[UI:${tags[level]||level}] ${msg}`)
  })

  mainWindow.webContents.on('did-fail-load', (_, code, desc, url) => {
    log(`LOAD FAILED: ${desc} (${code}) — ${url}`)
    mainWindow.webContents.loadURL(`data:text/html,
      <body style="background:%23070B0F;color:%23F0FDFA;font-family:sans-serif;padding:40px;margin:0">
      <h2 style="color:%23F87171">Maya — UI failed to load</h2>
      <p style="color:%23475569">Error ${code}: ${desc}</p>
      <p style="color:%23475569">URL: ${url}</p>
      <p style="color:%23334155;font-size:12px">Log: ${LOG_FILE}</p>
      </body>`)
  })

  if (IS_DEV) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    const idx = path.join(process.resourcesPath, 'frontend', 'index.html')
    log(`Loading UI: ${idx}`)
    mainWindow.loadFile(idx)
  }

  mainWindow.once('ready-to-show', () => { mainWindow.show(); mainWindow.focus() })

  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isMinimized() && !mainWindow.isMaximized()) {
      const [w,h] = mainWindow.getSize()
      const [x,y] = mainWindow.getPosition()
      try { fs.writeFileSync(path.join(DATA_DIR,'window.json'), JSON.stringify({w,h,x,y})) } catch {}
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action:'deny' } })
}

// ══════════════════════════════════════════════════════════════════════════════
// Tray
// ══════════════════════════════════════════════════════════════════════════════

function createTray() {
  try {
    const icon = nativeImage.createEmpty()
    tray = new Tray(icon)
    tray.setToolTip('Maya AI')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Maya', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } else createWindow() } },
      { type:  'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]))
    tray.on('click', () => {
      if (mainWindow) { mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show() }
      else createWindow()
    })
  } catch (e) { log(`Tray error: ${e.message}`) }
}

// ══════════════════════════════════════════════════════════════════════════════
// Menu
// ══════════════════════════════════════════════════════════════════════════════

function createMenu() {
  const { Menu } = require('electron')
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Maya', submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
    ]},
    { label: 'Edit', submenu: [
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ]},
    { label: 'View', submenu: [
      { role: 'reload',         visible: IS_DEV },
      { role: 'toggleDevTools', visible: IS_DEV },
      { role: 'togglefullscreen' },
    ]},
    { label: 'Window', submenu: [
      { role: 'minimize' }, { role: 'zoom' }, { role: 'front' },
    ]},
  ]))
}

// ══════════════════════════════════════════════════════════════════════════════
// App lifecycle
// ══════════════════════════════════════════════════════════════════════════════

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() }
  })
}

app.whenReady().then(async () => {
  log(`Maya ${app.getVersion()} starting | dev=${IS_DEV} | ${process.platform}/${process.arch}`)

  createMenu()
  createWindow()
  createTray()

  log('Starting Ollama...')
  const ollamaStarted = await startOllama()
  if (!ollamaStarted) log('WARNING: Ollama could not be started — chat will fail')

  await startBackend()
  waitForBackend()
    .then(() => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('backend-status', 'connected')
    })
    .catch(e => log(`Backend wait failed: ${e.message}`))

  if (autoUpdater && app.isPackaged) {
    const updateYml = path.join(process.resourcesPath, 'app-update.yml')
    if (fs.existsSync(updateYml)) {
      const notifyUpdate = data => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send('update-status', data)
      }
      autoUpdater.on('update-available',  i => { log(`Update: v${i.version}`); notifyUpdate({ version: i.version }) })
      autoUpdater.on('download-progress', p => notifyUpdate({ version: p.version, downloading: true, percent: Math.round(p.percent) }))
      autoUpdater.on('update-downloaded', i => { log(`Update ready: v${i.version}`); notifyUpdate({ version: i.version, ready: true }) })
      autoUpdater.on('error', e => log(`Updater: ${e.message}`))
      setTimeout(() => autoUpdater.checkForUpdates().catch(e => log(`Update check: ${e.message}`)), 10000)
      log('Auto-updater enabled')
    } else {
      log('Auto-updater skipped — app-update.yml not found (manual install)')
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else if (mainWindow) { mainWindow.show(); mainWindow.focus() }
  })
})

app.on('before-quit', () => {
  log('Quitting — stopping services')
  stopBackend()
  stopOllama()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { stopBackend(); app.quit() }
})