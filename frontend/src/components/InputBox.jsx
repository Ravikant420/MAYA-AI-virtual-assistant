import React, { useRef, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Mic, Database, Loader2, CornerDownLeft, Square } from 'lucide-react'
import { useChat } from '../context/ChatContext'
import VoiceVisualizer from './VoiceVisualizer'
import clsx from 'clsx'

export default function InputBox() {
  // Destructure stopGeneration from context
  const { sendMessage, isLoading, isListening, mode, voiceState, useRag, setUseRag, startVoice, stopVoice, stopAudio, stopGeneration } = useChat()
  const [text, setText] = useState('')
  const [showVoice, setShowVoice] = useState(false)
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef(null)
  const isRomantic = mode === 'romantic'

  useEffect(() => {
    if (!isListening) {
      setShowVoice(false)
    }
  }, [isListening])

  useEffect(() => {
    if (!isLoading) textareaRef.current?.focus()
  }, [isLoading])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'
  }, [text])

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return
    sendMessage(trimmed)
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleVoiceClick = () => {
    if (isListening) {
      stopVoice?.()
    } else {
      setShowVoice(true)
      startVoice?.()
    }
  }

  const canSend = text.trim().length > 0 && !isLoading

  return (
    <div className="relative px-3 pb-3 pt-2 sm:px-5 sm:pb-4">
      {/* Voice overlay */}
      <AnimatePresence>
        {showVoice && (
          <motion.div
            className="absolute bottom-full left-4 right-4 mb-2 flex justify-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
          >
            <div className={clsx(
              'w-full max-w-xl rounded-2xl border px-6 py-4',
              isRomantic
                ? 'bg-[rgba(10,3,7,0.92)] border-rom/20'
                : 'bg-[rgba(3,8,15,0.92)] border-pro/20'
            )}
              style={{ backdropFilter: 'blur(20px)' }}
            >
              <VoiceVisualizer />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main input wrapper */}
      <div
        className={clsx(
          'relative max-w-3xl mx-auto rounded-2xl border-2 transition-all duration-200',
          'shadow-[0_4px_24px_rgba(0,0,0,0.4)]',
          focused
            ? isRomantic
              ? 'border-rom/60 bg-[rgba(255,107,157,0.04)]'
              : 'border-pro/60 bg-[rgba(0,200,255,0.04)]'
            : 'border-white/[0.10] bg-[rgba(255,255,255,0.04)]',
          // Notice we removed the "pointer-events-none" here so the stop button remains clickable!
          isLoading && 'opacity-80' 
        )}
        style={{ backdropFilter: 'blur(16px)' }}
      >
        {/* Top strip: RAG toggle */}
        <div className="flex items-center gap-3 px-4 pt-3 pb-0">
          <button
            onClick={() => setUseRag(!useRag)}
            disabled={isLoading}
            className="flex items-center gap-2 group disabled:opacity-50"
            title={useRag ? 'Document search ON — click to disable' : 'Document search OFF — click to enable'}
          >
            <div className={clsx(
              'relative w-8 h-4 rounded-full transition-all duration-200 border',
              useRag
                ? isRomantic
                  ? 'bg-rom/40 border-rom/60'
                  : 'bg-pro/40 border-pro/60'
                : 'bg-white/10 border-white/20'
            )}>
              <motion.div
                className={clsx(
                  'absolute top-0.5 w-3 h-3 rounded-full transition-colors',
                  useRag
                    ? isRomantic ? 'bg-rom' : 'bg-pro'
                    : 'bg-white/40'
                )}
                animate={{ left: useRag ? '17px' : '2px' }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </div>
            <span className={clsx(
              'text-[11px] font-medium transition-colors',
              useRag
                ? isRomantic ? 'text-rom' : 'text-pro'
                : 'text-ink-muted'
            )}>
              <Database size={10} className="inline mr-1 mb-0.5" />
              {useRag ? 'Docs search on' : 'Docs search off'}
            </span>
          </button>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={
            isRomantic
              ? 'Share your thoughts with Maya...'
              : 'Ask anything... (Enter to send)'
          }
          rows={1}
          disabled={isLoading}
          className={clsx(
            'w-full bg-transparent resize-none',
            'px-4 pt-3 pb-2',
            'text-[15px] leading-relaxed text-ink-primary',
            'placeholder:text-ink-muted/50',
            'focus:outline-none',
            'min-h-[52px] max-h-[180px]',
            isLoading && 'cursor-not-allowed text-ink-muted'
          )}
        />

        {/* Bottom action bar */}
        <div className="flex items-center justify-between px-3 pb-3 gap-2">
          <span className={clsx(
            'text-[11px] transition-opacity duration-200 hidden sm:block',
            text.length > 0 ? 'text-ink-muted opacity-70' : 'opacity-0'
          )}>
            Shift+Enter for new line
          </span>
          <div className="sm:hidden" />

          <div className="flex items-center gap-2 flex-shrink-0">
            
            <motion.button
              onClick={stopAudio}
              disabled={isLoading}
              whileTap={{ scale: 0.88 }}
              title="Stop Maya from speaking"
              className={clsx(
                'w-9 h-9 rounded-xl flex items-center justify-center border transition-all duration-200',
                'border-white/10 text-ink-muted hover:text-red-400 hover:border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 disabled:pointer-events-none'
              )}
            >
              <Square size={14} />
            </motion.button>

            <motion.button
              onClick={handleVoiceClick}
              disabled={isLoading}
              whileTap={{ scale: 0.88 }}
              title={isListening ? 'Click to stop and process audio' : 'Voice input'}
              className={clsx(
                'w-9 h-9 rounded-xl flex items-center justify-center border transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none',
                isListening
                  ? isRomantic
                    ? 'bg-rom/20 border-rom/50 text-rom'
                    : 'bg-pro/20 border-pro/50 text-pro'
                  : 'border-white/10 text-ink-muted hover:text-ink-secondary hover:border-white/20 hover:bg-white/[0.05]'
              )}
            >
              {isListening
                ? <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
                    <Square size={12} className="fill-current" />
                  </motion.div>
                : <Mic size={15} />
              }
            </motion.button>

            {/* SEND / STOP BUTTON */}
            <motion.button
              // If it's loading, click stops generation. Otherwise, click sends message.
              onClick={isLoading ? stopGeneration : handleSend}
              // It is disabled ONLY if it's NOT loading and the input is empty.
              disabled={!isLoading && !canSend}
              whileTap={(isLoading || canSend) ? { scale: 0.93 } : {}}
              className={clsx(
                'flex items-center gap-2 px-4 h-9 rounded-xl font-semibold text-sm',
                'transition-all duration-200',
                (isLoading || canSend)
                  ? isRomantic
                    ? 'bg-rom text-white shadow-[0_2px_12px_rgba(255,107,157,0.35)] hover:shadow-[0_2px_18px_rgba(255,107,157,0.5)] hover:bg-[#FF85B4]'
                    : 'bg-pro text-[#030810] shadow-[0_2px_12px_rgba(0,200,255,0.25)] hover:shadow-[0_2px_18px_rgba(0,200,255,0.4)] hover:bg-[#33D4FF]'
                  : 'bg-white/[0.06] text-ink-muted cursor-not-allowed border border-white/[0.07]'
              )}
            >
              {isLoading ? (
                <>
                  <Square size={14} className="fill-current" />
                  <span>Stop</span>
                </>
              ) : canSend ? (
                <>
                  <Send size={14} />
                  <span>Send</span>
                </>
              ) : (
                <>
                  <CornerDownLeft size={14} />
                  <span>Send</span>
                </>
              )}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  )
}