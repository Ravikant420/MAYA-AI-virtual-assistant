# 🤖 Maya — Fully Offline AI Virtual Assistant

> Production-grade, modular AI assistant. No cloud. No paid APIs. 100% offline.
> Built with Ollama · faster-whisper · pyttsx3 · FAISS · FastAPI · SQLite

---

## 🏗️ Full System Architecture

```
                        ┌──────────────────────────────────────┐
                        │          USER INTERFACE               │
                        │  (Voice / curl / Web / App)           │
                        └──────────┬───────────────────────────┘
                                   │
                        ┌──────────▼───────────────────────────┐
                        │     WakeWordManager                   │
                        │  SLEEPING → ACTIVE → SLEEPING         │
                        │  faster-whisper (tiny) chunk listen   │
                        └──────────┬───────────────────────────┘
                                   │
                        ┌──────────▼───────────────────────────┐
                        │        FastAPI Backend (main.py)      │
                        │  /chat  /voice  /tool  /upload  etc   │
                        └─┬──────┬──────┬──────┬───────────────┘
                          │      │      │      │
              ┌───────────▼┐ ┌───▼──┐ ┌▼────┐ ┌▼──────────┐
              │ ModeManager│ │ LLM  │ │Tools│ │  RAG      │
              │ professional│ │Ollama│ │Exec │ │  FAISS    │
              │ romantic   │ │7B/8B │ │ 30+ │ │  PDF/DOCX │
              └────────────┘ └──────┘ └─────┘ └───────────┘
                          │      │
              ┌───────────▼──────▼────────────────────────┐
              │              MemoryManager                  │
              │  Short-term (window) + Long-term (FAISS)    │
              │  + Auto-summarization every N messages       │
              └─────────────────┬────────────────────────-─┘
                                │
              ┌─────────────────▼────────────────────────-─┐
              │              SQLite Database                 │
              │  sessions · messages · reminders · notes     │
              │  documents · tool_logs                       │
              └──────────────────────────────────────────---┘
```

---

## 🔄 System Flow Diagrams

### Wake Word Cycle
```
SLEEPING: record 2s chunk → transcribe (whisper tiny)
    ├── "maya" detected → ACTIVE (log state transition)
    └── silence → stay SLEEPING

ACTIVE: record 2s chunk → transcribe
    ├── speech → reset silence timer → process query
    ├── 8s silence → SLEEPING (log transition)
    └── loop
```

### Mode Switching Logic
```
User says "let's talk romantically"
    → ModeManager.detect_and_switch() → "romantic"
    → System prompt swaps to romantic persona
    → TTS rate slows to 155wpm
    → ResponseFilter allows max 2 emojis
    → Explicit content blocked

User says "back to normal"
    → mode = "professional"
    → System prompt returns to clear/intelligent
    → TTS rate → 180wpm
    → All emojis stripped from responses
```

### Tool Routing Logic
```
User: "create a file called report.txt"
    → IntentClassifier.classify() → "create_file" (score=4)
    → extract_params() → {filename: "report.txt", content: ""}
    → ToolExecutor.execute("create_file", params)
    → _safe_path() validates sandbox boundary
    → file created in /sandbox/
    → result injected into LLM prompt
    → LLM formats natural language response
```

### Memory Retrieval Math
```
Query embedding: E_q = sentence_transformer.encode(query)  → 384-dim float32

Long-term search:
  scores, indices = FAISS_IndexFlatIP.search(E_q, top_k)
  cosine_similarity = dot(E_q, E_stored) [since both L2-normalized]
  filter: score >= SIMILARITY_THRESHOLD (0.55)
  filter: session_id matches

Context injection order:
  1. System prompt (personality)
  2. Summary (if exists)
  3. Long-term relevant snippets (top 3)
  4. Short-term recent messages (last 12)
  5. Current user message
```

---

## 📁 Project Structure

```
maya/
├── main.py                    # FastAPI app — all endpoints
├── config.py                  # All config (env-var driven)
├── requirements.txt
├── Dockerfile
├── README.md
│
├── llm/
│   └── ollama_client.py       # Ollama wrapper: generate, stream, retry
│
├── memory/
│   └── memory_manager.py      # STM + FAISS LTM + auto-summarization
│
├── rag/
│   └── rag_manager.py         # Document loader + chunker + retriever
│
├── tools/
│   ├── registry.py            # ToolRegistry + IntentClassifier (30+ tools)
│   └── executor.py            # ToolExecutor + all tool handlers
│
├── voice/
│   ├── wake_word_manager.py   # Wake word detection + state machine
│   ├── mode_manager.py        # Professional/Romantic personality modes
│   ├── speech_to_text.py      # faster-whisper STT
│   └── text_to_speech.py      # pyttsx3 TTS (mode-aware rate)
│
├── database/
│   └── repository.py          # SQLite: sessions, messages, reminders,
│                              #   notes, documents, tool_logs
│
├── utils/
│   ├── logger.py              # Structured rotating logger
│   └── response_filter.py    # Safety: injection, explicit content, emojis
│
├── data/
│   ├── faiss_index/           # Persistent vector indexes
│   └── maya.db                # SQLite database
│
├── sandbox/                   # Sandboxed file workspace
└── logs/
    └── maya.log
```

---

## 🚀 Quick Start

### 1. Install Ollama + Model
```bash
curl -fsSL https://ollama.ai/install.sh | sh
ollama serve
ollama pull mistral:7b-instruct-q4_K_M
```

### 2. Setup Python Environment
```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Run Maya
```bash
python main.py
# → http://localhost:8000
# → Docs: http://localhost:8000/docs
```

---

## 🧪 curl Test Suite

```bash
# System status
curl http://localhost:8000/system_status | python3 -m json.tool

# Create session
curl -X POST http://localhost:8000/session \
  -H "Content-Type: application/json" \
  -d '{"mode": "professional"}'

# Chat (replace SESSION_ID)
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is machine learning?", "session_id": "SESSION_ID"}'

# Switch to romantic mode
curl -X POST http://localhost:8000/switch_mode \
  -H "Content-Type: application/json" \
  -d '{"session_id": "SESSION_ID", "mode": "romantic"}'

# Chat in romantic mode
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How are you feeling today?", "session_id": "SESSION_ID"}'

# Calculator tool
curl -X POST http://localhost:8000/tool \
  -H "Content-Type: application/json" \
  -d '{"tool_name": "calculator", "parameters": {"expression": "2**10 + 42"}}'

# System info
curl -X POST http://localhost:8000/tool \
  -H "Content-Type: application/json" \
  -d '{"tool_name": "system_info", "parameters": {}}'

# Set a reminder
curl -X POST http://localhost:8000/tool \
  -H "Content-Type: application/json" \
  -d '{"tool_name": "set_reminder", "parameters": {"message": "Study ML chapter 5", "remind_at": "6:00 PM"}}'

# Create a note
curl -X POST http://localhost:8000/tool \
  -H "Content-Type: application/json" \
  -d '{"tool_name": "create_note", "parameters": {"title": "Ideas", "content": "Build a local RAG system"}}'

# Upload document for RAG
curl -X POST http://localhost:8000/upload_document \
  -F "file=@/path/to/notes.pdf"

# Chat with RAG
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What does the document say about transformers?", "session_id": "SESSION_ID", "use_rag": true}'

# Convert units
curl -X POST http://localhost:8000/tool \
  -H "Content-Type: application/json" \
  -d '{"tool_name": "unit_conversion", "parameters": {"value": 100, "from_unit": "celsius", "to_unit": "fahrenheit"}}'

# Current time
curl -X POST http://localhost:8000/tool \
  -H "Content-Type: application/json" \
  -d '{"tool_name": "datetime_now", "parameters": {}}'

# View memory
curl "http://localhost:8000/memory?session_id=SESSION_ID&query=machine+learning"

# Reset session
curl -X POST http://localhost:8000/reset \
  -H "Content-Type: application/json" \
  -d '{"session_id": "SESSION_ID"}'
```

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MODEL_NAME` | `mistral:7b-instruct-q4_K_M` | Ollama model |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama URL |
| `DEFAULT_MODE` | `professional` | Default personality |
| `WHISPER_MODEL` | `tiny` | STT model size |
| `SILENCE_TIMEOUT` | `8` | Wake word silence timeout (s) |
| `MAX_MEMORY` | `12` | Short-term memory window |
| `SIMILARITY_THRESHOLD` | `0.55` | FAISS retrieval threshold |
| `SANDBOX_DIRECTORY` | `sandbox` | File ops sandbox |
| `DB_PATH` | `data/maya.db` | SQLite path |

---

## 🛡️ Security Design

| Threat | Defense |
|---|---|
| Path traversal | `os.path.abspath()` + sandbox boundary check |
| Command injection | Regex pattern detection + blocked command list |
| Unsafe math | AST-based evaluator — no `eval()` |
| Explicit content | Keyword filter in ResponseFilter (romantic mode) |
| Large uploads | `max_upload_mb` size cap |
| Oversized LLM output | `MAX_RESPONSE_CHARS = 8000` truncation |
| Context overflow | Token counting + auto-pruning |
| Dangerous apps | `allowed_apps` allowlist |
| Dangerous system cmds | `DANGEROUS_COMMANDS` blocklist |

---

## ⚠️ 16GB RAM Performance Guide

| Component | RAM Usage |
|---|---|
| Mistral 7B q4_K_M | ~4.5 GB |
| sentence-transformers | ~90 MB |
| faster-whisper tiny | ~75 MB |
| FAISS index (10k vectors) | ~15 MB |
| FastAPI + Python runtime | ~200 MB |
| **Total** | **~5 GB** ✅ |

**Tips for 16GB RAM:**
- Use `q4_K_M` quantization (best speed/quality)
- `WHISPER_MODEL=tiny` (fastest, good enough for commands)
- `MAX_MEMORY=8` if memory is tight
- Disable voice if not needed: `VOICE_ENABLED=false`

---

*Maya — Final Year B.Tech AI Systems Project*
