// src/components/ErrorBoundary.jsx
// Catches any React render error and shows a readable message
// instead of a black screen

import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('[Maya] React crash:', error, info)
    // Also log to Electron if available
    window.mayaElectron?.log?.(`React crash: ${error.message}`)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0,
          background: '#0D1117',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: "'SF Pro Display', -apple-system, sans-serif",
          padding: 40,
        }}>
          <div style={{
            width: 60, height: 60, borderRadius: '50%',
            background: 'rgba(248,113,113,0.15)',
            border: '2px solid #F87171',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, marginBottom: 20,
          }}>!</div>

          <div style={{ fontSize: 20, fontWeight: 700, color: '#F0FDFA', marginBottom: 8 }}>
            Maya crashed
          </div>
          <div style={{ fontSize: 13, color: '#64748B', marginBottom: 20, textAlign: 'center' }}>
            {this.state.error.message}
          </div>

          <div style={{
            background: 'rgba(0,0,0,0.4)', borderRadius: 8,
            padding: '12px 16px', maxWidth: 500, width: '100%',
            fontFamily: 'Menlo, monospace', fontSize: 11, color: '#475569',
            maxHeight: 200, overflowY: 'auto',
          }}>
            {this.state.info?.componentStack || ''}
          </div>

          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 24, padding: '10px 28px',
              background: 'rgba(13,148,136,0.15)',
              border: '1px solid rgba(13,148,136,0.3)',
              borderRadius: 10, color: '#0D9488',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
