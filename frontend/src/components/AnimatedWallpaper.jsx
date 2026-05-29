// src/components/AnimatedWallpaper.jsx
// Canvas-based animated wallpaper: aurora waves + floating particle neural mesh
import React, { useEffect, useRef } from 'react'

export default function AnimatedWallpaper({ mode }) {
  const canvasRef = useRef(null)
  const modeRef   = useRef(mode)

  useEffect(() => { modeRef.current = mode }, [mode])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    // ── Resize handler ─────────────────────────────────────────────────
    const resize = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    // ── Palette ────────────────────────────────────────────────────────
    const palette = {
      professional: {
        aurora1: [0,   200, 255],   // cyan
        aurora2: [0,   120, 200],   // deep blue
        aurora3: [20,  255, 180],   // teal
        particle: '0,200,255',
        line:     '0,180,255',
      },
      romantic: {
        aurora1: [255, 107, 157],   // rose pink
        aurora2: [200,  60, 120],   // deep rose
        aurora3: [255, 180, 100],   // warm amber
        particle: '255,107,157',
        line:     '220,80,140',
      },
    }

    // ── Particles ──────────────────────────────────────────────────────
    const NUM_PARTICLES = 55
    const particles = Array.from({ length: NUM_PARTICLES }, () => ({
      x:   Math.random() * (canvas.width  || 1200),
      y:   Math.random() * (canvas.height || 800),
      vx:  (Math.random() - 0.5) * 0.4,
      vy:  (Math.random() - 0.5) * 0.4,
      r:   Math.random() * 2 + 1,
      opacity: Math.random() * 0.5 + 0.2,
      pulse: Math.random() * Math.PI * 2,
    }))

    // ── Aurora wave state ──────────────────────────────────────────────
    let t = 0
    let animId

    // ── Draw aurora band ───────────────────────────────────────────────
    const drawAurora = (w, h, pal, time) => {
      const a1 = pal.aurora1
      const a2 = pal.aurora2
      const a3 = pal.aurora3

      // Wave 1 — wide slow sweep
      const grad1 = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.8)
      const s1 = Math.sin(time * 0.0004) * 0.07
      grad1.addColorStop(0,   `rgba(${a1[0]},${a1[1]},${a1[2]},0)`)
      grad1.addColorStop(0.3 + s1, `rgba(${a1[0]},${a1[1]},${a1[2]},0.06)`)
      grad1.addColorStop(0.5, `rgba(${a2[0]},${a2[1]},${a2[2]},0.04)`)
      grad1.addColorStop(1,   `rgba(${a1[0]},${a1[1]},${a1[2]},0)`)
      ctx.fillStyle = grad1
      ctx.fillRect(0, 0, w, h)

      // Wave 2 — diagonal aurora ribbon
      const ribbonY = h * (0.3 + Math.sin(time * 0.0003) * 0.12)
      const ribbonH = h * (0.25 + Math.sin(time * 0.0005 + 1) * 0.06)
      const grad2 = ctx.createLinearGradient(0, ribbonY, 0, ribbonY + ribbonH)
      grad2.addColorStop(0,   `rgba(${a3[0]},${a3[1]},${a3[2]},0)`)
      grad2.addColorStop(0.4, `rgba(${a3[0]},${a3[1]},${a3[2]},0.05)`)
      grad2.addColorStop(0.6, `rgba(${a1[0]},${a1[1]},${a1[2]},0.07)`)
      grad2.addColorStop(1,   `rgba(${a3[0]},${a3[1]},${a3[2]},0)`)

      // Skew the ribbon like real aurora
      ctx.save()
      ctx.transform(1, 0, 0.25, 1, -w * 0.12, 0)
      ctx.fillStyle = grad2
      ctx.fillRect(0, ribbonY, w * 1.3, ribbonH)
      ctx.restore()

      // Wave 3 — radial bloom in top-right corner
      const bx = w * (0.75 + Math.sin(time * 0.0002) * 0.05)
      const by = h * (0.15 + Math.cos(time * 0.0003) * 0.06)
      const bloom = ctx.createRadialGradient(bx, by, 0, bx, by, w * 0.4)
      bloom.addColorStop(0,   `rgba(${a1[0]},${a1[1]},${a1[2]},0.08)`)
      bloom.addColorStop(0.5, `rgba(${a2[0]},${a2[1]},${a2[2]},0.03)`)
      bloom.addColorStop(1,   `rgba(${a1[0]},${a1[1]},${a1[2]},0)`)
      ctx.fillStyle = bloom
      ctx.fillRect(0, 0, w, h)

      // Wave 4 — bottom-left counter bloom
      const bx2 = w * (0.1 + Math.cos(time * 0.00025) * 0.04)
      const by2 = h * (0.78 + Math.sin(time * 0.00035) * 0.06)
      const bloom2 = ctx.createRadialGradient(bx2, by2, 0, bx2, by2, w * 0.3)
      bloom2.addColorStop(0,   `rgba(${a3[0]},${a3[1]},${a3[2]},0.06)`)
      bloom2.addColorStop(0.6, `rgba(${a2[0]},${a2[1]},${a2[2]},0.02)`)
      bloom2.addColorStop(1,   `rgba(${a3[0]},${a3[1]},${a3[2]},0)`)
      ctx.fillStyle = bloom2
      ctx.fillRect(0, 0, w, h)
    }

    // ── Draw particle neural mesh ──────────────────────────────────────
    const drawParticles = (w, h, pal, time) => {
      const LINK_DIST = 130

      for (const p of particles) {
        // Update position
        p.x  += p.vx
        p.y  += p.vy
        p.pulse += 0.018

        // Wrap edges
        if (p.x < -10) p.x = w + 10
        if (p.x > w + 10) p.x = -10
        if (p.y < -10) p.y = h + 10
        if (p.y > h + 10) p.y = -10

        // Draw glowing particle
        const pulsedR = p.r + Math.sin(p.pulse) * 0.6
        const pulsedO = p.opacity * (0.7 + Math.sin(p.pulse) * 0.3)

        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pulsedR * 3)
        grd.addColorStop(0, `rgba(${pal.particle},${pulsedO})`)
        grd.addColorStop(1, `rgba(${pal.particle},0)`)
        ctx.beginPath()
        ctx.arc(p.x, p.y, pulsedR * 3, 0, Math.PI * 2)
        ctx.fillStyle = grd
        ctx.fill()
      }

      // Draw connecting lines between close particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i]
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < LINK_DIST) {
            const alpha = (1 - dist / LINK_DIST) * 0.18
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.strokeStyle = `rgba(${pal.line},${alpha})`
            ctx.lineWidth = 0.8
            ctx.stroke()
          }
        }
      }
    }

    // ── Scan line overlay ──────────────────────────────────────────────
    const drawScanlines = (w, h) => {
      ctx.fillStyle = 'rgba(0,0,0,0.018)'
      for (let y = 0; y < h; y += 3) {
        ctx.fillRect(0, y, w, 1)
      }
    }

    // ── Main animation loop ────────────────────────────────────────────
    const loop = (timestamp) => {
      t = timestamp
      const w = canvas.width
      const h = canvas.height
      const pal = palette[modeRef.current] || palette.professional

      // Clear with base color
      ctx.clearRect(0, 0, w, h)

      // Deep base
      const base = modeRef.current === 'romantic'
        ? 'rgba(10,4,8,1)'
        : 'rgba(3,8,14,1)'
      ctx.fillStyle = base
      ctx.fillRect(0, 0, w, h)

      // Aurora layers
      drawAurora(w, h, pal, t)

      // Particle mesh
      drawParticles(w, h, pal, t)

      // Subtle scanlines for texture
      drawScanlines(w, h)

      animId = requestAnimationFrame(loop)
    }

    animId = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(animId)
      ro.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ display: 'block' }}
    />
  )
}
