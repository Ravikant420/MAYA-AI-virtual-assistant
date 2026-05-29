import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from './App'
import AppLoader from './components/AppLoader'
import './index.css'

// Log that React is starting — visible in maya.log via console-message handler
console.log('[Maya] React starting up')
console.log('[Maya] protocol:', window.location.protocol)
console.log('[Maya] hostname:', window.location.hostname)
console.log('[Maya] mayaElectron:', !!window.mayaElectron)

ReactDOM.createRoot(document.getElementById('root')).render(
  <AppLoader>
    <App />
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: 'rgba(22,27,34,0.95)',
          color: '#F0FDFA',
          border: '1px solid rgba(13,148,136,0.2)',
          borderRadius: '12px',
          backdropFilter: 'blur(12px)',
          fontSize: '13px',
        },
        success: { iconTheme: { primary: '#0D9488', secondary: '#F0FDFA' } },
        error:   { iconTheme: { primary: '#F87171', secondary: '#F0FDFA' } },
      }}
    />
  </AppLoader>
)
