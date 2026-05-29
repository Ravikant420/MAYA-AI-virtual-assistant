/**
 * electron/preload.js
 * Secure bridge between Electron main process and React renderer.
 * All IPC calls go through here — contextIsolation enforced.
 */

'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mayaElectron', {

  // ── App info ─────────────────────────────────────────────────────────────
  isPackaged:      () => ipcRenderer.invoke('is-packaged'),
  getDataDir:      () => ipcRenderer.invoke('get-data-dir'),
  getVersion:      () => ipcRenderer.invoke('get-app-version'),
  getBackendURL:   () => ipcRenderer.invoke('get-backend-url'),
  getArchitecture: () => ipcRenderer.invoke('get-architecture'),
  getPlatform:     () => ipcRenderer.invoke('get-platform'),

  // ── Setup ────────────────────────────────────────────────────────────────
  isSetupComplete:  () => ipcRenderer.invoke('is-setup-complete'),
  getInstallStatus: () => ipcRenderer.invoke('get-install-status'),
  runSetup:         () => ipcRenderer.invoke('run-setup'),
  resetSetup:       () => ipcRenderer.invoke('reset-setup'),   // for Reinstall button

  // Listen for setup progress events (returns unsubscribe function)
  onSetupProgress: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.on('setup-progress', handler)
    return () => ipcRenderer.removeListener('setup-progress', handler)
  },

  // ── Backend ──────────────────────────────────────────────────────────────
  waitForBackend:  () => ipcRenderer.invoke('backend-ready'),
  restartBackend:  () => ipcRenderer.invoke('restart-backend'),

  onBackendStatus: (cb) => {
    const handler = (_, status) => cb(status)
    ipcRenderer.on('backend-status', handler)
    return () => ipcRenderer.removeListener('backend-status', handler)
  },

  // ── Permissions ──────────────────────────────────────────────────────────
  checkMicPermission: () => ipcRenderer.invoke('check-mic-permission'),

  // ── Updates ──────────────────────────────────────────────────────────────
  onUpdateStatus: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.removeListener('update-status', handler)
  },

  // ── App control ──────────────────────────────────────────────────────────
  quitApp: () => ipcRenderer.invoke('quit-app'),
  log:     (msg) => ipcRenderer.send('setup-log', String(msg)),
})
