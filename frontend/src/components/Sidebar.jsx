import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Download, RefreshCw, MessageSquare, Wrench,
  Bell, StickyNote, Activity, X, Upload, Loader2,
  Clock, Folder, Search, Trash2, FileText, Move,
  Info, AppWindow, Square, List, Cpu, HelpCircle,
  Monitor, ChevronRight, Database
} from 'lucide-react'
import { useChat } from '../context/ChatContext'
import { mayaApi } from '../services/api'
import toast from 'react-hot-toast'
import clsx from 'clsx'

// ── Clean Tool Catalog — strictly maps backend names to UI labels ──────────────
const TOOL_CATALOG = {
  open_app:          { label: 'Open an app',           icon: AppWindow,  cat: 'System',  example: '"Open Safari"' },
  close_app:         { label: 'Close an app',          icon: Square,     cat: 'System',  example: '"Close Spotify"' },
  system_info:       { label: 'System stats',          icon: Monitor,    cat: 'System',  example: '"Show my RAM and CPU usage"' },
  cpu_usage:         { label: 'CPU Usage',             icon: Cpu,        cat: 'System',  example: '"How busy is my CPU?"' },
  ram_usage:         { label: 'RAM Usage',             icon: Activity,   cat: 'System',  example: '"How much memory is used?"' },
  disk_usage:        { label: 'Disk Space',            icon: Database,   cat: 'System',  example: '"Check my storage space"' },
  take_screenshot:   { label: 'Take a screenshot',     icon: Monitor,    cat: 'System',  example: '"Take a screenshot now"' },
  battery_status:    { label: 'Battery level',         icon: Activity,   cat: 'System',  example: '"How much battery do I have?"' },
  mac_volume:        { label: 'Control volume',        icon: Activity,   cat: 'System',  example: '"Set volume to 50%"' },
  mac_brightness:    { label: 'Control brightness',    icon: Monitor,    cat: 'System',  example: '"Dim the screen"' },
  datetime_now:      { label: 'Current time & date',   icon: Clock,      cat: 'General', example: '"What time is it?"' },
  calculator:        { label: 'Do maths',              icon: Cpu,        cat: 'General', example: '"What is 15% of 3,500?"' },
  set_reminder:      { label: 'Set a reminder',        icon: Bell,       cat: 'General', example: '"Remind me to drink water in 30 mins"' },
  list_reminders:    { label: 'View reminders',        icon: List,       cat: 'General', example: '"What are my reminders?"' },
  create_note:       { label: 'Take a note',           icon: StickyNote, cat: 'General', example: '"Note: buy groceries tomorrow"' },
  show_notes:        { label: 'View notes',            icon: FileText,   cat: 'General', example: '"Show my notes"' },
  start_timer:       { label: 'Start a timer',         icon: Clock,      cat: 'General', example: '"Set a 5 minute timer"' },
  unit_conversion:   { label: 'Convert units',         icon: RefreshCw,  cat: 'General', example: '"Convert 5km to miles"' },
}

const CAT_STYLE = {
  System:  { text: 'text-violet-400', badge: 'bg-violet-500/10 border-violet-500/20 text-violet-400', icon: 'bg-violet-500/10' },
  General: { text: 'text-amber-400',  badge: 'bg-amber-500/10 border-amber-500/20 text-amber-400', icon: 'bg-amber-500/10'  },
}

// ── Shared sub-components ─────────────────────────────────────────────────────
function SectionLabel({ title }) {
  return (
    <p className="text-[10px] font-bold text-ink-muted/50 uppercase tracking-[0.13em] px-1 mb-1.5 mt-4 first:mt-0 select-none">
      {title}
    </p>
  )
}

function ActionBtn({ onClick, disabled, icon: Icon, iconColor, label, sublabel }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left',
        'text-ink-secondary hover:text-ink-primary',
        'hover:bg-white/[0.06] active:bg-white/[0.09]',
        'transition-all duration-150',
        'border border-transparent hover:border-white/[0.07]',
        'disabled:opacity-40 disabled:cursor-not-allowed'
      )}
    >
      {disabled
        ? <Loader2 size={14} className="animate-spin text-ink-muted flex-shrink-0" />
        : <Icon size={14} className={clsx(iconColor, 'flex-shrink-0')} />
      }
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-snug">{label}</div>
        {sublabel && <div className="text-[10px] text-ink-muted/55 leading-snug mt-0.5">{sublabel}</div>}
      </div>
    </button>
  )
}

function EmptyTab({ icon: Icon, title, body }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
      <div className="w-10 h-10 rounded-2xl bg-white/[0.04] flex items-center justify-center border border-white/[0.07]">
        <Icon size={15} className="text-ink-muted/50" />
      </div>
      <div>
        <p className="text-[12px] font-medium text-ink-secondary mb-1">{title}</p>
        <p className="text-[11px] text-ink-muted/55 leading-relaxed whitespace-pre-line">{body}</p>
      </div>
    </div>
  )
}

function TabSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 size={15} className="animate-spin text-ink-muted/40" />
    </div>
  )
}

async function safeCall(fn) {
  try { return (await fn())?.data ?? null } catch { return null }
}

const TABS = [
  { id: 'chat',    icon: MessageSquare, label: 'Chat'    },
  { id: 'tools',   icon: Wrench,        label: 'Skills'  },
  { id: 'history', icon: Clock,         label: 'History' },
  { id: 'notes',   icon: StickyNote,    label: 'Notes'   },
]

export default function Sidebar() {
  const {
    sessionId,
    sessions, messages, mode, sidebarOpen, setSidebarOpen,
    newChat, resetMemory, exportChat, loadSessions, loadOldSession,
    backendStatus,
  } = useChat()

  const [activeTab,    setActiveTab]    = useState('chat')
  const [rawTools,     setRawTools]     = useState([])
  const [notes,        setNotes]        = useState([])
  const [loading,      setLoading]      = useState(false)
  const [uploading,    setUploading]    = useState(false)
  const [expandedTool, setExpandedTool] = useState(null)

  const fileInputRef = React.useRef(null)
  const isRomantic   = mode === 'romantic'
  const accent       = isRomantic ? 'text-rom'      : 'text-pro'
  const accentBg     = isRomantic ? 'bg-rom/10'     : 'bg-pro/10'
  const accentBdr    = isRomantic ? 'border-rom/25' : 'border-pro/25'

  const loadTab = useCallback(async (tab) => {
    setLoading(true)
    try {
      switch (tab) {
        case 'history': await loadSessions(); break
        case 'notes':   { const d = await safeCall(() => mayaApi.getNotes());   setNotes(d?.notes ?? []);   break }
        case 'tools':   { const d = await safeCall(() => mayaApi.listTools());  setRawTools(d?.tools ?? []); break }
        default: break
      }
    } finally { setLoading(false) }
  }, [loadSessions])

  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab)
    if (tab !== 'chat') loadTab(tab)
  }, [loadTab])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await mayaApi.uploadDocument(file)
      toast.success(`Indexed ${res.data?.chunks_indexed ?? '?'} chunks from "${file.name}"`)
    } catch (err) {
      toast.error(`Upload failed: ${err.response?.data?.error || err.message}`)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const enrichedTools = rawTools
    .map(t => {
      const info = TOOL_CATALOG[t.name]
      if (!info) return null
      return { ...t, ...info }
    })
    .filter(Boolean)

  const toolsByCategory = enrichedTools.reduce((acc, t) => {
    const cat = t.cat || 'General'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(t)
    return acc
  }, {})

  // Filter out 0-message sessions (unless it's the one we are currently in)
  const visibleSessions = sessions.filter(s => s.message_count > 0 || s.id === sessionId)


  const sidebarBg = {
    background: isRomantic ? 'rgba(10,3,7,0.90)' : 'rgba(3,8,15,0.90)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
  }

  return (
    <>
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            className="fixed inset-0 bg-black/60 z-20 lg:hidden"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <motion.aside
        className={clsx(
          'fixed lg:relative z-30 lg:z-auto h-full flex flex-col w-[260px] flex-shrink-0',
          'border-r border-white/[0.07] transition-transform duration-300 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        style={sidebarBg}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.07] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <motion.div
              className={clsx('w-8 h-8 rounded-xl flex items-center justify-center border relative overflow-hidden flex-shrink-0', accentBg, accentBdr)}
              animate={isRomantic
                ? { boxShadow: ['0 0 8px #FF6B9D20','0 0 18px #FF6B9D40','0 0 8px #FF6B9D20'] }
                : { boxShadow: ['0 0 8px #00C8FF18','0 0 16px #00C8FF38','0 0 8px #00C8FF18'] }
              }
              transition={{ duration: 2.5, repeat: Infinity }}
            >
              <motion.div className="absolute inset-0 opacity-40"
                style={{ background: isRomantic
                  ? 'conic-gradient(from 0deg, transparent, rgba(255,107,157,0.5), transparent)'
                  : 'conic-gradient(from 0deg, transparent, rgba(0,200,255,0.4), transparent)' }}
                animate={{ rotate: 360 }}
                transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
              />
              <span className={clsx('text-sm font-bold font-display relative z-10', accent)}>M</span>
            </motion.div>
            <div className="leading-none">
              <p className="font-display font-bold text-ink-primary text-sm">Maya</p>
              <p className="text-[10px] text-ink-muted/50">Your offline AI assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={clsx(
              'flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border',
              backendStatus === 'connected'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            )}>
              <motion.span
                className={clsx('w-1.5 h-1.5 rounded-full', backendStatus === 'connected' ? 'bg-emerald-400' : 'bg-red-400')}
                animate={{ opacity: backendStatus === 'connected' ? [1, 0.4, 1] : 1 }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              {backendStatus === 'connected' ? 'Online' : 'Offline'}
            </div>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1.5 rounded-lg hover:bg-white/[0.07] text-ink-muted">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-white/[0.06] flex-shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => handleTabChange(tab.id)}
              className={clsx(
                'flex flex-col items-center gap-0.5 px-2 py-2.5 text-[10px] flex-1 min-w-0',
                'transition-all duration-150 border-b-2',
                activeTab === tab.id
                  ? clsx('font-semibold', isRomantic ? 'border-rom text-rom bg-rom/[0.06]' : 'border-pro text-pro bg-pro/[0.06]')
                  : 'text-ink-muted/55 hover:text-ink-secondary border-transparent hover:bg-white/[0.04]'
              )}
            >
              <tab.icon size={13} />
              <span className="truncate w-full text-center leading-none">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-3 py-3" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.06) transparent' }}>

          {/* ── CHAT ── */}
          {activeTab === 'chat' && (
            <div className="space-y-0.5">
              <SectionLabel title="Actions" />
              <ActionBtn onClick={newChat}     icon={Plus}      iconColor={accent}         label="New Chat"        sublabel="Start a fresh conversation" />
              <ActionBtn onClick={resetMemory} icon={RefreshCw} iconColor="text-amber-400" label="Clear Memory"    sublabel="Reset session context" />
              <ActionBtn onClick={exportChat}  icon={Download}  iconColor="text-sky-400"   label="Export Chat"     sublabel="Save conversation to file" />
              <ActionBtn
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                icon={Upload} iconColor="text-violet-400"
                label={uploading ? 'Uploading…' : 'Upload a Document'}
                sublabel="Ask questions about a PDF, DOCX, or TXT"
              />
              <input ref={fileInputRef} type="file" accept=".pdf,.txt,.docx,.md" className="hidden" onChange={handleUpload} />

              <div className="mt-3 p-3 rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                <p className="text-[11px] font-semibold text-ink-secondary mb-2.5">💡 How to talk to Maya</p>
                <div className="space-y-2">
                  {[
                    ['🎙️', 'Say "Hey Maya" to use your voice'],
                    ['⌨️',  'Type anything in the box below'],
                    ['📄', 'Upload a document and ask about it'],
                    ['🔧', 'Open "Skills" to see what I can do'],
                  ].map(([icon, tip]) => (
                    <div key={tip} className="flex items-start gap-2">
                      <span className="text-[13px] flex-shrink-0">{icon}</span>
                      <p className="text-[11px] text-ink-muted/65 leading-snug">{tip}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <SectionLabel title="This session" />
                {[
                  ['Mode',     mode === 'romantic' ? '❤️ Personal' : '💼 Professional'],
                  ['Messages', `${messages.filter(m => m.role === 'user').length} sent`],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between px-1 py-1">
                    <span className="text-[11px] text-ink-muted/55">{label}</span>
                    <span className={clsx('text-[11px]', label === 'Mode' ? accent : 'text-ink-secondary')}>{val}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── SKILLS / TOOLS ── */}
          {activeTab === 'tools' && (
            <div>
              <div className="mb-3 p-3 rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                <p className="text-[12px] font-semibold text-ink-primary mb-1">What can Maya do?</p>
                <p className="text-[11px] text-ink-muted/65 leading-relaxed">
                  Maya can control your Mac, manage files, set reminders, and answer questions — everything works offline.
                </p>
              </div>

              {loading ? <TabSpinner /> : enrichedTools.length === 0
                ? <EmptyTab icon={Wrench} title="No skills loaded" body="Make sure the Maya backend is running." />
                : (
                  <div className="space-y-4">
                    {Object.entries(toolsByCategory).map(([cat, tools]) => {
                      const style = CAT_STYLE[cat] || CAT_STYLE.General
                      return (
                        <div key={cat}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <SectionLabel title={cat} />
                            <span className={clsx('text-[9px] px-1.5 py-0.5 rounded-full border font-bold ml-1', style.badge)}>
                              {tools.length}
                            </span>
                          </div>
                          <div className="space-y-1">
                            {tools.map(t => {
                              const Icon = t.icon || HelpCircle
                              const isOpen = expandedTool === t.name
                              return (
                                <div key={t.name}>
                                  <button
                                    onClick={() => setExpandedTool(isOpen ? null : t.name)}
                                    className={clsx(
                                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 border',
                                      isOpen
                                        ? 'border-white/[0.12] bg-white/[0.07]'
                                        : 'border-transparent bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.08]'
                                    )}
                                  >
                                    <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', style.icon)}>
                                      <Icon size={13} className={style.text} />
                                    </div>
                                    <p className="text-[13px] text-ink-primary font-medium flex-1 leading-snug">{t.label}</p>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      <span className={clsx('w-1.5 h-1.5 rounded-full', t.enabled !== false ? 'bg-emerald-500' : 'bg-red-400/60')} />
                                      <ChevronRight size={11} className={clsx('text-ink-muted/35 transition-transform duration-150', isOpen && 'rotate-90')} />
                                    </div>
                                  </button>

                                  <AnimatePresence>
                                    {isOpen && t.example && (
                                      <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ duration: 0.16 }}
                                        className="overflow-hidden"
                                      >
                                        <div className="mx-3 mb-1 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                                          <p className="text-[10px] text-ink-muted/45 uppercase tracking-widest mb-1.5">Try saying</p>
                                          <p className="text-[12px] text-ink-secondary italic leading-relaxed">{t.example}</p>
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              }
            </div>
          )}

          {/* ── HISTORY ── */}
          {activeTab === 'history' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <SectionLabel title={`${visibleSessions.length} past conversation${visibleSessions.length !== 1 ? 's' : ''}`} />
                <button onClick={() => loadTab('history')} className="p-1 rounded-lg hover:bg-white/[0.05] text-ink-muted transition-colors">
                  <RefreshCw size={11} />
                </button>
              </div>
              {loading ? <TabSpinner /> : visibleSessions.length === 0
                ? <EmptyTab icon={Clock} title="No history yet" body="Your past conversations will appear here after you start chatting." />
                : (
                  <div className="space-y-1.5">
                    {visibleSessions.slice(0, 20).map((s, i) => {
                      const isActive = s.id === sessionId; // Check if this is the active chat
                      return (
                        <motion.button 
                          key={s.id || i}
                          onClick={() => {
                            if (!isActive) {
                              loadOldSession(s.id, s.mode)
                              setActiveTab('chat')
                              if (window.innerWidth < 1024) setSidebarOpen(false) 
                            }
                          }}
                          initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}
                          className={clsx(
                            "w-full text-left px-3 py-2.5 rounded-xl border transition-all cursor-pointer",
                            isActive
                              ? (isRomantic 
                                  ? 'bg-rom/[0.12] border-rom/40 shadow-[0_0_12px_rgba(255,107,157,0.1)]' 
                                  : 'bg-pro/[0.12] border-pro/40 shadow-[0_0_12px_rgba(0,200,255,0.1)]')
                              : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.10]'
                          )}
                        >
                          {/* ── TOPIC / TITLE ── */}
                          <p className={clsx(
                            "text-[12px] font-medium leading-snug mb-1.5 line-clamp-1 break-all",
                            isActive ? (isRomantic ? 'text-rom' : 'text-pro') : 'text-ink-primary'
                          )}>
                            {s.title || (s.message_count > 0 ? "Conversation" : "New Conversation")}
                          </p>
                          
                          {/* ── METADATA ROW ── */}
                          <div className="flex items-center gap-2">
                            <span className={clsx(
                              'text-[9px] px-1.5 py-0.5 rounded-full font-medium border uppercase tracking-wide',
                              s.mode === 'romantic' ? 'bg-rom/10 text-rom/80 border-rom/20' : 'bg-pro/10 text-pro/80 border-pro/20'
                            )}>
                              {s.mode === 'romantic' ? '❤️ Personal' : '💼 Work'}
                            </span>
                            
                            <span className="text-[10px] text-ink-muted/50 ml-auto">
                              {s.message_count ?? 0} msgs
                            </span>
                          </div>
                        </motion.button>
                      )
                    })}
                  </div>
                )
              }
            </div>
          )}

          {/* ── NOTES ── */}
          {activeTab === 'notes' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <SectionLabel title={`${notes.length} note${notes.length !== 1 ? 's' : ''}`} />
                <button onClick={() => loadTab('notes')} className="p-1 rounded-lg hover:bg-white/[0.05] text-ink-muted"><RefreshCw size={11} /></button>
              </div>
              {loading ? <TabSpinner /> : notes.length === 0
                ? <EmptyTab icon={StickyNote} title="No notes yet" body={'Say: "Maya, note: buy groceries tomorrow"'} />
                : (
                  <div className="space-y-2">
                    {notes.map((n, i) => (
                      <motion.div key={n.id || i}
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                        className="px-3 py-3 rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-white/[0.12] transition-colors"
                      >
                        {n.title && <p className="text-xs font-semibold text-ink-primary mb-1">{n.title}</p>}
                        <p className="text-[12px] text-ink-secondary leading-relaxed line-clamp-3">{n.content}</p>
                        {n.created_at && (
                          <p className="text-[10px] text-ink-muted/45 mt-1.5">
                            {new Date(n.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                      </motion.div>
                    ))}
                  </div>
                )
              }
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-4 py-2.5 border-t border-white/[0.06]">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-ink-muted/35 select-none">🔒 100% offline · No data shared</p>
            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full border font-medium', isRomantic ? 'bg-rom/10 border-rom/20 text-rom/60' : 'bg-pro/10 border-pro/20 text-pro/60')}>v1.0.0</span>
          </div>
        </div>
      </motion.aside>
    </>
  )
}