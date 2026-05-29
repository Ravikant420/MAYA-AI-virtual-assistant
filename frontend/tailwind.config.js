/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        display: ['"Syne"', 'sans-serif'],
      },
      colors: {
        // Core dark palette
        void:    '#080B0F',
        surface: '#0D1117',
        panel:   '#111820',
        card:    '#161E28',
        border:  '#1E2A38',
        muted:   '#243040',
        // Professional accent — electric cyan
        pro: {
          DEFAULT: '#00C8FF',
          dim:     '#00C8FF22',
          glow:    '#00C8FF44',
          soft:    '#00C8FF11',
        },
        // Romantic accent — rose blush
        rom: {
          DEFAULT: '#FF6B9D',
          dim:     '#FF6B9D22',
          glow:    '#FF6B9D44',
          soft:    '#FF6B9D11',
        },
        // Text
        ink: {
          primary:   '#E8EDF5',
          secondary: '#8A9BB0',
          muted:     '#4A5568',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'spin-slow':  'spin 4s linear infinite',
        'float':      'float 3s ease-in-out infinite',
        'glow-pro':   'glowPro 2s ease-in-out infinite',
        'glow-rom':   'glowRom 2s ease-in-out infinite',
        'typing':     'typing 1.4s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
        glowPro: {
          '0%, 100%': { boxShadow: '0 0 12px #00C8FF44' },
          '50%':      { boxShadow: '0 0 28px #00C8FF88' },
        },
        glowRom: {
          '0%, 100%': { boxShadow: '0 0 12px #FF6B9D44' },
          '50%':      { boxShadow: '0 0 28px #FF6B9D88' },
        },
        typing: {
          '0%, 100%': { opacity: 0.2 },
          '50%':      { opacity: 1 },
        },
      },
      backdropBlur: { xs: '2px' },
      boxShadow: {
        'panel':   '0 4px 24px rgba(0,0,0,0.4)',
        'message': '0 2px 12px rgba(0,0,0,0.3)',
        'glow-pro':'0 0 20px rgba(0,200,255,0.25)',
        'glow-rom':'0 0 20px rgba(255,107,157,0.25)',
      },
    },
  },
  plugins: [],
}
