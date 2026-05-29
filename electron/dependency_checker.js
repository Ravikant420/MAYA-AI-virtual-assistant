/**
 * electron/dependency_checker.js
 * Platform-aware dependency detection for Maya.
 * Checks all 5 components: Ollama, LLM model, Piper binary, EN voice, HI voice.
 * No network calls — pure filesystem + subprocess checks.
 */

'use strict'

const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { execSync } = require('child_process')

// ── Platform detection ────────────────────────────────────────────────────────
const PLATFORM = process.platform  // 'darwin' | 'win32' | 'linux'
const ARCH     = process.arch      // 'arm64' | 'x64'
const HOME     = os.homedir()

// ── Ollama binary locations per platform ──────────────────────────────────────
const OLLAMA_PATHS = {
  darwin: [
    '/usr/local/bin/ollama',
    '/opt/homebrew/bin/ollama',
    path.join(HOME, '.local/bin/ollama'),
    '/usr/bin/ollama',
  ],
  win32: [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Ollama', 'ollama.exe'),
    'C:\\Ollama\\ollama.exe',
  ],
  linux: [
    '/usr/local/bin/ollama',
    '/usr/bin/ollama',
    path.join(HOME, '.local/bin/ollama'),
    path.join(HOME, 'bin/ollama'),
  ],
}

// ── Piper binary names per platform ───────────────────────────────────────────
const PIPER_BIN_NAME = PLATFORM === 'win32' ? 'piper.exe' : 'piper'

// ── Data directory helper ──────────────────────────────────────────────────────
function getDataDir(userDataPath) {
  return path.join(userDataPath, 'Maya')
}

// ── Find Ollama binary ─────────────────────────────────────────────────────────
function findOllama() {
  const candidates = OLLAMA_PATHS[PLATFORM] || OLLAMA_PATHS.linux

  // Check known paths
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {}
  }

  // Fallback: which/where command with expanded PATH
  try {
    const PATH_EXT = PLATFORM === 'darwin'
      ? '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/opt/local/bin'
      : PLATFORM === 'win32'
      ? `${process.env.PATH};C:\\Ollama`
      : '/usr/local/bin:/usr/bin:/bin'

    const cmd = PLATFORM === 'win32' ? 'where ollama.exe' : 'which ollama'
    
    // execSync will throw if the command fails (e.g., Ollama not found)
    const rawOutput = execSync(cmd, {
      stdio: 'pipe',
      timeout: 3000,
      env: { ...process.env, PATH: PATH_EXT }
    }).toString()
    
    // Split by newlines, grab the first result, and violently strip all whitespace/hidden chars
    const result = rawOutput.split(/\r?\n/)[0].trim()

    if (result && fs.existsSync(result)) return result
  } catch (e) {
    // Command failed (Ollama not in PATH)
  }

  return null
}

// ── Check Ollama model exists ──────────────────────────────────────────────────
function checkOllamaModel(ollamaPath) {
  if (!ollamaPath) return false
  try {
    const out = execSync(`"${ollamaPath}" list`, {
      stdio: 'pipe',
      timeout: 8000,
      env: { ...process.env, HOME, USERPROFILE: HOME }
    }).toString().toLowerCase()
    // Accept any llama variant: llama3.2, llama3:8b, llama2, etc.
    return out.includes('llama')
  } catch {
    return false
  }
}

// ── Check file exists with minimum size ───────────────────────────────────────
function fileOk(filePath, minBytes = 1000) {
  try {
    const stat = fs.statSync(filePath)
    return stat.isFile() && stat.size >= minBytes
  } catch {
    return false
  }
}

// ── Check binary is executable ────────────────────────────────────────────────
function isExecutable(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false
    if (PLATFORM !== 'win32') {
      fs.accessSync(filePath, fs.constants.X_OK)
    }
    return fs.statSync(filePath).size > 10000
  } catch {
    return false
  }
}

// ── Main check function ────────────────────────────────────────────────────────
function checkInstalled(dataDir) {
  const piperDir  = path.join(dataDir, 'piper')
  const modelsDir = path.join(dataDir, 'models', 'piper')
  const piperBin  = path.join(piperDir,  PIPER_BIN_NAME)
  const piperEn   = path.join(modelsDir, 'en_US-lessac-medium.onnx')
  const piperHi   = path.join(modelsDir, 'hi_IN-priyamvada-medium.onnx')

  const ollamaPath   = findOllama()
  const ollamaOk     = !!ollamaPath
  const modelOk      = checkOllamaModel(ollamaPath)
  const piperBinOk   = isExecutable(piperBin)
  const piperEnOk    = fileOk(piperEn, 10_000_000)   // ~60MB
  const piperHiOk    = fileOk(piperHi, 10_000_000)   // ~60MB

  return {
    platform:     PLATFORM,
    arch:         ARCH,
    ollama:       ollamaOk,
    ollamaPath:   ollamaPath,
    model:        modelOk,
    piper_bin:    piperBinOk,
    piper_en:     piperEnOk,
    piper_hi:     piperHiOk,
    allDone:      ollamaOk && modelOk && piperBinOk && piperEnOk && piperHiOk,
    // Paths for reference
    paths: { piperBin, piperEn, piperHi, piperDir, modelsDir }
  }
}

// ── Piper download URL per platform/arch ──────────────────────────────────────
function getPiperURL() {
  const VER = '2023.11.14-2'
  const base = `https://github.com/rhasspy/piper/releases/download/${VER}`

  if (PLATFORM === 'darwin') {
    const a = ARCH === 'arm64' ? 'aarch64' : 'x86_64'
    return `${base}/piper_macos_${a}.tar.gz`
  }
  if (PLATFORM === 'win32') {
    return `${base}/piper_windows_amd64.zip`
  }
  // Linux
  const a = ARCH === 'arm64' ? 'aarch64' : 'x86_64'
  return `${base}/piper_linux_${a}.tar.gz`
}

module.exports = {
  checkInstalled,
  findOllama,
  checkOllamaModel,
  getPiperURL,
  PIPER_BIN_NAME,
  PLATFORM,
  ARCH,
}
