// src/hooks/useVoice.js
import { useEffect, useRef, useState } from 'react'

const WAKE_WORDS = ['hi maya', 'hey maya', 'maya']

// Detect Electron packaged app (file:// protocol)
const IS_ELECTRON = typeof window !== 'undefined' && !!window.mayaElectron
const IS_FILE     = typeof window !== 'undefined' && window.location.protocol === 'file:'

// WebSocket URL — always use 127.0.0.1 in Electron
const WS_BASE =
  import.meta.env.VITE_WS_URL ||
  (IS_ELECTRON || IS_FILE
    ? 'ws://127.0.0.1:8000'           // Electron — direct, no proxy needed
    : window.location.hostname === 'localhost'
      ? 'ws://localhost:8000'          // Dev mode with Vite proxy
      : `wss://${window.location.host}`)

// In Electron, backend Porcupine handles wake word detection via WebSocket.
// Browser SpeechRecognition wake mode requires internet (Google servers) and
// fails with "network" error under file:// protocol — so we disable it.
// Command capture (after wake) still uses SpeechRecognition — that works fine.
const USE_BROWSER_WAKE = !IS_ELECTRON && !IS_FILE

// ─── Module-level singletons ───────────────────────────────────────────────
let _ws        = null
let _rec       = null
let _listening = false
let _booted    = false

const waitForTTS = () =>
  new Promise(resolve => {
    if (!window.speechSynthesis.speaking) return resolve()
    const t = setInterval(() => {
      if (!window.speechSynthesis.speaking) { clearInterval(t); resolve() }
    }, 100)
    setTimeout(() => { clearInterval(t); resolve() }, 20000)
  })

const notifyDone = () => {
  if (_ws?.readyState === WebSocket.OPEN)
    _ws.send(JSON.stringify({ type: 'command_done' }))
}

const stopCurrent = () => {
  if (_rec) {
    try { _rec.stop() } catch (_) {}
    _rec = null
  }
  _listening = false
}

// Check if a single utterance contains a wake word
const hasWakeWord = (text) => {
  const clean = text.toLowerCase().replace(/[^a-z\s]/g, '').trim()
  return WAKE_WORDS.some(w => clean === w || clean.includes(w))
}

// ─── Hook ──────────────────────────────────────────────────────────────────
export function useVoice({ onCommand, onWake, onModeSwitch }) {
  const [active,  setActive]  = useState(false)
  const [wsReady, setWsReady] = useState(false)

  const cbRef        = useRef({ onCommand, onWake, onModeSwitch })
  const startWakeRef = useRef(null)
  const startCmdRef  = useRef(null)

  useEffect(() => {
    cbRef.current = { onCommand, onWake, onModeSwitch }
  }, [onCommand, onWake, onModeSwitch])

  // ── Trigger wake instantly ────────────────────────────────────────────
  const triggerWake = () => {
    setActive(true)
    cbRef.current.onWake?.()
    window.speechSynthesis.cancel()
    stopCurrent()
    startCmdRef.current?.()
  }

  // ── WAKE mode ─────────────────────────────────────────────────────────
  const startWake = () => {
    if (_listening) return

    // In Electron/packaged app: backend Porcupine handles wake word via WebSocket.
    // Browser SpeechRecognition wake mode fails with "network" error under file://
    // because it requires Google's servers. Skip it — backend sends {type:'wake'}.
    if (!USE_BROWSER_WAKE) return

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return

    const r = new SR()
    r.continuous      = true
    r.interimResults  = true   // ← interim ON: catches short words like "Maya" faster
    r.lang            = 'en-IN'
    r.maxAlternatives = 1

    r.onstart = () => {
      _listening = true
      _rec = r
    }

    r.onresult = (e) => {
      // Check EVERY result individually — both interim and final
      // This catches "Maya" even when said alone as a short utterance
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.trim()
        if (hasWakeWord(text)) {
          console.log('[Voice] Wake word detected:', text)
          triggerWake()
          return
        }
      }
    }

    r.onend = () => {
      _listening = false
      _rec = null
      // 600ms lets the mic hardware fully release before next instance starts
      setTimeout(() => { if (!_listening) startWakeRef.current?.() }, 600)
    }

    r.onerror = (e) => {
      _listening = false
      _rec = null
      if (e.error === 'aborted') return
      if (e.error === 'not-allowed') {
        // Mic still held by previous instance — retry after a longer pause
        console.debug('[Voice] Mic busy, retrying in 1.5s...')
        setTimeout(() => startWakeRef.current?.(), 1500)
        return
      }
      if (e.error !== 'no-speech') console.error('[Voice] Wake error:', e.error)
      setTimeout(() => startWakeRef.current?.(), 600)
    }

    r.start()
  }

  // ── COMMAND mode — Whisper via MediaRecorder ──────────────────────────
  // Uses backend Whisper instead of browser SpeechRecognition.
  // Benefits: fully offline, works under file:// protocol, Hindi/Hinglish accuracy.
  // Tradeoff: ~1-3s transcription latency vs ~0.5s for Web Speech API.
  const startCommand = async () => {
    if (_listening) return
    _listening = true

    // Silence detection config
    const MAX_RECORD_MS  = 8000    // stop after 8s max
    const SILENCE_MS     = 1500    // stop after 1.5s of silence
    const SILENCE_THRESH = 0.015   // RMS threshold for silence

    let stream       = null
    let mediaRec     = null
    let audioCtx     = null
    let analyser     = null
    let silenceTimer = null
    let chunks       = []

    const cleanup = () => {
      clearTimeout(silenceTimer)
      if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop()
      if (stream) stream.getTracks().forEach(t => t.stop())
      if (audioCtx) audioCtx.close()
      _listening = false
      _rec = null
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      console.log('[Voice] Whisper command: recording started')

      // ── Silence detection via AnalyserNode ──────────────────────────
      audioCtx = new AudioContext()
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      const src = audioCtx.createMediaStreamSource(stream)
      src.connect(analyser)
      const buf = new Float32Array(analyser.fftSize)

      const checkSilence = () => {
        analyser.getFloatTimeDomainData(buf)
        const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length)
        if (rms < SILENCE_THRESH) {
          if (!silenceTimer) {
            silenceTimer = setTimeout(() => {
              console.log('[Voice] Silence detected — stopping recording')
              if (mediaRec && mediaRec.state === 'recording') mediaRec.stop()
            }, SILENCE_MS)
          }
        } else {
          // Voice detected — reset silence timer
          clearTimeout(silenceTimer)
          silenceTimer = null
        }
        if (_listening) requestAnimationFrame(checkSilence)
      }
      requestAnimationFrame(checkSilence)

      // ── MediaRecorder ────────────────────────────────────────────────
      mediaRec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      _rec = mediaRec

      mediaRec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

      mediaRec.onstop = async () => {
        cleanup()
        setActive(false)

        if (chunks.length === 0) {
          console.log('[Voice] No audio recorded')
          notifyDone()
          waitForTTS().then(() => setTimeout(() => startWakeRef.current?.(), 800))
          return
        }

        // ── Send to Whisper backend ──────────────────────────────────
        const blob    = new Blob(chunks, { type: 'audio/webm' })
        const formData = new FormData()
        formData.append('file', blob, 'command.webm')

        const BACKEND = (IS_ELECTRON || IS_FILE)
          ? 'http://127.0.0.1:8000'
          : 'http://localhost:8000'

        try {
          console.log('[Voice] Sending to Whisper...')
          const res  = await fetch(`${BACKEND}/voice/transcribe`, {
            method: 'POST',
            body:   formData,
            signal: AbortSignal.timeout(15000),
          })
          const data = await res.json()
          const text = (data.transcribed || data.text || '').trim()
          console.log('[Voice] Whisper result:', text)

          if (text && !hasWakeWord(text)) {
            cbRef.current.onCommand?.(text)
          }
        } catch (e) {
          console.error('[Voice] Whisper transcription error:', e.message)
        }

        notifyDone()
        waitForTTS().then(() => setTimeout(() => startWakeRef.current?.(), 1200))
      }

      mediaRec.onerror = (e) => {
        console.error('[Voice] MediaRecorder error:', e.error)
        cleanup()
        setActive(false)
        notifyDone()
        waitForTTS().then(() => setTimeout(() => startWakeRef.current?.(), 1200))
      }

      // Start recording — stop after max duration
      mediaRec.start(100)  // 100ms chunks for smooth silence detection
      setTimeout(() => {
        if (mediaRec && mediaRec.state === 'recording') {
          console.log('[Voice] Max duration reached — stopping')
          mediaRec.stop()
        }
      }, MAX_RECORD_MS)

    } catch (e) {
      console.error('[Voice] Command setup error:', e.message)
      cleanup()
      setActive(false)
      notifyDone()
      waitForTTS().then(() => setTimeout(() => startWakeRef.current?.(), 1200))
    }
  }

  // Keep refs fresh every render
  useEffect(() => {
    startWakeRef.current = startWake
    startCmdRef.current  = startCommand
  })

  // ── WebSocket ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (_ws && (_ws.readyState === WebSocket.OPEN ||
                _ws.readyState === WebSocket.CONNECTING)) return

    let ping, retry
    let retryDelay = 3000
    let failCount  = 0

    const connect = () => {
      const ws = new WebSocket(`${WS_BASE}/ws/voice`)
      _ws = ws

      ws.onopen = () => {
        setWsReady(true)
        clearTimeout(retry)
        retryDelay = 3000
        failCount  = 0
        ws.send(JSON.stringify({
          type: 'session',
          session_id: localStorage.getItem('sessionId') || 'default'
        }))
        console.log('[Voice] WS connected')
        // 25s ping — keeps alive through Uvicorn's 30s idle timeout
        ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping')
        }, 25000)
        // After reconnect restart wake if mic already granted
        if (_booted && !_listening) {
          setTimeout(() => startWakeRef.current?.(), 500)
        }
      }

      ws.onmessage = (e) => {
        if (e.data === 'pong') return
        let data
        try { data = JSON.parse(e.data) } catch { return }

        if (data.type === 'wake') triggerWake()

        if (data.type === 'command') {
          setActive(false)
          if (data.mode_switched) cbRef.current.onModeSwitch?.(data.mode)
          cbRef.current.onCommand?.(data.text)
          notifyDone()
          waitForTTS().then(() => setTimeout(() => startWakeRef.current?.(), 800))
        }
      }

      ws.onclose = () => {
        setWsReady(false)
        clearInterval(ping)
        failCount++
        // Exponential backoff: 3s → 6s → 12s → max 30s
        retryDelay = Math.min(retryDelay * (failCount > 1 ? 2 : 1), 30000)
        console.log(`[Voice] WS disconnected — retry in ${retryDelay / 1000}s`)
        retry = setTimeout(connect, retryDelay)
      }

      ws.onerror = () => setWsReady(false)
    }

    connect()
    return () => { clearInterval(ping); clearTimeout(retry) }
  }, [])

  // ── Boot ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (_booted) return
    _booted = true

    // Kill any leftover SpeechRecognition from previous page load
    stopCurrent()

    let micStream = null

    // In Electron: backend Porcupine handles wake word — no browser mic needed for wake
    // The WebSocket connection handles wake events from backend
    if (!USE_BROWSER_WAKE) {
      console.log('[Voice] Electron mode — wake word handled by backend Porcupine')
      return () => {
        stopCurrent()
      }
    }

    // Browser dev mode — use browser SpeechRecognition for wake
    // 300ms pause — lets browser fully release mic from any previous session
    console.log('[Voice] Browser mode - asking for mic permission ')
    setTimeout(() => {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          micStream = stream
          console.log('[Voice] Mic granted')
          // 800ms after grant — mic hardware fully initialized before starting wake
          setTimeout(() => startWakeRef.current?.(), 800)
        })
        .catch(() => console.error('[Voice] Mic denied'))
    }, 300)

    return () => {
      // Explicitly stop mic stream tracks — prevents MediaStreamTrack warning
      if (micStream) micStream.getTracks().forEach(t => t.stop())
      stopCurrent()
    }
  }, [])

  return {
    active,
    wsReady,
    // Manual trigger — call this from a mic button click
    // Bypasses wake word, goes straight to Whisper recording
    startListening: () => {
      if (_listening || active) return
      console.log('[Voice] Manual mic trigger')
      setActive(true)
      startCmdRef.current?.()
    },
    stopListening: () => {
      stopCurrent()
      setActive(false)
    }
  }
}
