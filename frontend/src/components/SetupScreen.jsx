/**
 * src/components/SetupScreen.jsx
 * BGMI-style launcher — step-wise installation with progress,
 * skip already-installed, retry on failure, platform-aware messaging.
 */

import { useState, useEffect, useRef } from 'react'

const isElectron = typeof window !== 'undefined' && !!window.mayaElectron

function fmt(b) {
  if (!b || b < 0) return '—'
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB'
  if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB'
  return b + ' B'
}
function spd(bps) {
  if (!bps || bps < 50000) return ''
  return fmt(bps) + '/s'
}

const STEPS = [
  { id: 'ollama',    icon: '⚡', label: 'Ollama Runtime',    desc: 'Local AI inference engine', size: '~50 MB'  },
  { id: 'model',     icon: '🤖', label: 'AI Language Model', desc: 'Llama 3.2 — runs offline',  size: '~2.0 GB' },
  { id: 'piper_bin', icon: '🔊', label: 'Voice Engine',      desc: 'Piper text-to-speech',      size: '~30 MB'  },
  { id: 'piper_en',  icon: '🇺🇸', label: 'English Voice',    desc: 'en_US natural voice model',  size: '~60 MB'  },
  { id: 'piper_hi',  icon: '🇮🇳', label: 'Hindi Voice',      desc: 'hi_IN natural voice model',  size: '~60 MB'  },
]
const TOTAL_MB = 2200

const MESSAGES = [
  'Checking system environment...',
  'Verifying AI components...',
  'Preparing voice engine...',
  'Initializing model storage...',
  'Almost ready...',
]

export default function SetupScreen({ onComplete, installed = {} }) {
  const [phase, setPhase]       = useState('init')      // init|installing|done|failed
  const [stepSt, setStepSt]     = useState({})
  const [prog, setProg]         = useState({})
  const [activeId, setActiveId] = useState('')
  const [errMsg, setErrMsg]     = useState('')
  const [msgIdx, setMsgIdx]     = useState(0)
  const [dots, setDots]         = useState('.')
  const [retryCount, setRetry]  = useState(0)

  // Animated dots + cycling messages during init
  useEffect(() => {
    const t = setInterval(() => {
      setDots(d => d.length >= 3 ? '.' : d + '.')
      if (phase === 'init') setMsgIdx(i => (i + 1) % MESSAGES.length)
    }, 600)
    return () => clearInterval(t)
  }, [phase])

  // Overall percent
  const totalPct = Math.round(
    STEPS.map(s => {
      if (stepSt[s.id] === 'done') return 100
      return prog[s.id]?.percent || 0
    }).reduce((a, b) => a + b, 0) / STEPS.length
  )
  const downloadedMB = Math.round(TOTAL_MB * totalPct / 100)

  // Active step meta
  const activeMeta = STEPS.find(s => s.id === activeId)

  // Electron setup-progress events
  useEffect(() => {
    if (!isElectron) return
    const unsub = window.mayaElectron.onSetupProgress(data => {
      if (data.type === 'progress') {
        setProg(p => ({ ...p, [data.stepId]: { percent: data.percent, speed: data.speed, received: data.received, total: data.total } }))
      } else if (data.type === 'status') {
        setStepSt(s => ({ ...s, [data.stepId]: data.state }))
        if (data.state === 'active') setActiveId(data.stepId)
      } else if (data.type === 'complete') {
        setPhase('done')
        setTimeout(() => onComplete(), 2200)
      } else if (data.type === 'error') {
        setErrMsg(data.message || 'Installation failed')
        setPhase('failed')
      }
    })
    return unsub
  }, [onComplete])

  // Auto-start
  useEffect(() => { start() }, [])

  async function start() {
    setPhase('init')
    setErrMsg('')

    // Pre-mark already-installed steps
    const initSt = {}, initPr = {}
    STEPS.forEach(s => {
      const done  = !!installed[s.id]
      initSt[s.id] = done ? 'done' : 'pending'
      initPr[s.id] = done ? { percent: 100 } : { percent: 0 }
    })
    setStepSt(initSt)
    setProg(initPr)

    // Checking phase — let messages cycle
    await new Promise(r => setTimeout(r, 1200))
    setPhase('installing')

    if (!isElectron) {
      // Dev simulation
      for (const step of STEPS) {
        if (initSt[step.id] === 'done') continue
        setStepSt(s => ({ ...s, [step.id]: 'active' }))
        setActiveId(step.id)
        for (let i = 0; i <= 100; i += 3) {
          await new Promise(r => setTimeout(r, 40))
          setProg(p => ({ ...p, [step.id]: { percent: i, speed: 8_500_000 } }))
        }
        setStepSt(s => ({ ...s, [step.id]: 'done' }))
      }
      setPhase('done')
      setTimeout(() => onComplete(), 2200)
      return
    }

    const result = await window.mayaElectron.runSetup()
    if (!result.ok) {
      setErrMsg(result.error || 'Installation failed')
      setPhase('failed')
    }
  }

  async function handleReinstall() {
    setRetry(r => r + 1)
    // Reset setup flag and retry
    await window.mayaElectron?.resetSetup?.()
    // Refresh install status
    let fresh = {}
    try { fresh = await window.mayaElectron.getInstallStatus() } catch {}
    // Merge with current — keep what's done
    const merged = {}
    STEPS.forEach(s => { merged[s.id] = fresh[s.id] || installed[s.id] })
    // Restart
    await start()
  }

  return (
    <div style={{
      position:'fixed', inset:0, background:'#060A0E',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      fontFamily:"'SF Pro Display',-apple-system,BlinkMacSystemFont,sans-serif",
      overflow:'hidden', WebkitAppRegion:'drag',
    }}>

      {/* ── Animated grid background ── */}
      <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',opacity:.05}}>
        <defs>
          <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#0D9488" strokeWidth=".6"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)"/>
      </svg>

      {/* ── Glow orbs ── */}
      <div style={{position:'absolute',width:800,height:800,borderRadius:'50%',pointerEvents:'none',
        background:'radial-gradient(circle,rgba(13,148,136,.09) 0%,transparent 60%)',
        top:'50%',left:'50%',transform:'translate(-52%,-50%)'}}/>
      <div style={{position:'absolute',width:500,height:500,borderRadius:'50%',pointerEvents:'none',
        background:'radial-gradient(circle,rgba(99,102,241,.06) 0%,transparent 60%)',
        top:'20%',left:'65%'}}/>

      {/* ── Main panel ── */}
      <div style={{
        position:'relative', zIndex:10, width:540, maxWidth:'91vw',
        WebkitAppRegion:'no-drag',
      }}>

        {/* ── Logo ── */}
        <div style={{textAlign:'center',marginBottom:28}}>
          <div style={{
            width:80,height:80,borderRadius:20,margin:'0 auto 14px',
            background:'linear-gradient(145deg,#0D9488 0%,#0EA5E9 100%)',
            display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:36,fontWeight:800,color:'#fff',
            boxShadow: phase==='failed'
              ? '0 0 50px rgba(239,68,68,.5)'
              : '0 0 55px rgba(13,148,136,.55),0 0 110px rgba(13,148,136,.22)',
            animation: phase!=='failed'&&phase!=='done' ? 'pulse 2.5s ease-in-out infinite' : 'none',
            transition:'box-shadow .5s',
          }}>M</div>

          <div style={{fontSize:26,fontWeight:700,color:'#F0FDFA',letterSpacing:-.5,marginBottom:4}}>
            Maya AI Assistant
          </div>
          <div style={{fontSize:12,color:'#334155',minHeight:18,transition:'opacity .3s'}}>
            {phase==='init'        && `${MESSAGES[msgIdx]}${dots}`}
            {phase==='installing'  && (activeMeta ? `Installing ${activeMeta.label}${dots}` : `Preparing${dots}`)}
            {phase==='done'        && '✓ All components installed — launching'}
            {phase==='failed'      && 'Installation encountered an error'}
          </div>
        </div>

        {/* ── Step list ── */}
        <div style={{
          background:'rgba(8,14,22,.88)',
          border:'1px solid rgba(13,148,136,.13)',
          borderRadius:16,padding:'6px 18px',
          marginBottom:18,backdropFilter:'blur(24px)',
        }}>
          {STEPS.map((step, i) => {
            const st    = stepSt[step.id] || 'pending'
            const p     = prog[step.id]   || {}
            const pct   = p.percent || (st==='done' ? 100 : 0)
            const done  = st === 'done'
            const act   = st === 'active'
            const fail  = st === 'error'
            const pend  = st === 'pending'

            return (
              <div key={step.id} style={{
                padding:'11px 0',
                borderBottom: i<STEPS.length-1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                opacity: pend ? 0.38 : 1,
                transition: 'opacity .4s',
              }}>
                <div style={{display:'flex',alignItems:'center',gap:13}}>

                  {/* Icon badge */}
                  <div style={{
                    width:36,height:36,borderRadius:10,flexShrink:0,
                    display:'flex',alignItems:'center',justifyContent:'center',
                    fontSize:17,
                    background: done ? 'rgba(13,148,136,.22)'  :
                                act  ? 'rgba(13,148,136,.12)'  :
                                fail ? 'rgba(239,68,68,.15)'   : 'rgba(255,255,255,.04)',
                    border:`1px solid ${
                      done ? 'rgba(13,148,136,.45)' :
                      act  ? 'rgba(13,148,136,.28)' :
                      fail ? 'rgba(239,68,68,.3)'   : 'rgba(255,255,255,.07)'}`,
                    boxShadow: act ? '0 0 14px rgba(13,148,136,.35)' : 'none',
                    transition:'all .35s',
                  }}>
                    {done ? '✓' : fail ? '✗' : step.icon}
                  </div>

                  {/* Info */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{
                      display:'flex',justifyContent:'space-between',alignItems:'center',
                      marginBottom: (act||done) ? 6 : 0,
                    }}>
                      <div>
                        <span style={{
                          fontSize:13,fontWeight:600,
                          color: done?'#0D9488':act?'#E2E8F0':fail?'#F87171':'#4B5563',
                          transition:'color .3s',
                        }}>{step.label}</span>
                        {act && (
                          <span style={{fontSize:10,color:'#334155',marginLeft:8}}>
                            {step.desc}
                          </span>
                        )}
                      </div>
                      <span style={{fontSize:11,color:'#1F2937',flexShrink:0,marginLeft:8}}>
                        {done
                          ? <span style={{color:'#0D9488',fontWeight:700}}>✓ Done</span>
                          : act && p.total
                            ? <span style={{color:'#475569'}}>{fmt(p.received)} / {fmt(p.total)}</span>
                            : <span style={{color:'#1F2937'}}>{step.size}</span>
                        }
                      </span>
                    </div>

                    {/* Progress bar */}
                    {(act||done) && (
                      <div>
                        <div style={{height:3,borderRadius:99,background:'rgba(255,255,255,.05)',overflow:'hidden'}}>
                          <div style={{
                            height:'100%',borderRadius:99,
                            width:`${pct}%`,
                            background: done
                              ? 'rgba(13,148,136,.6)'
                              : 'linear-gradient(90deg,#0D9488,#38BDF8)',
                            backgroundSize:'200% 100%',
                            transition:'width .2s ease',
                            boxShadow: act ? '0 0 8px rgba(13,148,136,.7)' : 'none',
                            animation: act ? 'shimmer 2s linear infinite' : 'none',
                          }}/>
                        </div>
                        {act && p.speed > 0 && (
                          <div style={{fontSize:10,color:'#1F2937',marginTop:3,textAlign:'right'}}>
                            {spd(p.speed)} · {pct}%
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Overall progress ── */}
        {(phase==='installing'||phase==='done') && (
          <div style={{marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:6}}>
              <span style={{color:'#334155'}}>
                {phase==='done'
                  ? 'Installation complete'
                  : activeMeta
                    ? `Installing ${activeMeta.label}${dots}`
                    : `Preparing${dots}`}
              </span>
              <span style={{color:'#0D9488',fontWeight:700,fontVariantNumeric:'tabular-nums'}}>
                {totalPct}% &nbsp;·&nbsp; {fmt(downloadedMB*1e6)} / {fmt(TOTAL_MB*1e6)}
              </span>
            </div>
            <div style={{height:6,borderRadius:99,background:'rgba(255,255,255,.05)',overflow:'hidden'}}>
              <div style={{
                height:'100%',borderRadius:99,
                width:`${totalPct}%`,
                background: phase==='done'
                  ? '#0D9488'
                  : 'linear-gradient(90deg,#0D9488 0%,#38BDF8 45%,#818CF8 100%)',
                backgroundSize:'200% 100%',
                transition:'width .35s ease',
                animation: phase==='installing' ? 'shimmer 2.2s linear infinite' : 'none',
                boxShadow: phase==='installing' ? '0 0 14px rgba(13,148,136,.55)' : 'none',
              }}/>
            </div>
          </div>
        )}

        {/* ── Done message ── */}
        {phase==='done' && (
          <div style={{
            textAlign:'center',padding:'8px 0',
            fontSize:13,color:'#0D9488',fontWeight:600,
            animation:'fadeIn .5s ease',
          }}>
            Launching Maya{dots}
          </div>
        )}

        {/* ── Error / reinstall ── */}
        {phase==='failed' && (
          <div style={{
            background:'rgba(239,68,68,.07)',
            border:'1px solid rgba(239,68,68,.2)',
            borderRadius:14,padding:18,
          }}>
            <div style={{fontSize:14,fontWeight:700,color:'#F87171',marginBottom:6}}>
              Installation Failed
              {retryCount > 0 && <span style={{fontSize:11,fontWeight:400,color:'#7F1D1D',marginLeft:8}}>(attempt {retryCount+1})</span>}
            </div>
            <div style={{fontSize:12,color:'#94A3B8',marginBottom:16,lineHeight:1.6}}>
              {errMsg}
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={handleReinstall} style={{
                flex:1,padding:'12px 0',cursor:'pointer',
                background:'rgba(13,148,136,.14)',
                border:'1px solid rgba(13,148,136,.3)',
                borderRadius:11,color:'#0D9488',
                fontSize:13,fontWeight:700,
                transition:'background .2s',
              }}
                onMouseEnter={e => e.target.style.background='rgba(13,148,136,.22)'}
                onMouseLeave={e => e.target.style.background='rgba(13,148,136,.14)'}
              >
                ↺ Reinstall
              </button>
              <button onClick={() => window.mayaElectron?.quitApp?.()} style={{
                padding:'12px 20px',cursor:'pointer',
                background:'rgba(239,68,68,.1)',
                border:'1px solid rgba(239,68,68,.22)',
                borderRadius:11,color:'#F87171',
                fontSize:13,fontWeight:600,
              }}>Quit</button>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div style={{
          display:'flex',justifyContent:'space-between',
          fontSize:10,color:'#111827',marginTop:14,
        }}>
          <span>Maya AI · 100% offline</span>
          <span>No data leaves your device</span>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%,100% { box-shadow: 0 0 55px rgba(13,148,136,.55), 0 0 110px rgba(13,148,136,.22); }
          50%      { box-shadow: 0 0 75px rgba(13,148,136,.75), 0 0 150px rgba(13,148,136,.35); }
        }
        @keyframes shimmer {
          0%   { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>
    </div>
  )
}
