/**
 * electron/key-manager.js
 * Decrypts all secrets from secrets.json at runtime.
 * Only runs in the Electron main process — never exposed to renderer.
 */

'use strict'

const crypto = require('crypto')
const fs     = require('fs')
const path   = require('path')

const PASSPHRASE = 'maya-ai-offline-desktop-2026-v1'
const SALT       = 'maya-secrets-kdf-salt-stable'

function decryptValue(entry, encKey) {
  const iv        = Buffer.from(entry.iv,  'hex')
  const authTag   = Buffer.from(entry.tag, 'hex')
  const encrypted = Buffer.from(entry.enc, 'hex')
  const decipher  = crypto.createDecipheriv('aes-256-gcm', encKey, iv)
  decipher.setAuthTag(authTag)
  const plaintext = decipher.update(encrypted) + decipher.final('utf8')
  const chk = crypto.createHash('sha256').update(plaintext).digest('hex').slice(0, 8)
  if (chk !== entry.chk) throw new Error('Checksum mismatch')
  return plaintext
}

function loadSecrets() {
  const secretsPath = path.join(__dirname, 'secrets.json')
  if (!fs.existsSync(secretsPath)) {
    console.warn('[KeyManager] secrets.json not found')
    return {}
  }
  let secrets
  try { secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8')) }
  catch (e) { console.warn(`[KeyManager] Cannot parse secrets.json: ${e.message}`); return {} }

  if (!secrets.v || !secrets.keys) { console.warn('[KeyManager] Invalid format'); return {} }

  const encKey = crypto.scryptSync(PASSPHRASE, SALT, 32)
  const result = {}
  for (const [key, entry] of Object.entries(secrets.keys)) {
    try { result[key] = decryptValue(entry, encKey) }
    catch (e) { console.warn(`[KeyManager] Failed to decrypt ${key}: ${e.message}`) }
  }
  encKey.fill(0)
  console.log(`[KeyManager] Decrypted: ${Object.keys(result).join(', ')}`)
  return result
}

// User .env always wins over embedded secrets
function getSecrets(dotenvVars = {}) {
  const embedded = loadSecrets()
  const merged   = { ...embedded }
  for (const key of Object.keys(embedded)) {
    const user = dotenvVars[key] || process.env[key]
    if (user && user.trim()) { merged[key] = user.trim() }
  }
  return merged
}

module.exports = { getSecrets }
