# 🤖 Maya — Privacy-First Offline AI Desktop Assistant

Maya is a fully offline, cross-platform desktop AI assistant built with a strict privacy-first architecture. It integrates local Large Language Models (LLMs), real-time speech-to-text, offline text-to-speech, and Retrieval-Augmented Generation (RAG) into a seamless, unified React/Electron interface.

Because Maya runs entirely on local hardware, it requires **zero internet connection** for core operations — ensuring complete data privacy and zero cloud latency.

---

## ✨ Key Features

- **100% Local Execution** — Core AI logic runs on-device using local models. Network access is strictly disabled for ML pipelines via environment constraints (`TRANSFORMERS_OFFLINE="1"`).
- **4-Layer Intelligence Routing:**
  - **Deterministic Tools** — Pre-LLM tool detection for rapid tasks (e.g., system stats, setting reminders, opening apps).
  - **RAG Pipeline** — Document Q&A using FAISS and local embeddings for querying uploaded PDFs.
  - **Local LLM** — Powered by Ollama (default: `llama3:8b`) with contextual memory.
  - **Fallback Handling** — Graceful degradation if AI engines are unavailable.
- **Real-Time Voice UI** — Voice interaction powered by local Whisper (STT) and Piper (TTS) over WebSockets for low-latency streaming.
- **Persistent Memory** — SQLite-backed short-term and long-term memory management for contextual conversations.

---

## 🛠️ Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend & Desktop Shell** | React, Vite, Tailwind CSS, Electron |
| **Backend API** | Python, FastAPI, Uvicorn, SQLite, FAISS |
| **AI & ML (Local)** | Ollama (`llama3:8b`), Whisper STT, Piper TTS, Sentence-Transformers |

---

## 🚀 Getting Started

Because Maya relies on heavy local AI models, you must download the models manually after cloning the repository.

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Python](https://www.python.org/) (v3.10+)
- [Ollama](https://ollama.com/) — Download and pull the default model:

```bash
ollama pull llama3:8b
```

### 2. Clone the Repository

```bash
git clone https://github.com/Ravikant420/MAYA-AI-virtual-assistant.git
cd MAYA-AI-virtual-assistant
```

### 3. Download AI Models (Critical)

Due to GitHub file size limits, local AI models are **not included** in this repository. Create the models directory inside the backend first:

```bash
mkdir -p backend/models/whisper backend/models/piper
```

Then place your downloaded models into the respective folders:

- Download your preferred **Whisper model** (`.bin` format) → `backend/models/whisper/`
- Download your preferred **Piper TTS model** (`.onnx` format) → `backend/models/piper/`

### 4. Install Dependencies

**Backend:**

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**Frontend:**

```bash
# From the project root
npm install
cd frontend
npm install
```

### 5. Run in Development Mode

Open two terminal instances.

**Terminal 1 — Backend:**

```bash
cd backend
source venv/bin/activate
python main.py
```

**Terminal 2 — Frontend:**

```bash
npm run dev
```

---

## 📦 Packaging for Production (macOS)

To compile Maya into a standalone `.dmg` desktop application, run the following commands in order:

```bash
# Step 1: Bundle the Python backend
pyinstaller build/maya-backend.spec --distpath dist/backend/

# Step 2: Build and package the Electron app (Apple Silicon)
npx electron-builder --mac --arm64
```

> **Note:** Always follow the build sequence — PyInstaller → frontend build → electron-builder → install from `.dmg`. Running steps out of order may result in a broken package.

---

## 🔒 Privacy & Security

Maya is designed around a zero-trust, offline-first model:

- No data is ever sent to external servers.
- All AI inference happens locally on your machine.
- API keys (if any) are encrypted at build time using AES-256-GCM.
- `TRANSFORMERS_OFFLINE=1` and `HF_DATASETS_OFFLINE=1` are enforced to prevent accidental network calls from ML libraries.

---

## 🗂️ Project Structure

```
MAYA-AI-virtual-assistant/
├── backend/                  # FastAPI backend & AI pipeline
│   ├── models/
│   │   ├── whisper/          # Whisper STT models (.bin)
│   │   └── piper/            # Piper TTS models (.onnx)
│   ├── main.py               # Backend entry point
│   └── requirements.txt
├── frontend/                 # React + Vite UI
├── build/
│   └── maya-backend.spec     # PyInstaller spec file
└── package.json              # Electron + root scripts
```

---

## 📋 Known Constraints

- The `uvicorn.run(app, ...)` call must use the **app object** (not a string) inside PyInstaller bundles.
- The **8-second debounce** in `AppLoader.jsx` must not be removed — it ensures the backend is fully initialized before the UI connects.
- Always install and test the packaged app from the `.dmg`, not from dev mode, to validate production behavior.

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

## 👤 Author

**Ravi Kant**
B.Tech Computer Science — Nalanda College of Engineering, Chandi
Final Year Project · Mentor: Mr. Digambar Kumar
