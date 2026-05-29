/**
 * scripts/encrypt-secrets.js
 * Run ONCE before building to encrypt all sensitive keys.
 *
 * Usage:
 *   PORCUPINE_KEY=xxx \
 *   PORCUPINE_KEYWORD_PATH=/path/to/hey-maya.ppn \
 *   GEMINI_API_KEY=xxx \
 *   WHISPER_MODEL=small \
 *   node scripts/encrypt-secrets.js
 *
 * Or create a local .secrets.env file (never commit this):
 *   node scripts/encrypt-secrets.js --from-file .secrets.env
 *
 * Writes: electron/secrets.json  (safe to commit — encrypted)
 */

'use strict'

const crypto = require('crypto')
const fs     = require('fs')
const path   = require('path')

// ── Must match key-manager.js exactly ─────────────────────────────────────
const PASSPHRASE = 'maya-ai-offline-desktop-2026-v1'
const SALT       = 'maya-secrets-kdf-salt-stable'

// ── Keys to encrypt ────────────────────────────────────────────────────────
const SECRET_KEYS = [
  'PORCUPINE_KEY',
  'GEMINI_API_KEY',
  'WHISPER_MODEL',
  'OPENAI_API_KEY',
]

// ── Load from file if --from-file flag passed ──────────────────────────────
function loadFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌  File not found: ${filePath}`)
    process.exit(1)
  }
  const vars = {}
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
    if (k) vars[k] = v
  }
  return vars
}

// ── Encrypt a single value ─────────────────────────────────────────────────
function encryptValue(plaintext, encKey) {
  const iv      = crypto.randomBytes(12)
  const cipher  = crypto.createCipheriv('aes-256-gcm', encKey, iv)
  const enc     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag     = cipher.getAuthTag()
  const chk     = crypto.createHash('sha256').update(plaintext).digest('hex').slice(0, 8)
  return {
    iv:  iv.toString('hex'),
    tag: tag.toString('hex'),
    enc: enc.toString('hex'),
    chk,
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
const fileIdx = process.argv.indexOf('--from-file')
const source  = fileIdx >= 0 ? loadFromFile(process.argv[fileIdx + 1]) : process.env

const encKey  = crypto.scryptSync(PASSPHRASE, SALT, 32)
const secrets = { v: 2, keys: {} }
const missing = []
const found   = []

for (const key of SECRET_KEYS) {
  const val = source[key]
  if (!val || val.trim() === '') {
    missing.push(key)
    continue
  }
  secrets.keys[key] = encryptValue(val.trim(), encKey)
  found.push(key)
}

encKey.fill(0)   // zero from memory immediately

if (found.length === 0) {
  console.error('❌  No secrets found. Set env vars or use --from-file.')
  console.error(`    Expected: ${SECRET_KEYS.join(', ')}`)
  process.exit(1)
}

const outPath = path.join(__dirname, '../electron/secrets.json')
fs.writeFileSync(outPath, JSON.stringify(secrets, null, 2))

console.log('')
console.log('✅  Secrets encrypted successfully')
console.log(`    Written to: ${outPath}`)
console.log('')
console.log('   Encrypted:')
found.forEach(k => console.log(`     ✓ ${k}`))
if (missing.length > 0) {
  console.log('')
  console.log('   Skipped (not provided):')
  missing.forEach(k => console.log(`     - ${k}`))
}
console.log('')
console.log('📌  secrets.json is SAFE to commit — no plaintext inside.')
console.log('⚠️   Never commit .secrets.env or your actual keys.')
