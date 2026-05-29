# Maya UI — React Frontend

Production-grade chat interface for the Maya AI Assistant.

## Stack
- **React 18** + **Vite** — fast dev server + build
- **TailwindCSS** — utility-first styling with custom design tokens
- **Framer Motion** — all animations (messages, voice, mode switch, status)
- **Axios** — API layer with interceptors
- **react-markdown** + **remark-gfm** — full Markdown rendering
- **react-hot-toast** — toast notifications
- **lucide-react** — icons

## Setup & Run

```bash
# 1. Install
cd maya-ui
npm install

# 2. Configure
cp .env.example .env
# Edit VITE_API_BASE_URL=http://localhost:8000

# 3. Start Maya backend first
# cd ../maya && python main.py

# 4. Run frontend
npm run dev
# → http://localhost:3000
```

## Production Build

```bash
npm run build
# Output in dist/
npm run preview  # preview production build locally
```

## Features

| Feature | Details |
|---|---|
| ChatGPT-style layout | Sidebar + chat area + sticky input |
| Dark theme | Custom deep-dark palette, glass effects, noise texture |
| Mode switching | Professional (blue) / Romantic (pink) with animated toggle |
| Voice input | Animated waveform visualizer, pulsing rings, state transitions |
| Markdown rendering | Code blocks, tables, lists, inline code |
| Typing indicator | Animated dots while Maya responds |
| Status bar | Live connection, voice state, romantic mode badges |
| Sidebar tabs | Chat actions, session history, reminders, notes, tools, stats |
| RAG toggle | Switch document-search mode per message |
| Copy button | Hover to copy any message |
| Tool result display | Shows which tool was used + result badge |
| Source citations | RAG sources shown under assistant messages |
| Responsive | Full mobile support, collapsible sidebar |

## .env Variables

```
VITE_API_BASE_URL=http://localhost:8000
VITE_APP_NAME=Maya
```
