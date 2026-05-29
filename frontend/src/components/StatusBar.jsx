import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Mic, ChevronDown, Check } from 'lucide-react'
// import { useChat } from '../context/ChatContext'
import axios from 'axios'
import toast from 'react-hot-toast'
import clsx from 'clsx'

// Mock useChat for the preview environment
const useChat = () => ({ backendStatus: 'connected', voiceState: 'idle', mode: 'professional' })

const SERVER = 'http://localhost:8000'

const MODELS = [
  { id: 'ollama',  label: 'Ollama',  tag: 'Local · Offline', icon: '🖥️' },
  { id: 'gemini',  label: 'Gemini',  tag: 'Google AI',       icon: '✨' },
  { id: 'chatgpt', label: 'ChatGPT', tag: 'OpenAI',          icon: '🤖' },
]

export default function StatusBar() {
  const { backendStatus, voiceState, mode } = useChat()
  const [activeModel,  setActiveModel]  = useState('ollama')
  const [menuOpen,     setMenuOpen]     = useState(false)
  const [switching,    setSwitching]    = useState(false)
  const menuRef = useRef(null)

  const connected  = backendStatus === 'connected'
  const listening  = voiceState === 'listening'
  const activated  = voiceState === 'activated'
  const isRomantic = mode === 'romantic'

  // Fetch active model once connected
  useEffect(() => {
    if (!connected) return
    axios.get(`${SERVER}/api/model/current`)
      .then(r => setActiveModel(r.data?.model || 'ollama'))
      .catch(() => {})
  }, [connected])

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const switchModel = async (modelId) => {
    if (modelId === activeModel) { setMenuOpen(false); return }
    setSwitching(true)
    setMenuOpen(false)
    try {
      await axios.post(`${SERVER}/api/model/switch`, { model: modelId })
      setActiveModel(modelId)
      toast.success(`Switched to ${MODELS.find(m => m.id === modelId)?.label}`)
    } catch (e) {
      toast.error(`Switch failed: ${e.response?.data?.error || e.message}`)
    } finally {
      setSwitching(false)
    }
  }

  const currentModel = MODELS.find(m => m.id === activeModel) || MODELS[0]

  const isVoiceActive = listening || activated

  return (
    <div className="flex items-center gap-2" ref={menuRef} style={{ WebkitAppRegion: 'no-drag' }}>

      {/* ── Main status pill — model switcher trigger ── */}
      <div className="relative">
        <motion.button
          onClick={() => connected && !switching && setMenuOpen(o => !o)}
          disabled={!connected || switching}
          className={clsx(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium border',
            'transition-all duration-200 select-none cursor-pointer',
            connected
              ? isRomantic
                ? 'bg-rom/[0.08] border-rom/20 text-ink-secondary hover:border-rom/35 hover:text-ink-primary'
                : 'bg-pro/[0.08] border-pro/20 text-ink-secondary hover:border-pro/35 hover:text-ink-primary'
              : backendStatus === 'connecting'
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400',
            (!connected || switching) && 'cursor-default'
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {/* Status dot */}
          {connected ? (
            <motion.span
              className={clsx(
                'w-1.5 h-1.5 rounded-full flex-shrink-0',
                isRomantic ? 'bg-rom/70' : 'bg-pro/70'
              )}
              animate={{ opacity: [1, 0.45, 1] }}
              transition={{ duration: 2.5, repeat: Infinity }}
            />
          ) : backendStatus === 'connecting' ? (
            <Loader2 size={10} className="animate-spin flex-shrink-0" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
          )}

          {/* Label */}
          <span>
            {!connected
              ? backendStatus === 'connecting' ? 'Connecting…' : 'Backend offline'
              : switching
                ? 'Switching…'
                : currentModel.id === 'ollama' 
                  ? `Running Locally (${currentModel.label})` 
                  : `Cloud Engine (${currentModel.label})`
            }
          </span>

          {/* Chevron — only when connected and can switch */}
          {connected && !switching && (
            <ChevronDown
              size={11}
              className={clsx('flex-shrink-0 transition-transform duration-200', menuOpen && 'rotate-180')}
            />
          )}
        </motion.button>

        {/* ── Model switcher dropdown ── */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className="absolute top-full left-0 mt-2 z-50 w-52 rounded-2xl border overflow-hidden"
              style={{
                background: isRomantic ? 'rgba(10,3,7,0.96)' : 'rgba(3,8,15,0.96)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                borderColor: 'rgba(255,255,255,0.10)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }}
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.96 }}
              transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            >
              {/* Dropdown header */}
              <div className="px-3 pt-3 pb-2 border-b border-white/[0.07]">
                <p className="text-[10px] font-bold text-ink-muted/60 uppercase tracking-widest">AI Engine</p>
              </div>

              {/* Model options */}
              {MODELS.map((m, i) => {
                const isActive = m.id === activeModel
                return (
                  <motion.button
                    key={m.id}
                    onClick={() => switchModel(m.id)}
                    className={clsx(
                      'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all duration-150',
                      isActive
                        ? 'bg-white/[0.07] text-ink-primary'
                        : 'text-ink-secondary hover:bg-white/[0.05] hover:text-ink-primary'
                    )}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <span className="text-base leading-none w-5 text-center flex-shrink-0">{m.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={clsx('text-[13px] font-medium leading-snug', isActive && (isRomantic ? 'text-rom' : 'text-pro'))}>
                        {m.label}
                      </p>
                      <p className="text-[10px] text-ink-muted/60 leading-snug">{m.tag}</p>
                    </div>
                    {isActive && (
                      <Check size={13} className={clsx('flex-shrink-0', isRomantic ? 'text-rom' : 'text-pro')} />
                    )}
                  </motion.button>
                )
              })}

              {/* Footer note */}
              <div className="px-3 py-2 border-t border-white/[0.06]">
                <p className="text-[10px] text-ink-muted/40">Ollama stays fully offline</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Voice state pill — only shows when active ── */}
      <AnimatePresence mode="wait">
        {(listening || activated) && (
          <motion.div
            key={listening ? 'listening' : 'activated'}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border',
              listening
                ? isRomantic
                  ? 'bg-rom/10 border-rom/25 text-rom'
                  : 'bg-pro/10 border-pro/25 text-pro'
                : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
            )}
            initial={{ opacity: 0, scale: 0.85, x: -4 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.85, x: -4 }}
            transition={{ duration: 0.18 }}
          >
            {listening ? (
              <>
                <Mic size={10} className="animate-pulse" />
                Listening
              </>
            ) : (
              <>
                <motion.span
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                  animate={{ scale: [1, 1.5, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                />
                Activated
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}