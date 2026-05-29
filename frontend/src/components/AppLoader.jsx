/**
 * src/components/AppLoader.jsx
 * Handles every launch scenario:
 *   - First launch / missing components → SetupScreen
 *   - Normal launch → dark loading screen → poll backend → app
 *   - Backend dies → error screen → retry
 *   - Update available → banner in top-right
 */
import { useState, useEffect } from 'react'
import SetupScreen from './SetupScreen'

const isElectron = typeof window !== 'undefined' && !!window.mayaElectron
const isFile     = typeof window !== 'undefined' && window.location.protocol === 'file:'
const BACKEND    = (isElectron || isFile) ? 'http://127.0.0.1:8000' : 'http://localhost:8000'

const LOADING_MESSAGES = [
  'Starting backend...',
  'Loading AI engine...',
  'Initializing voice system...',
  'Preparing memory...',
  'Almost ready...',
]

export default function AppLoader({ children }) {
  const [phase, setPhase]         = useState('checking')
  const [installed, setInstalled] = useState({})
  const [loadMsg, setLoadMsg]     = useState(LOADING_MESSAGES[0])
  const [msgIdx, setMsgIdx]       = useState(0)
  const [dots, setDots]           = useState('.')
  const [updateInfo, setUpdate]   = useState(null)
  const [retryable, setRetryable] = useState(false)

  // Dot animation
  useEffect(() => {
    if (phase !== 'loading' && phase !== 'checking') return
    const t = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 500)
    return () => clearInterval(t)
  }, [phase])

  // Cycle loading messages
  useEffect(() => {
    if (phase !== 'loading') return
    const t = setInterval(() => {
      setMsgIdx(i => {
        const next = (i + 1) % LOADING_MESSAGES.length
        setLoadMsg(LOADING_MESSAGES[next])
        return next
      })
    }, 3000)
    return () => clearInterval(t)
  }, [phase])

  // Update events
  useEffect(() => {
    if (!isElectron) return
    const unsub = window.mayaElectron.onUpdateStatus?.(setUpdate)
    return typeof unsub === 'function' ? unsub : undefined
  }, [])

  // ── FIX: Backend disconnect with 8s debounce ──────────────────────────────
  // Previously: any disconnect immediately triggered error + restartBackend()
  // Problem:    LLM inference (Whisper + Ollama) takes 10-20s, during which
  //             the ping fails, disconnect fires, and a SECOND backend spawns
  //             → [Errno 48] address already in use crash.
  // Fix:        Wait 8s before declaring backend dead. If it recovers (busy
  //             with inference), cancel the error. Only show error if truly gone.
  useEffect(() => {
    if (!isElectron) return
    let disconnectTimer = null

    const unsub = window.mayaElectron.onBackendStatus?.(status => {
      if (status === 'disconnected' && phase === 'ready') {
        // Don't panic immediately — backend may just be busy with LLM call
        disconnectTimer = setTimeout(() => {
          setRetryable(true)
          setPhase('error')
        }, 8000)
      }
      if (status === 'connected') {
        // Backend recovered — cancel pending error
        clearTimeout(disconnectTimer)
        disconnectTimer = null
        if (phase === 'error') setPhase('ready')
      }
    })

    return () => {
      clearTimeout(disconnectTimer)
      return typeof unsub === 'function' ? unsub() : undefined
    }
  }, [phase])
  // ── END FIX ───────────────────────────────────────────────────────────────

  // ── Main init ──────────────────────────────────────────────────────────────
  useEffect(() => { init() }, [])

  async function init() {
    setPhase('checking')
    try {
      const setupDone = isElectron
        ? await window.mayaElectron.isSetupComplete()
        : true
      if (!setupDone) {
        const status = isElectron ? await window.mayaElectron.getInstallStatus() : {}
        setInstalled(status)
        setPhase('setup')
        return
      }
      await boot()
    } catch (e) {
      console.error('[AppLoader] init:', e)
      setPhase('error')
    }
  }

  async function boot() {
    setPhase('loading')
    setLoadMsg(LOADING_MESSAGES[0])
    setMsgIdx(0)
    const ok = await pollBackend(60)
    if (ok) {
      if (isElectron) {
        try { await window.mayaElectron.checkMicPermission() } catch {}
      }
      setPhase('ready')
    } else {
      setRetryable(true)
      setPhase('error')
    }
  }

  async function pollBackend(retries) {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(`${BACKEND}/system_status`, { signal: AbortSignal.timeout(3000) })
        if (res.ok) return true
      } catch {}
      if (i === 8)  setLoadMsg('Waiting for backend...')
      if (i === 20) setLoadMsg('This is taking longer than usual...')
      if (i === 40) setLoadMsg('Still starting — please wait...')
      await new Promise(r => setTimeout(r, 1000))
    }
    return false
  }

  async function handleRetry() {
    setRetryable(false)
    if (isElectron && retryable) {
      try { await window.mayaElectron.restartBackend() } catch {}
      await new Promise(r => setTimeout(r, 2000))
    }
    await boot()
  }

  function handleSetupComplete() { boot() }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return <SetupScreen onComplete={handleSetupComplete} installed={installed} />
  }

  if (phase === 'ready') {
    return (
      <>
        {children}
        {updateInfo && (
          <div style={{
            position:'fixed', bottom:20, right:20, zIndex:9999,
            width:300, background:'rgba(8,14,22,.96)',
            border:'1px solid rgba(13,148,136,.28)',
            borderRadius:14, padding:'14px 16px',
            backdropFilter:'blur(24px)',
            boxShadow:'0 12px 40px rgba(0,0,0,.5)',
            animation:'slideIn .35s ease',
          }}>
            <div style={{fontSize:13,fontWeight:700,color:'#F0FDFA',marginBottom:4}}>
              {updateInfo.ready       ? '✅ Update ready'        :
               updateInfo.downloading ? '⬇ Downloading update' :
               '✨ Update available'}
            </div>
            <div style={{fontSize:11,color:'#475569',marginBottom:updateInfo.downloading?10:0}}>
              {updateInfo.ready
                ? `v${updateInfo.version} — restarts on next quit`
                : updateInfo.downloading
                  ? `v${updateInfo.version} · ${updateInfo.percent || 0}%`
                  : `v${updateInfo.version} available`}
            </div>
            {updateInfo.downloading && (
              <div style={{height:3,borderRadius:99,background:'rgba(255,255,255,.08)',overflow:'hidden'}}>
                <div style={{
                  height:'100%',borderRadius:99,width:`${updateInfo.percent||0}%`,
                  background:'linear-gradient(90deg,#0D9488,#38BDF8)',
                  transition:'width .4s ease',
                }}/>
              </div>
            )}
          </div>
        )}
        <style>{`@keyframes slideIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>
      </>
    )
  }

  // ── Checking / Loading / Error screens ─────────────────────────────────────
  return (
    <div style={{
      position:'fixed', inset:0, background:'#060A0E',
      display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      fontFamily:"'SF Pro Display',-apple-system,sans-serif",
    }}>
      {/* Grid */}
      <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:.05,pointerEvents:'none'}}>
        <defs><pattern id="g" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 0L0 0 0 48" fill="none" stroke="#0D9488" strokeWidth=".6"/>
        </pattern></defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
      </svg>
      <div style={{position:'absolute',width:700,height:700,borderRadius:'50%',pointerEvents:'none',
        background:'radial-gradient(circle,rgba(13,148,136,.07) 0%,transparent 60%)',
        top:'50%',left:'50%',transform:'translate(-50%,-50%)'}}/>

      <div style={{position:'relative',zIndex:10,textAlign:'center'}}>
        {/* Logo */}
        <div style={{
          width:76,height:76,borderRadius:18,margin:'0 auto 18px',
          background:'linear-gradient(145deg,#0D9488,#0EA5E9)',
          display:'flex',alignItems:'center',justifyContent:'center',
          fontSize:34,fontWeight:800,color:'#fff',
          boxShadow: phase==='error'
            ? '0 0 45px rgba(239,68,68,.45)'
            : '0 0 55px rgba(13,148,136,.5),0 0 110px rgba(13,148,136,.2)',
          animation: phase!=='error' ? 'pulse 2.5s ease-in-out infinite' : 'none',
          transition:'box-shadow .5s',
        }}>M</div>

        <div style={{fontSize:22,fontWeight:700,color:'#F0FDFA',marginBottom:8}}>Maya AI</div>

        {(phase==='checking'||phase==='loading') && (
          <>
            <div style={{fontSize:13,color:'#334155',marginBottom:24,minWidth:200}}>
              {phase==='checking' ? `Checking system${dots}` : `${loadMsg}${dots}`}
            </div>
            <div style={{
              width:30,height:30,margin:'0 auto',
              border:'2.5px solid rgba(13,148,136,.18)',
              borderTopColor:'#0D9488',borderRadius:'50%',
              animation:'spin .8s linear infinite',
            }}/>
          </>
        )}

        {phase==='error' && (
          <>
            <div style={{fontSize:15,fontWeight:600,color:'#F87171',marginBottom:6}}>
              Cannot connect to Maya
            </div>
            <div style={{fontSize:12,color:'#374151',marginBottom:24,maxWidth:280,lineHeight:1.6}}>
              Make sure Ollama is running, then try again.
              <br/><span style={{color:'#1F2937',fontSize:10}}>{BACKEND}/system_status</span>
            </div>
            <button onClick={handleRetry} style={{
              padding:'11px 32px',cursor:'pointer',
              background:'rgba(13,148,136,.14)',
              border:'1px solid rgba(13,148,136,.3)',
              borderRadius:11,color:'#0D9488',
              fontSize:13,fontWeight:700,
            }}>Retry</button>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin  { to{transform:rotate(360deg)} }
        @keyframes pulse {
          0%,100%{box-shadow:0 0 55px rgba(13,148,136,.5),0 0 110px rgba(13,148,136,.2)}
          50%    {box-shadow:0 0 75px rgba(13,148,136,.7),0 0 150px rgba(13,148,136,.35)}
        }
      `}</style>
    </div>
  )
}
