// src/services/api.js
import axios from 'axios'

// ── Detect runtime environment ────────────────────────────────────────────────
const isElectron = typeof window !== 'undefined' && !!window.mayaElectron
const isFile     = typeof window !== 'undefined' && window.location.protocol === 'file:'

// In Electron (file:// protocol) always use localhost directly
// In dev (Vite proxy) use relative or env var
const BASE_URL = import.meta.env.VITE_API_URL
  || (isElectron || isFile ? 'http://127.0.0.1:8000' : 'http://localhost:8000')

export const WS_URL = import.meta.env.VITE_WS_URL
  || (isElectron || isFile
    ? 'ws://127.0.0.1:8000'                         // Electron — always localhost
    : window.location.hostname === 'localhost'
      ? 'ws://localhost:8000'                        // Dev mode
      : `wss://${window.location.host}`)             // Production web

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 60000,
})

// Request logger
api.interceptors.request.use(req => {
  console.debug(`[API] ${req.method?.toUpperCase()} ${req.url}`)
  return req
})

// Response logger
api.interceptors.response.use(
  res => {
    console.debug(`[API] ${res.config.method?.toUpperCase()} ${res.config.url} → ${res.status} (${res.headers['x-response-time'] || '?'}ms)`)
    return res
  },
  err => {
    const status = err.response?.status
    const url = err.config?.url
    console.error(`[API] ${err.config?.method?.toUpperCase()} ${url} → ${status}`)
    return Promise.reject(err)
  }
)

export const mayaApi = {
  ping:           ()       => api.get('/ping'),
  getStatus:      ()       => api.get('/system_status'),
  createSession:  (mode)   => api.post('/session', { mode }),
  listSessions:   ()       => api.get('/sessions'),
  sendMessage:    (data)   => api.post('/chat', data),
  switchMode:     (data)   => api.post('/switch_mode', data),
  resetSession:   (sid)    => api.post('/reset', { session_id: sid }),
  exportChat:     (sid)    => api.post('/export', { session_id: sid }),
  getReminders:   ()       => api.get('/reminders'),
  deleteReminder: (id)     => api.delete(`/reminders/${id}`),
  getNotes:       ()       => api.get('/notes'),
  listTools:      ()       => api.get('/tools'),
  uploadDocument: (file)   => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/upload_document', form)
  },
  switchModel:    (model)  => api.post('/api/model/switch', { model }),
  currentModel:   ()       => api.get('/api/model/current'),
}
