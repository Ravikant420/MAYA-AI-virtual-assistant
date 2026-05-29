import React, { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff } from 'lucide-react'
import { useChat } from '../context/ChatContext'
import clsx from 'clsx'

// Animated ring component
function Ring({ delay = 0, scale = 1, color = '#00C8FF', opacity = 0.3 }) {
  return (
    <motion.div
      className="absolute rounded-full border"
      style={{
        width: `${60 * scale}px`,
        height: `${60 * scale}px`,
        borderColor: color,
        opacity,
      }}
      animate={{
        scale: [1, 1.15, 1],
        opacity: [opacity, opacity * 0.4, opacity],
      }}
      transition={{
        duration: 1.8,
        delay,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    />
  )
}

export default function VoiceVisualizer() {
  const { voiceState, mode, startVoice, isListening } = useChat()
  const isRomantic = mode === 'romantic'
  const accent = isRomantic ? '#FF6B9D' : '#00C8FF'
  const activated = voiceState === 'activated'
  const listening = voiceState === 'listening'

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Main button with visualizer */}
      <div className="relative flex items-center justify-center w-20 h-20">
        {/* Pulsing rings when listening */}
        <AnimatePresence>
          {listening && (
            <>
              <Ring delay={0}    scale={1}    color={accent} opacity={0.25} />
              <Ring delay={0.3}  scale={1.35} color={accent} opacity={0.15} />
              <Ring delay={0.6}  scale={1.7}  color={accent} opacity={0.08} />
            </>
          )}
          {activated && (
            <>
              <Ring delay={0}   scale={1}    color="#4ADE80" opacity={0.4} />
              <Ring delay={0.2} scale={1.4}  color="#4ADE80" opacity={0.2} />
            </>
          )}
        </AnimatePresence>

        {/* Rotating outer ring when listening */}
        <AnimatePresence>
          {listening && (
            <motion.div
              className="absolute w-16 h-16 rounded-full"
              style={{
                background: `conic-gradient(from 0deg, ${accent}00, ${accent}88, ${accent}00)`,
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              initial={{ opacity: 0 }}
              exit={{ opacity: 0 }}
            />
          )}
        </AnimatePresence>

        {/* Core button */}
        <motion.button
          onClick={startVoice}
          disabled={isListening}
          className={clsx(
            'relative z-10 w-12 h-12 rounded-full flex items-center justify-center',
            'transition-all duration-300 focus:outline-none',
            activated
              ? 'bg-emerald-500 shadow-[0_0_20px_rgba(74,222,128,0.5)]'
              : listening
                ? isRomantic
                  ? 'bg-rom shadow-glow-rom'
                  : 'bg-pro shadow-glow-pro'
                : isRomantic
                  ? 'bg-rom/20 border border-rom/40 hover:bg-rom/30'
                  : 'bg-pro/20 border border-pro/40 hover:bg-pro/30'
          )}
          whileTap={{ scale: 0.92 }}
          animate={listening ? { scale: [1, 1.05, 1] } : {}}
          transition={listening ? { duration: 0.8, repeat: Infinity } : {}}
        >
          <AnimatePresence mode="wait">
            {activated ? (
              <motion.div key="check"
                initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              >
                <Mic size={20} className="text-void" />
              </motion.div>
            ) : (
              <motion.div key="mic"
                initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              >
                <Mic size={20} className={listening ? 'text-void' : isRomantic ? 'text-rom' : 'text-pro'} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </div>

      {/* Status text */}
      <AnimatePresence mode="wait">
        {listening && (
          <motion.p
            key="listening"
            className={clsx('text-xs font-medium', isRomantic ? 'text-rom' : 'text-pro')}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <span className="animate-pulse">●</span> Listening...
          </motion.p>
        )}
        {activated && (
          <motion.p
            key="activated"
            className="text-xs font-medium text-emerald-400"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            ✓ Maya Activated
          </motion.p>
        )}
        {voiceState === 'idle' && (
          <motion.p
            key="idle"
            className="text-xs text-ink-muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            Click to speak
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
