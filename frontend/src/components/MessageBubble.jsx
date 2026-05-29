import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Copy, Check, Wrench, Database, AlertTriangle, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { useChat } from '../context/ChatContext'
import clsx from 'clsx'
import toast from 'react-hot-toast'

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success('Copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy message"
      className={clsx(
        'flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium',
        'border border-white/[0.08] transition-all duration-150 shadow-lg',
        copied
          ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10'
          : 'text-ink-muted bg-black/60 backdrop-blur-md hover:text-ink-secondary hover:bg-white/[0.10] hover:border-white/[0.15]'
      )}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

// ── Regenerate button ─────────────────────────────────────────────────────────
function RegenerateButton({ onRegenerate }) {
  return (
    <button
      onClick={onRegenerate}
      title="Try again"
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-white/[0.08] bg-black/60 backdrop-blur-md shadow-lg text-ink-muted hover:text-ink-secondary hover:bg-white/[0.10] hover:border-white/[0.15] transition-all duration-150"
    >
      <RefreshCw size={11} />
      <span>Try again</span>
    </button>
  )
}

// ── Typing dots ───────────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-0.5">
      {[0, 0.18, 0.36].map((delay, i) => (
        <motion.span key={i}
          className="w-2 h-2 rounded-full bg-ink-muted/50 inline-block"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
          transition={{ duration: 0.9, delay, repeat: Infinity }}
        />
      ))}
    </div>
  )
}

// ── Inline formatting (bold + code) ──────────────────────────────────────────
function inlineFormat(text) {
  if (!text) return null
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-semibold text-ink-primary">{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="font-mono text-[12px] bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-pro">{part.slice(1, -1)}</code>
    return part
  })
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
function SimpleMarkdown({ content }) {
  if (!content) return null
  const lines = content.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++ }
      elements.push(
        <div key={`code-${i}`} className="my-3 rounded-xl overflow-hidden border border-white/[0.10]">
          {lang && (
            <div className="flex items-center px-3 py-1.5 bg-black/40 border-b border-white/[0.08]">
              <span className="text-[10px] font-mono text-ink-muted/60 uppercase tracking-widest">{lang}</span>
            </div>
          )}
          <pre className="bg-black/45 p-4 overflow-x-auto">
            <code className="text-ink-primary/88 font-mono text-[12.5px] leading-relaxed whitespace-pre">{codeLines.join('\n')}</code>
          </pre>
        </div>
      )
    }
    else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="font-display font-bold text-ink-primary text-[15px] mt-4 mb-1.5 leading-snug">{line.slice(4)}</h3>)
    }
    else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="font-display font-bold text-ink-primary text-[17px] mt-5 mb-2 leading-snug">{line.slice(3)}</h2>)
    }
    else if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="font-display font-bold text-ink-primary text-[19px] mt-5 mb-2 leading-snug">{line.slice(2)}</h1>)
    }
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} className="flex gap-3 my-1">
          <span className="text-ink-muted/60 mt-[3px] flex-shrink-0 text-[13px]">•</span>
          <span className="text-[14px] leading-relaxed text-ink-primary/90">{inlineFormat(line.slice(2))}</span>
        </div>
      )
    }
    else if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\./)[1]
      elements.push(
        <div key={i} className="flex gap-3 my-1">
          <span className="text-ink-muted/60 flex-shrink-0 font-mono text-[12px] mt-[3px] w-4 text-right">{num}.</span>
          <span className="text-[14px] leading-relaxed text-ink-primary/90">{inlineFormat(line.replace(/^\d+\.\s/, ''))}</span>
        </div>
      )
    }
    else if (line.trim() === '---' || line.trim() === '***') {
      elements.push(<hr key={i} className="border-white/[0.09] my-3" />)
    }
    else if (line.startsWith('> ')) {
      elements.push(
        <div key={i} className="border-l-2 border-pro/40 pl-3.5 my-2 text-ink-secondary/80 italic text-[13.5px] leading-relaxed">
          {inlineFormat(line.slice(2))}
        </div>
      )
    }
    else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />)
    }
    else {
      elements.push(
        <p key={i} className="my-0.5 leading-[1.72] text-[14px] text-ink-primary/90">{inlineFormat(line)}</p>
      )
    }
    i++
  }

  return <div>{elements}</div>
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ isUser, mode, show }) {
  if (!show) return <div className="w-7 flex-shrink-0" />
  const isRomantic = mode === 'romantic'
  if (isUser) {
    return (
      <div className="w-7 h-7 rounded-full bg-white/[0.10] border border-white/[0.15] flex items-center justify-center flex-shrink-0 self-end">
        <span className="text-[11px] text-ink-secondary font-semibold select-none">U</span>
      </div>
    )
  }
  return (
    <motion.div
      className={clsx('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border self-end',
        isRomantic ? 'bg-rom/20 border-rom/35' : 'bg-pro/20 border-pro/35')}
      animate={isRomantic
        ? { boxShadow: ['0 0 5px #FF6B9D18','0 0 12px #FF6B9D38','0 0 5px #FF6B9D18'] }
        : { boxShadow: ['0 0 5px #00C8FF16','0 0 10px #00C8FF36','0 0 5px #00C8FF16'] }
      }
      transition={{ duration: 2.5, repeat: Infinity }}
    >
      <span className={clsx('text-[11px] font-bold font-display', isRomantic ? 'text-gradient-rom' : 'text-gradient-pro')}>M</span>
    </motion.div>
  )
}

// ── Bubble tail ───────────────────────────────────────────────────────────────
function BubbleTail({ isUser, isRomantic, show }) {
  if (!show) return null
  if (isUser) return (
    <svg className="absolute -right-[7px] bottom-[6px]" width="8" height="13" viewBox="0 0 8 13">
      <path d="M0 0 Q8 6 0 13 L8 13 L8 0 Z" fill={isRomantic ? 'rgba(255,107,157,0.18)' : 'rgba(0,200,255,0.12)'} />
    </svg>
  )
  return (
    <svg className="absolute -left-[7px] bottom-[6px]" width="8" height="13" viewBox="0 0 8 13">
      <path d="M8 0 Q0 6 8 13 L0 13 L0 0 Z" fill="rgba(255,255,255,0.055)" />
    </svg>
  )
}

// ── Tool used badge ───────────────────────────────────────────────────────────
const TOOL_LABELS = {
  get_time: 'Checked the time', get_battery: 'Checked battery', system_info: 'Read system info',
  take_screenshot: 'Took a screenshot', open_app: 'Opened an app', close_app: 'Closed an app',
  list_directory: 'Browsed a folder', search_files: 'Searched for files', create_file: 'Created a file',
  delete_file: 'Deleted a file', rename_file: 'Renamed a file', move_file: 'Moved a file',
  set_reminder: 'Set a reminder', take_note: 'Saved a note', calculator: 'Did the maths',
  running_processes: 'Listed running apps', file_metadata: 'Read file details',
}

function ToolBadge({ toolName }) {
  const label = TOOL_LABELS[toolName] || toolName.replace(/_/g, ' ')
  return (
    <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-ink-muted border-t border-white/[0.08] pt-2">
      <Wrench size={10} className="flex-shrink-0" />
      <span>{label}</span>
    </div>
  )
}

// ── Main MessageBubble ────────────────────────────────────────────────────────
export default function MessageBubble({ message, prevRole, nextRole }) {
  const { mode, sendMessage, messages } = useChat()
  const [hovered, setHovered] = useState(false)
  const hoverTimeoutRef = useRef(null)

  const isUser        = message.role === 'user'
  const isRomantic    = mode === 'romantic'
  const isLastInGroup = nextRole !== message.role
  const showTail      = isLastInGroup

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    }
  }, [])

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    setHovered(true)
  }

  const handleMouseLeave = () => {
    // 500ms grace period before hiding buttons
    hoverTimeoutRef.current = setTimeout(() => {
      setHovered(false)
    }, 500) 
  }

  const handleRegenerate = () => {
    const myIndex = messages.findIndex(m => m.id === message.id)
    for (let i = myIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { sendMessage(messages[i].content); return }
    }
  }

  if (message.isTyping) {
    return (
      <motion.div className="flex items-end gap-2 mb-1"
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      >
        <Avatar isUser={false} mode={mode} show={true} />
        <div className="relative px-4 py-3 rounded-2xl rounded-bl-sm bg-white/[0.06] border border-white/[0.10] shadow-[0_2px_12px_rgba(0,0,0,0.3)]">
          <BubbleTail isUser={false} isRomantic={isRomantic} show={true} />
          <TypingDots />
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      className={clsx(
        'flex items-end gap-2 group',
        isUser ? 'flex-row-reverse' : 'flex-row',
        isLastInGroup ? 'mb-3' : 'mb-0.5'
      )}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Avatar isUser={isUser} mode={mode} show={isLastInGroup} />

      <div className={clsx('flex flex-col min-w-0 relative', isUser ? 'items-end max-w-[72%]' : 'items-start max-w-[78%]')}>

        {/* Bubble */}
        <div className={clsx(
          'relative px-4 py-3 rounded-2xl border shadow-[0_2px_16px_rgba(0,0,0,0.28)]',
          isUser
            ? clsx(
                showTail ? 'rounded-br-sm' : '',
                isRomantic
                  ? 'bg-[rgba(255,107,157,0.15)] border-[rgba(255,107,157,0.28)]'
                  : 'bg-[rgba(0,200,255,0.09)] border-[rgba(0,200,255,0.20)]'
              )
            : clsx(
                showTail ? 'rounded-bl-sm' : '',
                'bg-[rgba(255,255,255,0.055)] border-[rgba(255,255,255,0.10)]'
              ),
          message.isError && '!border-red-500/35 !bg-red-500/10'
        )}>

          <BubbleTail isUser={isUser} isRomantic={isRomantic} show={showTail} />

          {message.isError && (
            <div className="flex items-center gap-1.5 text-red-400 text-xs mb-2.5 font-medium">
              <AlertTriangle size={12} /> Something went wrong
            </div>
          )}

          <SimpleMarkdown content={message.content} />

          {message.toolUsed && <ToolBadge toolName={message.toolUsed} />}

          {message.ragSources?.length > 0 && (
            <div className="mt-2.5 border-t border-white/[0.08] pt-2">
              <div className="flex items-center gap-1 text-[11px] text-ink-muted mb-1.5">
                <Database size={10} /> Based on your documents
              </div>
              <div className="flex flex-wrap gap-1">
                {message.ragSources.slice(0, 3).map((s, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.09] text-ink-secondary">
                    {s.source}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className={clsx('flex items-center gap-2 mt-2', isUser ? 'justify-end' : 'justify-between')}>
            {!isUser && message.metrics && (
              <span className="text-[10px] text-ink-muted/40">
                {message.metrics.latency_ms?.toFixed(0)}ms · {message.metrics.total_tokens} tokens
              </span>
            )}
            <span className="text-[10px] text-ink-muted/45">
              {message.timestamp ? format(new Date(message.timestamp), 'HH:mm') : ''}
            </span>
          </div>
        </div>

        {/* Hover actions - pt-1.5 eliminates physical gap, delay holds state */}
        <div className={clsx(
          'absolute top-full pt-1.5 z-20 flex items-center gap-1.5 transition-all duration-300 ease-out',
          isUser ? 'right-0 flex-row-reverse' : 'left-0 flex-row',
          hovered && !message.isTyping
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-1 pointer-events-none'
        )}>
          <CopyButton text={message.content} />
          {!isUser && <RegenerateButton onRegenerate={handleRegenerate} />}
        </div>
      </div>
    </motion.div>
  )
}