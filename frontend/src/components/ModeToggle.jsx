// src/components/ModeToggle.jsx
import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Briefcase, Heart } from 'lucide-react'
import { useChat } from '../context/ChatContext'
import clsx from 'clsx'

export default function ModeToggle() {
  const { mode, switchMode } = useChat()
  const isRomantic = mode === 'romantic'

  return (
    <div className="flex items-center gap-2">

      {/* Professional label */}
      <span className={clsx(
        'text-[12px] font-medium transition-colors duration-300 hidden sm:block select-none',
        !isRomantic ? 'text-pro' : 'text-ink-muted/50'
      )}>
        Work
      </span>

      {/* Toggle track */}
      <button
        onClick={() => switchMode(isRomantic ? 'professional' : 'romantic')}
        className={clsx(
          'relative w-11 h-[22px] rounded-full transition-all duration-300',
          'border focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
          isRomantic
            ? 'bg-rom/25 border-rom/40 focus-visible:ring-rom/60'
            : 'bg-pro/25 border-pro/40 focus-visible:ring-pro/60'
        )}
        aria-label={`Switch to ${isRomantic ? 'professional' : 'personal'} mode`}
        role="switch"
        aria-checked={isRomantic}
      >
        {/* Thumb */}
        <motion.div
          className={clsx(
            'absolute top-[2px] w-[18px] h-[18px] rounded-full',
            'flex items-center justify-center shadow-sm',
            isRomantic ? 'bg-rom' : 'bg-pro'
          )}
          animate={{ x: isRomantic ? 22 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        >
          <AnimatePresence mode="wait">
            {isRomantic ? (
              <motion.div
                key="heart"
                initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
                transition={{ duration: 0.15 }}
              >
                <Heart size={9} className="fill-white text-white" />
              </motion.div>
            ) : (
              <motion.div
                key="brief"
                initial={{ opacity: 0, rotate: 90, scale: 0.6 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: -90, scale: 0.6 }}
                transition={{ duration: 0.15 }}
              >
                <Briefcase size={9} className="text-[#030810]" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </button>

      {/* Personal label */}
      <span className={clsx(
        'text-[12px] font-medium transition-colors duration-300 hidden sm:block select-none',
        isRomantic ? 'text-rom' : 'text-ink-muted/50'
      )}>
        Personal
      </span>
    </div>
  )
}
