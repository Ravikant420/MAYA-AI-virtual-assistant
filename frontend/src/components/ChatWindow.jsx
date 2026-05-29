// src/components/ChatWindow.jsx
import React, { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import MessageBubble from './MessageBubble'
import AnimatedWallpaper from './AnimatedWallpaper'
import { useChat } from '../context/ChatContext'
import clsx from 'clsx'

// ── Suggestion card data ──────────────────────────────────────────────────────
const PRO_SUGGESTIONS = [
  { icon: '📄', label: 'Summarize a document', prompt: 'Can you help me summarize a document?' },
  { icon: '💡', label: 'Explain a concept', prompt: 'Explain quantum computing in simple terms' },
  { icon: '💻', label: 'Write some code', prompt: 'Write a Python function to sort a list of dictionaries by a key' },
  { icon: '🕒', label: 'What time is it?', prompt: 'What is the current time?' },
  { icon: '📊', label: 'System stats', prompt: 'Show me my system stats' },
]

const ROM_SUGGESTIONS = [
  { icon: '💬', label: 'How are you feeling?', prompt: 'How are you feeling today?' },
  { icon: '✨', label: 'Tell me something nice', prompt: 'Tell me something nice' },
  { icon: '🤗', label: 'I need to talk', prompt: 'I need someone to talk to right now' },
  { icon: '🌙', label: 'Tell me a story', prompt: 'Tell me a short, comforting story' },
]

// ── Date pill ─────────────────────────────────────────────────────────────────
function DatePill() {
  const today = new Date().toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  return (
    <div className="flex items-center justify-center my-5 select-none">
      <span className="px-3 py-1 rounded-full text-[11px] text-ink-muted backdrop-blur-md bg-black/30 border border-white/[0.07] tracking-wide">
        {today}
      </span>
    </div>
  )
}

// ── Suggestion card ───────────────────────────────────────────────────────────
function SuggestionCard({ icon, label, prompt, onSend, isRomantic, index }) {
  return (
    <motion.button
      onClick={() => onSend(prompt)}
      className={clsx(
        'flex flex-col items-start gap-2 p-4 rounded-2xl border text-left',
        'transition-all duration-200 group',
        'bg-black/20 backdrop-blur-md',
        isRomantic
          ? 'border-rom/15 hover:border-rom/40 hover:bg-rom/[0.08]'
          : 'border-white/[0.08] hover:border-pro/40 hover:bg-pro/[0.06]'
      )}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 + index * 0.06, duration: 0.3 }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      whileTap={{ scale: 0.97 }}
    >
      <span className="text-xl leading-none">{icon}</span>
      <span className={clsx(
        'text-sm font-medium leading-snug transition-colors',
        'text-ink-secondary group-hover:text-ink-primary'
      )}>
        {label}
      </span>
    </motion.button>
  )
}

// ── Empty / welcome state ─────────────────────────────────────────────────────
function EmptyState({ mode }) {
  const isRomantic = mode === 'romantic'
  const { sendMessage } = useChat()
  const suggestions = isRomantic ? ROM_SUGGESTIONS : PRO_SUGGESTIONS

  return (
    <div className="relative z-10 h-full flex flex-col items-center justify-center px-5 pb-4">
      {/* Logo + greeting */}
      <motion.div
        className="flex flex-col items-center gap-3 mb-8"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      >
        <motion.div
          className={clsx(
            'w-16 h-16 rounded-2xl flex items-center justify-center border-2 relative overflow-hidden',
            isRomantic ? 'border-rom/40 bg-rom/10' : 'border-pro/40 bg-pro/10'
          )}
          animate={isRomantic
            ? { boxShadow: ['0 0 20px #FF6B9D20', '0 0 40px #FF6B9D40', '0 0 20px #FF6B9D20'] }
            : { boxShadow: ['0 0 20px #00C8FF18', '0 0 40px #00C8FF35', '0 0 20px #00C8FF18'] }
          }
          transition={{ duration: 3, repeat: Infinity }}
        >
          <motion.div
            className="absolute inset-0"
            style={{
              background: isRomantic
                ? 'radial-gradient(circle at 30% 30%, rgba(255,107,157,0.25), transparent 65%)'
                : 'radial-gradient(circle at 30% 30%, rgba(0,200,255,0.2), transparent 65%)',
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
          />
          <span className={clsx(
            'text-2xl font-bold font-display relative z-10',
            isRomantic ? 'text-gradient-rom' : 'text-gradient-pro'
          )}>M</span>
        </motion.div>

        <div className="text-center">
          <h2 className="text-xl font-display font-bold text-ink-primary">
            {isRomantic ? "Hey, I'm here for you" : "Hello, I'm Maya"}
          </h2>
          <p className="text-sm text-ink-muted mt-1">
            {isRomantic
              ? 'Your companion — always listening, always caring'
              : 'Your fully offline AI assistant — ask anything'}
          </p>
        </div>
      </motion.div>

      {/* Suggestion cards grid */}
      <motion.div
        className="w-full max-w-2xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <p className="text-[11px] text-ink-muted uppercase tracking-widest text-center mb-3 font-medium">
          Try asking
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {suggestions.map((s, i) => (
            <SuggestionCard
              key={s.label}
              {...s}
              onSend={sendMessage}
              isRomantic={isRomantic}
              index={i}
            />
          ))}
        </div>
      </motion.div>
    </div>
  )
}

// ── "Maya is typing" indicator ────────────────────────────────────────────────
function TypingStatusBar({ isRomantic }) {
  return (
    <motion.div
      className="flex items-center gap-2 px-5 py-2"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex gap-1 items-center">
        {[0, 0.15, 0.3].map((delay, i) => (
          <motion.span
            key={i}
            className={clsx(
              'w-1.5 h-1.5 rounded-full',
              isRomantic ? 'bg-rom/60' : 'bg-pro/60'
            )}
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{ duration: 0.8, delay, repeat: Infinity }}
          />
        ))}
      </div>
      <span className="text-xs text-ink-muted">Maya is thinking…</span>
    </motion.div>
  )
}

// ── Main ChatWindow ───────────────────────────────────────────────────────────
export default function ChatWindow() {
  const { messages, isLoading, mode } = useChat()
  const bottomRef    = useRef(null)
  const containerRef = useRef(null)
  const isRomantic   = mode === 'romantic'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  return (
    <div className="relative w-full h-full overflow-hidden">

      {/* Animated canvas wallpaper */}
      <AnimatedWallpaper mode={mode} />

      {/* Glassmorphism overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isRomantic
            ? 'linear-gradient(180deg, rgba(10,4,8,0.5) 0%, rgba(10,4,8,0.18) 35%, rgba(10,4,8,0.18) 70%, rgba(10,4,8,0.6) 100%)'
            : 'linear-gradient(180deg, rgba(3,8,14,0.5) 0%, rgba(3,8,14,0.18) 35%, rgba(3,8,14,0.18) 70%, rgba(3,8,14,0.6) 100%)',
        }}
      />

      {/* Content */}
      {messages.length === 0 ? (
        <div className="absolute inset-0 z-10">
          <EmptyState mode={mode} />
        </div>
      ) : (
        <div
          ref={containerRef}
          className="absolute inset-0 z-10 overflow-y-auto px-3 sm:px-4 pt-4 pb-2 scroll-smooth"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.08) transparent',
          }}
        >
          <DatePill />

          <div className="flex flex-col gap-0.5 max-w-3xl mx-auto">
            <AnimatePresence initial={false}>
              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isLast={i === messages.length - 1}
                  prevRole={i > 0 ? messages[i - 1].role : null}
                  nextRole={i < messages.length - 1 ? messages[i + 1].role : null}
                />
              ))}
            </AnimatePresence>
          </div>

          {/* Typing status bar — shown below messages when loading */}
          <div className="max-w-3xl mx-auto">
            <AnimatePresence>
              {isLoading && <TypingStatusBar isRomantic={isRomantic} />}
            </AnimatePresence>
          </div>

          <div ref={bottomRef} className="h-2" />
        </div>
      )}
    </div>
  )
}
