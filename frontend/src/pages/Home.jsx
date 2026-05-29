// src/pages/Home.jsx
import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu } from 'lucide-react'
import ChatWindow from '../components/ChatWindow'
import InputBox from '../components/InputBox'
import Sidebar from '../components/Sidebar'
import StatusBar from '../components/StatusBar'
import ModeToggle from '../components/ModeToggle'
import AnimatedWallpaper from '../components/AnimatedWallpaper'
import { useChat } from '../context/ChatContext'
import clsx from 'clsx'

export default function Home() {
  const { mode, sidebarOpen, setSidebarOpen, voiceState } = useChat()
  const isRomantic = mode === 'romantic'

  return (
    <div className="flex h-screen overflow-hidden relative">

      {/* ── Full-screen wallpaper behind everything ── */}
      <div className="absolute inset-0 z-0">
        <AnimatedWallpaper mode={mode} />
      </div>

      {/* ── Global darkening scrim ── */}
      <div
        className="absolute inset-0 z-0 pointer-events-none transition-all duration-700"
        style={{
          background: isRomantic ? 'rgba(8,2,6,0.74)' : 'rgba(2,6,12,0.74)',
        }}
      />

      {/* ── Sidebar ── */}
      <div className="relative z-10">
        <Sidebar />
      </div>

      {/* ── Main column ── */}
      {/* overflow-hidden is critical — prevents children from escaping the flex column */}
      <div className="relative z-10 flex flex-col flex-1 min-w-0 overflow-hidden" style={{ height: '100vh' }}>

        {/* Header */}
        <header className={clsx(
          'relative z-50 flex items-center justify-between px-4 py-2.5 flex-shrink-0 flex-grow-0',
          'border-b backdrop-blur-xl transition-all duration-700',
          isRomantic
            ? 'border-white/[0.07] bg-[rgba(8,2,6,0.60)]'
            : 'border-white/[0.07] bg-[rgba(2,6,12,0.60)]'
        )}>

          {/* Left: hamburger + brand + status */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(o => !o)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-white/[0.06] text-ink-muted transition-colors flex-shrink-0"
            >
              <Menu size={17} />
            </button>

            {/* Brand mark */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <motion.div
                className={clsx(
                  'w-7 h-7 rounded-xl flex items-center justify-center border relative overflow-hidden',
                  isRomantic ? 'bg-rom/12 border-rom/30' : 'bg-pro/12 border-pro/30'
                )}
                animate={isRomantic
                  ? { boxShadow: ['0 0 8px #FF6B9D28','0 0 18px #FF6B9D48','0 0 8px #FF6B9D28'] }
                  : { boxShadow: ['0 0 8px #00C8FF20','0 0 18px #00C8FF40','0 0 8px #00C8FF20'] }
                }
                transition={{ duration: 2.5, repeat: Infinity }}
              >
                <motion.div
                  className="absolute inset-0 opacity-50"
                  style={{
                    background: isRomantic
                      ? 'conic-gradient(from 0deg, transparent, rgba(255,107,157,0.4), transparent)'
                      : 'conic-gradient(from 0deg, transparent, rgba(0,200,255,0.35), transparent)',
                  }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
                />
                <span className={clsx(
                  'text-[12px] font-bold font-display relative z-10',
                  isRomantic ? 'text-gradient-rom' : 'text-gradient-pro'
                )}>M</span>
              </motion.div>

              <div className="hidden sm:flex flex-col leading-none">
                <span className="font-display font-bold text-ink-primary text-[13px]">Maya</span>
                <span className={clsx(
                  'text-[9px] font-medium tracking-widest',
                  isRomantic ? 'text-rom/55' : 'text-pro/55'
                )}>
                  {isRomantic ? 'COMPANION' : 'ASSISTANT'}
                </span>
              </div>
            </div>

            {/* Separator */}
            <div className="hidden sm:block w-px h-5 bg-white/[0.10] flex-shrink-0" />

            {/* Status bar — collapses on mobile */}
            <div className="hidden sm:flex">
              <StatusBar />
            </div>
          </div>

          {/* Right: mode toggle */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <ModeToggle />
          </div>
        </header>

        {/* Chat messages area — flex-1 + min-h-0 makes it fill exactly the remaining space */}
        {/* overflow-hidden prevents it from growing beyond the column */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatWindow />
        </div>

        {/* Input area — flex-shrink-0 pins it permanently to the bottom */}
        <div className={clsx(
          'flex-shrink-0 flex-grow-0 border-t backdrop-blur-xl transition-all duration-700',
          isRomantic
            ? 'border-white/[0.07] bg-[rgba(8,2,6,0.72)]'
            : 'border-white/[0.07] bg-[rgba(2,6,12,0.72)]'
        )}>
          <div className="max-w-3xl mx-auto">
            <InputBox />
          </div>
          <p className="text-center text-[11px] text-ink-muted/35 pb-2.5 -mt-1 select-none">
            Maya runs 100% offline · No data leaves your device
          </p>
        </div>
      </div>

      {/* Wake word toast bubble */}
      <AnimatePresence>
        {voiceState === 'activated' && (
          <motion.div
            className={clsx(
              'fixed bottom-28 right-5 flex items-center gap-2 z-50',
              'backdrop-blur-xl rounded-full px-4 py-2 border shadow-2xl',
              isRomantic
                ? 'bg-[rgba(255,107,157,0.10)] border-rom/28'
                : 'bg-[rgba(0,200,255,0.08)] border-pro/28'
            )}
            initial={{ opacity: 0, y: 10, scale: 0.88 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.88 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            <motion.span
              className={clsx('w-2 h-2 rounded-full', isRomantic ? 'bg-rom' : 'bg-pro')}
              animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            <span className="text-xs text-ink-secondary font-medium">Maya is listening…</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
