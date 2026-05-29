import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { mayaApi } from '../services/api'
import { useVoice } from '../hooks/useVoice'

const ChatContext = createContext(null)

// ── Female voice TTS ──────────────────────────────────────────────────────────
const speakResponse = (text, mode, cancelPrev = true) => {
  if (!text || !window.speechSynthesis) return
  if (cancelPrev) window.speechSynthesis.cancel()

  const clean = text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/⚠️|❤️|💼|💕|👂|🎙️|\[.*?\]/g, '')
    .trim()

  if (!clean) return;

  const utterance = new SpeechSynthesisUtterance(clean)
  utterance.lang  = 'en-US'
  utterance.rate  = mode === 'romantic' ? 0.88 : 1.0
  utterance.pitch = mode === 'romantic' ? 1.2  : 1.05

  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices()
    const preferred = [
      'Samantha', 'Karen', 'Victoria',
      'Google UK English Female',
      'Microsoft Zira',
      'Google US English',
    ]
    const voice = preferred
      .map(name => voices.find(v => v.name.includes(name)))
      .find(Boolean)
    if (voice) utterance.voice = voice
    window.speechSynthesis.speak(utterance)
  }

  if (window.speechSynthesis.getVoices().length > 0) {
    pickVoice()
  } else {
    window.speechSynthesis.onvoiceschanged = pickVoice
  }
}

export function ChatProvider({ children, setLimited, setResetSeconds }) {
  const [sessionId, setSessionId]         = useState(null)
  const [sessions, setSessions]           = useState([])
  const [messages, setMessages]           = useState([])
  const [isLoading, setIsLoading]         = useState(false)
  const [mode, setMode]                   = useState('professional')
  const [voiceState, setVoiceState]       = useState('idle')
  const [backendStatus, setBackendStatus] = useState('connecting')
  const [systemStats, setSystemStats]     = useState(null)
  const [sidebarOpen, setSidebarOpen]     = useState(true)
  const [useRag, setUseRag]               = useState(false)

  const pingInterval = useRef(null)
  const sessionRef   = useRef(null)
  const modeRef      = useRef(mode)
  const mediaRecorderRef = useRef(null)

  const isLoadingRef = useRef(isLoading)
  const useRagRef    = useRef(useRag)
  const sendMsgRef   = useRef(null)

  // NEW: Ref to hold the AbortController so we can cancel the fetch stream
  const abortControllerRef = useRef(null)

  useEffect(() => { sessionRef.current  = sessionId  }, [sessionId])
  useEffect(() => { modeRef.current     = mode       }, [mode])
  useEffect(() => { isLoadingRef.current = isLoading }, [isLoading])
  useEffect(() => { useRagRef.current   = useRag     }, [useRag])

  const pingBackend = useCallback(async () => {
    if (isLoadingRef.current) return
    try {
      const res = await mayaApi.ping()
      setBackendStatus('connected')
      setSystemStats(res.data)
    } catch {
      setBackendStatus('disconnected')
    }
  }, [])

  useEffect(() => {
    pingBackend()
    pingInterval.current = setInterval(pingBackend, 30000)
    return () => clearInterval(pingInterval.current)
  }, [pingBackend])

  const initSession = useCallback(async (newMode) => {
    const m = newMode || modeRef.current
    try {
      const res = await mayaApi.createSession(m)
      const sid = res.data.session_id
      setSessionId(sid)
      sessionRef.current = sid
      localStorage.setItem('sessionId', sid)
      const welcome = m === 'romantic'
        ? "Hey... I'm Maya. I'm here with you. ❤️ How are you feeling?"
        : "Hello! I'm **Maya**, your intelligent offline assistant. How can I help you today?"
      setMessages([{ id: 'welcome', role: 'assistant', content: welcome, timestamp: new Date() }])
      speakResponse(welcome, m)
      return sid
    } catch {
      const localId = 'local-' + Date.now()
      setSessionId(localId)
      sessionRef.current = localId
      setMessages([{
        id: 'welcome', role: 'assistant', timestamp: new Date(), isError: true,
        content: "⚠️ Backend is offline. Start Maya backend with `python main.py` then refresh.",
      }])
      return localId
    }
  }, [])

  useEffect(() => { initSession(); loadSessions() }, [])


  // ── LOAD OLD SESSION ──────────────────────────────────────────────
  const loadOldSession = useCallback(async (sid, modeToSet) => {
    if (isLoadingRef.current) return
    setIsLoading(true)
    window.speechSynthesis.cancel()
    
    try {
      const isElectron = !!window.mayaElectron
      const isFile = window.location.protocol === 'file:'
      const BACKEND = (isElectron || isFile) ? 'http://127.0.0.1:8000' : 'http://localhost:8000'

      const res = await fetch(`${BACKEND}/memory?session_id=${sid}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()

      if (data.short_term) {
        const loadedMessages = data.short_term.map((m, i) => ({
          id: `loaded-${Date.now()}-${i}`,
          role: m.role,
          content: m.content,
          timestamp: new Date()
        }))
        
        setSessionId(sid)
        sessionRef.current = sid
        
        if (modeToSet) {
          setMode(modeToSet)
          modeRef.current = modeToSet
        }
        
        setMessages(loadedMessages)
        toast.success('Conversation loaded', { icon: '🕰️' })
      }
    } catch (err) {
      toast.error('Failed to load conversation')
    } finally {
      setIsLoading(false)
    }
  }, [])


  // Function to manually abort the LLM generation
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      setIsLoading(false)
      window.speechSynthesis.cancel() // Stop speaking if she was talking
      toast('Generation stopped', { icon: '⏹️' })
    }
  }, [])

  const sendMessage = useCallback(async (text) => {
    if (!text?.trim() || isLoadingRef.current) return
    const sid = sessionRef.current || await initSession()

    const userMsg = { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)

    // Create a new AbortController for this request
    abortControllerRef.current = new AbortController()

    try {
      const isElectron = !!window.mayaElectron
      const isFile = window.location.protocol === 'file:'
      const BACKEND = (isElectron || isFile) ? 'http://127.0.0.1:8000' : 'http://localhost:8000'

      const res = await fetch(`${BACKEND}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal, // Attach the signal here!
        body: JSON.stringify({
          message: text,
          session_id: sid,
          use_rag: useRagRef.current,
          stream: true, 
          tts: false 
        })
      })

      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = res.headers.get('retry-after') ?? 3600
          setResetSeconds(Number(retryAfter))
          setLimited(true)
          setIsLoading(false)
          return
        }
        throw new Error(`HTTP error! status: ${res.status}`)
      }

      const contentType = res.headers.get('content-type') || ''

      if (contentType.includes('application/json')) {
        const d = await res.json()
        const newMode = d.mode_switched_to || modeRef.current
        if (d.mode_switched_to) setMode(d.mode_switched_to)

        const answer = d.response || '(no response)'
        setMessages(prev => [...prev, {
          id:         `assistant-${Date.now()}`,
          role:       'assistant',
          content:    answer,
          timestamp:  new Date(),
          toolUsed:   d.tool_used   || null,
          metrics:    d.metrics     || null,
          ragSources: d.rag_sources || null,
        }])
        speakResponse(answer, newMode)
        setIsLoading(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let done = false
      let buffer = ''
      
      const assistantMsgId = `assistant-${Date.now()}`
      
      setMessages(prev => [...prev, {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolUsed: null,
        metrics: null,
        ragSources: null,
      }])

      let fullResponse = ""
      let finalMode = modeRef.current
      let sentenceBuffer = "" 

      window.speechSynthesis.cancel()

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        done = readerDone
        if (value) {
          buffer += decoder.decode(value, { stream: true })
          
          const blocks = buffer.split('\n\n')
          buffer = blocks.pop() || ''

          for (const block of blocks) {
            const dataLine = block.split('\n').find(l => l.startsWith('data: '))
            if (dataLine) {
              const dataStr = dataLine.replace('data: ', '').trim()
              if (!dataStr) continue
              
              try {
                const parsed = JSON.parse(dataStr)
                
                if (parsed.done) break
                
                if (parsed.error) {
                  fullResponse = parsed.fallback || parsed.error
                  speakResponse(fullResponse, finalMode, false)
                } else if (parsed.token !== undefined) {
                  fullResponse += parsed.token
                  sentenceBuffer += parsed.token

                  const boundaryMatch = sentenceBuffer.match(/([.?!])(\s|\n)|(\n)/)
                  if (boundaryMatch) {
                    const splitIndex = boundaryMatch.index + boundaryMatch[0].length
                    const chunkToSpeak = sentenceBuffer.slice(0, splitIndex)
                    sentenceBuffer = sentenceBuffer.slice(splitIndex)

                    if (chunkToSpeak.trim().length > 0) {
                      speakResponse(chunkToSpeak, finalMode, false)
                    }
                  }

                } else if (parsed.response) {
                  fullResponse = parsed.response
                  speakResponse(fullResponse, finalMode, false)
                }

                if (parsed.mode) finalMode = parsed.mode

                setMessages(prev => prev.map(m => 
                  m.id === assistantMsgId ? {
                    ...m,
                    content: fullResponse,
                    toolUsed: parsed.tool_used || m.toolUsed,
                    ragSources: parsed.rag_sources || m.ragSources,
                    mode: parsed.mode || m.mode
                  } : m
                ))
              } catch (e) {
                console.error("SSE parse error on string:", dataStr, e)
              }
            }
          }
        }
      }

      if (sentenceBuffer.trim().length > 0) {
        speakResponse(sentenceBuffer, finalMode, false)
      }

      if (finalMode !== modeRef.current) setMode(finalMode)

    } catch (err) {
      // Check if the error was just us intentionally stopping the generation
      if (err.name === 'AbortError') {
        console.log('[Maya] Generation manually aborted by user.');
      } else {
        setMessages(prev => [...prev, {
          id: `err-${Date.now()}`, role: 'assistant', timestamp: new Date(), isError: true,
          content: `⚠️ ${err.message || 'Connection error.'}`,
        }])
        toast.error('Failed to get response')
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [initSession, setLimited, setResetSeconds])

  useEffect(() => { sendMsgRef.current = sendMessage }, [sendMessage])

  const switchMode = useCallback(async (newMode) => {
    if (newMode === modeRef.current) return
    const sid = sessionRef.current
    if (sid) {
      try { await mayaApi.switchMode({ session_id: sid, mode: newMode }) } catch {}
    }
    setMode(newMode)
    modeRef.current = newMode
    const msg = newMode === 'romantic'
      ? "Of course... I'm here for you now. ❤️ How are you feeling?"
      : "Switching to professional mode. How can I assist you?"
    setMessages(prev => [...prev, { id: `mode-${Date.now()}`, role: 'assistant', content: msg, timestamp: new Date() }])
    speakResponse(msg, newMode)
    toast.success(`${newMode === 'romantic' ? '❤️' : '💼'} ${newMode.charAt(0).toUpperCase() + newMode.slice(1)} mode`)
  }, [])

  const stopAudio = useCallback(() => {
    window.speechSynthesis.cancel()
  }, [])

  const onWakeStable = useCallback(() => {
    setVoiceState('activated')
    window.speechSynthesis.cancel()
    toast('👂 Listening...', { icon: '🎙️' })
  }, [])

  const onCommandStable = useCallback((text) => {
    setVoiceState('listening')
    sendMsgRef.current?.(text)
    setTimeout(() => setVoiceState('idle'), 1500)
  }, [])

  const onModeSwitchStable = useCallback((newMode) => {
    setMode(newMode)
    modeRef.current = newMode
    toast(newMode === 'romantic' ? '💕 Romantic mode' : '💼 Professional mode')
  }, [])

  const { active: micActive, startListening, stopListening } = useVoice({
    onCommand:    onCommandStable,
    onWake:       onWakeStable,
    onModeSwitch: onModeSwitchStable,
  })

  const isListening = voiceState === 'listening' || micActive

  const stopVoice = useCallback(() => {
    if (stopListening) stopListening()
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop() 
    }
  }, [stopListening])

  const startVoice = () => {
    if (voiceState !== 'idle') return 
    window.speechSynthesis.cancel()

    if (startListening) {
      setVoiceState('listening')
      startListening()
      return
    }

    setVoiceState('listening')
    const isElectron = !!window.mayaElectron
    const isFile = window.location.protocol === 'file:'
    const BACKEND = (isElectron || isFile) ? 'http://127.0.0.1:8000' : 'http://localhost:8000'

    let mediaRec, stream, chunks = [], silenceTimer
    const MAX_MS = 8000, SILENCE_MS = 1500, THRESH = 0.015

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(s => {
        stream = s
        const ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(s).connect(analyser)
        const buf = new Float32Array(analyser.fftSize)

        const checkSilence = () => {
          analyser.getFloatTimeDomainData(buf)
          const rms = Math.sqrt(buf.reduce((a, v) => a + v*v, 0) / buf.length)
          if (rms < THRESH) {
            if (!silenceTimer) silenceTimer = setTimeout(() => { mediaRec?.stop() }, SILENCE_MS)
          } else {
            clearTimeout(silenceTimer); silenceTimer = null
          }
          if (mediaRec?.state === 'recording') requestAnimationFrame(checkSilence)
        }

        mediaRec = new MediaRecorder(s, { mimeType: 'audio/webm;codecs=opus' })
        mediaRecorderRef.current = mediaRec
        
        mediaRec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
        mediaRec.onstop = async () => {
          clearTimeout(silenceTimer)
          stream.getTracks().forEach(t => t.stop())
          ctx.close()
          if (!chunks.length) { setVoiceState('idle'); return }
          
          setIsLoading(true) 
          
          try {
            const form = new FormData()
            form.append('file', new Blob(chunks, { type: 'audio/webm' }), 'cmd.webm')
            const res  = await fetch(`${BACKEND}/voice/transcribe`, { method: 'POST', body: form })
            const data = await res.json()
            const text = (data.transcribed || '').trim()
            if (text) { 
              setVoiceState('activated'); 
              sendMsgRef.current?.(text);
            } else {
              setIsLoading(false);
            }
          } catch (e) { 
            console.error('[Voice] Transcribe error:', e)
            setIsLoading(false)
          }
          setTimeout(() => setVoiceState('idle'), 1500)
        }
        mediaRec.start(100)
        requestAnimationFrame(checkSilence)
        setTimeout(() => { if (mediaRec?.state === 'recording') mediaRec.stop() }, MAX_MS)
      })
      .catch(() => { toast.error('Mic access denied'); setVoiceState('idle') })
  }

  const newChat = useCallback(async () => {
    window.speechSynthesis.cancel()
    await initSession(modeRef.current)
    toast.success('New conversation started')
  }, [initSession])

  const resetMemory = useCallback(async () => {
    const sid = sessionRef.current
    if (!sid) return
    try { await mayaApi.resetSession(sid); setMessages([]); toast.success('Memory cleared') }
    catch { toast.error('Reset failed') }
  }, [])

  const exportChat = useCallback(() => {
    // 1. Check if there are messages to export
    if (!messages || messages.length === 0) {
      toast.error('No messages to export')
      return
    }

    try {
      // 2. Format the messages into a clean, readable text layout
      const textContent = messages.map(m => {
        const role = m.role === 'user' ? 'You' : 'Maya'
        const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        return `[${time}] ${role}:\n${m.content}\n`
      }).join('\n----------------------------------------\n\n')

      // 3. Create a Blob (a temporary file in the browser's memory)
      const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)

      // 4. Create a hidden link and simulate a click to trigger the download
      const a = document.createElement('a')
      a.href = url
      // Name the file dynamically based on today's date
      a.download = `Maya_Chat_${new Date().toISOString().split('T')[0]}.txt`
      document.body.appendChild(a)
      a.click()

      // 5. Clean up
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success('Chat downloaded successfully!')
    } catch (err) {
      console.error('Export error:', err)
      toast.error('Export failed')
    }
  }, [messages]) // <-- We depend on the 'messages' array now

  const loadSessions = useCallback(async () => {
    try {
      const res = await mayaApi.listSessions()
      setSessions(res.data.sessions || [])
    } catch {}
  }, [])

  return (
    <ChatContext.Provider value={{
      sessionId, sessions, messages, setMessages,
      isLoading, mode, switchMode,
      voiceState, isListening, startVoice, stopVoice, stopAudio, stopGeneration, // Pass it down here!
      backendStatus, systemStats,
      sidebarOpen, setSidebarOpen,
      useRag, setUseRag,
      sendMessage, newChat, resetMemory, exportChat, loadSessions,
      loadOldSession,
    }}>
      {children}
    </ChatContext.Provider>
  )
}

export const useChat = () => {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be inside ChatProvider')
  return ctx
}