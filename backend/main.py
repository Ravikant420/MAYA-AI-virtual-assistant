import os

CLOUD_MODE = os.getenv("CLOUD_MODE", "false").lower() == "true"

if not CLOUD_MODE:
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_DATASETS_OFFLINE"] = "1"


import re
import time
import uuid
import json
import inspect
from contextlib import asynccontextmanager
from typing import Optional

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

load_dotenv()

from config import config
from database.repository import (Database, SessionRepo, MessageRepo,
                                  ReminderRepo, NoteRepo, DocumentRepo, ToolLogRepo)
from llm.ollama_client import OllamaClient
from llm.model_router import (get_current_model, set_model, get_prompt,
                               get_client, save_to_history, get_history)
from memory.memory_manager import MemoryManager
from rag.rag_manager import RAGManager
from tools.executor import build_registry
from utils.logger import setup_logger
from utils.response_filter import filter_response, sanitize_input, is_explicit_request
from voice.mode_manager import ModeManager
try:
    from voice.speech_to_text import SpeechToTextManager
    from voice.text_to_speech import TTSManager
    from voice.ws_handler import websocket_endpoint, init_wake_word_ws
    VOICE_AVAILABLE = True
except ImportError as e:
    logger.warning(f"Voice stack unavailable - running without it: {e}")
    VOICE_AVAILABLE = False
    SpeechToTextManager = TTSManager = init_wake_word_ws = None

logger = setup_logger("maya.main", config.logging.log_file, config.logging.log_level)


# ── App State ─────────────────────────────────────────────────────────────────

class State:
    db: Database = None
    session_repo: SessionRepo = None
    message_repo: MessageRepo = None
    reminder_repo: ReminderRepo = None
    note_repo: NoteRepo = None
    document_repo: DocumentRepo = None
    tool_log_repo: ToolLogRepo = None
    llm: OllamaClient = None
    memory: MemoryManager = None
    rag: RAGManager = None
    registry = None
    executor = None
    stt: SpeechToTextManager = None
    tts: TTSManager = None
    mode_manager: ModeManager = None


S = State()


class DBBundle:
    def __init__(self):
        self.reminder_repo = S.reminder_repo
        self.note_repo = S.note_repo
        self.message_repo = S.message_repo
      
    
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("═══════════════════════════════════════")
    logger.info("  Maya AI Assistant — Starting Up")
    logger.info("═══════════════════════════════════════")

    for d in ["data/faiss_index", "data", config.tools.sandbox_directory, "logs"]:
        os.makedirs(d, exist_ok=True)

    S.db = Database(config.database.db_path)
    S.session_repo = SessionRepo(S.db)
    S.message_repo = MessageRepo(S.db)
    S.reminder_repo = ReminderRepo(S.db)
    S.note_repo = NoteRepo(S.db)
    S.document_repo = DocumentRepo(S.db)
    S.tool_log_repo = ToolLogRepo(S.db)

    S.llm = OllamaClient()
    S.memory = MemoryManager()
    S.memory.pre_warm()
    S.rag = RAGManager()
    S.mode_manager = ModeManager()

    db_bundle = DBBundle()
    S.registry, S.executor = build_registry(db=db_bundle)

    if VOICE_AVAILABLE and not CLOUD_MODE:
        S.stt = SpeechToTextManager()
        S.stt.pre_warm()
        S.tts = TTSManager()

    # Start wake word listener
        init_wake_word_ws()
    else:
        S.stt = None
        S.tts = None
        logger.info("CLOUD_MODE: voice pipeline desabled for cloud demo")

  
    logger.info("Maya is ready. 🤖")
    yield
    logger.info("Maya shutting down.")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Maya — AI Virtual Assistant",
    description="AI assistant supporting Ollama, Gemini, and ChatGPT.",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def log_requests(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - t0) * 1000
    logger.info(f"{request.method} {request.url.path} → {response.status_code} | {ms:.0f}ms")
    return response


# ── Voice WebSocket ───────────────────────────────────────────────────────────

@app.websocket("/ws/voice")
async def voice_ws(websocket: WebSocket):
    if not VOICE_AVAILABLE:
        await websocket.close(code=1011, reason= "Voice not available in cloud demo")
        return
    await websocket_endpoint(websocket)


# ── Schemas ───────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    session_id: Optional[str] = None
    use_rag: bool = False
    stream: bool = False
    tts: bool = False

    @field_validator("message")
    @classmethod
    def sanitize(cls, v):
        return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", v).strip()


class SessionRequest(BaseModel):
    mode: Optional[str] = "professional"


class SwitchModeRequest(BaseModel):
    session_id: str
    mode: str


class SwitchModelRequest(BaseModel):
    model: str  # "ollama" | "gemini" | "chatgpt"


class ToolRequest(BaseModel):
    tool_name: str
    parameters: Optional[dict] = {}
    session_id: Optional[str] = None


class VoiceRequest(BaseModel):
    session_id: Optional[str] = None
    duration_seconds: Optional[int] = Field(5, ge=1, le=30)


class ResetRequest(BaseModel):
    session_id: str


class ExportRequest(BaseModel):
    session_id: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_or_create_session(sid: Optional[str], mode: str = "professional") -> str:
    if sid and S.session_repo.get(sid):
        return sid
    new_sid = S.session_repo.create(mode=mode)
    logger.info(f"New session: {new_sid}")
    return new_sid


def _get_active_llm():
    model = get_current_model()
    if model == "ollama":
        return S.llm
    return get_client()


# ── Tool response formatter ───────────────────────────────────────────────────

def _format_tool_response(tool_name: str, result) -> str:
    """Convert a ToolResult into a natural language response."""
    if not result.success:
        return f"I couldn't complete that: {result.error}"

    out = result.output
    if not isinstance(out, dict):
        return str(out)

    if tool_name == "datetime_now":
        return f"It's {out.get('time')} on {out.get('date')}."

    if tool_name == "calculator":
        return f"The result is {out.get('result')}."

    if tool_name == "unit_conversion":
        return (f"{out.get('value')} {out.get('from')} "
                f"= {out.get('result')} {out.get('to')}.")

    if tool_name == "battery_status":
        pct = out.get('percent', 'unknown')
        plugged = out.get('plugged')
        status = "plugged in" if plugged else "on battery"
        time_left = out.get('time_left', '')
        msg = f"Battery is at {pct}%, {status}."
        if time_left and time_left not in ('Unknown', 'Calculating...'):
            msg += f" About {time_left} remaining."
        return msg

    if tool_name == "cpu_usage":
        return (f"CPU usage is {out.get('cpu_percent')}% "
                f"across {out.get('cores_logical')} cores.")

    if tool_name == "ram_usage":
        return (f"RAM: {out.get('used_gb')} GB used of "
                f"{out.get('total_gb')} GB ({out.get('percent')}%).")

    if tool_name == "disk_usage":
        return (f"Disk: {out.get('used_gb')} GB used, "
                f"{out.get('free_gb')} GB free ({out.get('percent')}% full).")

    if tool_name == "network_status":
        online = out.get('online')
        ip = out.get('local_ip', 'unknown')
        return f"You are {'online' if online else 'offline'}. Local IP: {ip}."

    if tool_name == "system_info":
        return (f"System: {out.get('platform')} | "
                f"CPU: {out.get('cpu_percent')}% | "
                f"RAM: {out.get('ram_percent')}% | "
                f"Disk: {out.get('disk_percent')}%")

    if tool_name == "set_reminder":
        msg = out.get('message', '')
        at = out.get('remind_at', '')
        return f"Reminder set: '{msg}'" + (f" at {at}." if at else ".")

    if tool_name == "list_reminders":
        items = out.get('reminders', [])
        if not items:
            return "You have no active reminders."
        lines = [f"#{r['id']}: {r['message']}" +
                 (f" (at {r['remind_at']})" if r.get('remind_at') else "")
                 for r in items]
        return "Your reminders:\n" + "\n".join(lines)

    if tool_name == "delete_reminder":
        return f"Reminder #{out.get('deleted_id')} deleted."

    if tool_name == "create_note":
        return f"Note saved: '{out.get('title')}'."

    if tool_name == "show_notes":
        notes = out.get('notes', [])
        if not notes:
            return "You have no saved notes."
        lines = [f"#{n['id']}: {n.get('title', 'Untitled')}" for n in notes]
        return "Your notes:\n" + "\n".join(lines)

    if tool_name == "delete_note":
        return f"Note #{out.get('deleted_id')} deleted."

    if tool_name == "start_timer":
        if not out.get('success', True):
            return out.get('message', 'Please specify a duration.')
        return out.get('message', 'Timer started.')

    if tool_name == "open_app":
        return f"Opening {out.get('launched', 'app')}."

    if tool_name == "close_app":
        if out.get('closed') is False:
            return out.get('message', 'App not found.')
        return f"Closed {out.get('closed')}."

    if tool_name == "mac_screenshot":
        return out.get('message', 'Screenshot taken.')

    if tool_name == "mac_notification":
        return "Notification sent."

    if tool_name == "mac_volume":
        if 'volume_set' in out:
            return f"Volume set to {out['volume_set']}%."
        return f"Current volume: {out.get('current_volume', 'unknown')}%."

    if tool_name == "mac_brightness":
        if 'brightness_set' in out:
            return f"Brightness set to {out['brightness_set']}%."
        return out.get('brightness_info', 'Brightness info unavailable.')

    if tool_name == "reset_memory":
        return "Memory cleared. Starting fresh!"

    if tool_name == "list_directory":
        entries = out.get('entries', [])
        count = out.get('count', 0)
        if not entries:
            return "The sandbox is empty."
        names = [e['name'] for e in entries[:10]]
        more = f" (and {count - 10} more)" if count > 10 else ""
        return f"Files: {', '.join(names)}{more}."

    if tool_name == "create_file":
        return f"File '{out.get('created')}' created."

    if tool_name == "read_file":
        content = out.get('content', '')
        preview = content[:300] + "..." if len(content) > 300 else content
        return f"Contents of '{out.get('filename')}':\n{preview}"

    if tool_name == "delete_file":
        return f"File '{out.get('deleted')}' deleted."

    if tool_name == "rename_file":
        return f"Renamed '{out.get('renamed')}' to '{out.get('to')}'."

    if tool_name == "running_processes":
        count = out.get('count', 0)
        return f"{count} processes running."

    if tool_name == "session_stats":
        return (f"Session has {out.get('total_messages', 0)} messages "
                f"({out.get('user_messages', 0)} from you, "
                f"{out.get('assistant_messages', 0)} from Maya).")

    if tool_name == "export_chat":
        if not out.get('success', True):
            return out.get('message', 'Nothing to export.')
        return f"Chat exported to '{out.get('exported_to')}'."

    return f"Done: {json.dumps(out, ensure_ascii=False)[:300]}"


# ── Model Endpoints ───────────────────────────────────────────────────────────

@app.post("/api/model/switch", tags=["Model"])
async def switch_model(req: SwitchModelRequest):
    try:
        set_model(req.model)
        return {"success": True, "current_model": req.model}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/model/current", tags=["Model"])
async def current_model():
    return {
        "model": get_current_model(),
        "available": ["ollama", "gemini", "chatgpt"]
    }


@app.get("/api/model/history/{model}", tags=["Model"])
async def model_history(model: str, session_id: str):
    if model not in ["ollama", "gemini", "chatgpt"]:
        raise HTTPException(400, "Unknown model")
    from llm.model_router import _load_history_file, HISTORY_FILES
    path = HISTORY_FILES.get(model)
    history = _load_history_file(path)
    return {"model": model, "session_id": session_id,
            "messages": history.get(session_id, [])}


# ── System Endpoints ──────────────────────────────────────────────────────────

@app.get("/ping", tags=["System"])
async def ping():
    return {"status": "online", "assistant": "Maya", "version": "3.0.0"}


@app.get("/system_status", tags=["System"])
async def system_status():
    active_model = get_current_model()
    llm_health = (S.llm.health_check() if active_model == "ollama"
                  else {"running": True, "model": active_model})
    return {
        "assistant": "Maya",
        "version": "3.0.0",
        "active_model": active_model,
        "llm": llm_health,
        "rag": S.rag.stats(),
        "stt": S.stt.health_check(),
        "tts": S.tts.health_check(),
        "tools_count": len(S.registry.list_tools()),
    }


@app.post("/session", tags=["Sessions"])
async def create_session(req: SessionRequest):
    if req.mode not in ("professional", "romantic"):
        raise HTTPException(400, "mode must be 'professional' or 'romantic'")
    sid = S.session_repo.create(mode=req.mode)

    # WIPE RAG FOR NEW CHAT 
    if hasattr(S.rag, 'clear'):
        S.rag.clear()
        logger.info("Wiped FAISS database for new session.")

    return {"session_id": sid, "mode": req.mode, "assistant": "Maya"}


@app.get("/sessions", tags=["Sessions"])
async def list_sessions():
    return {"sessions": S.session_repo.list_all()}


@app.post("/switch_mode", tags=["Sessions"])
async def switch_mode(req: SwitchModeRequest):
    if req.mode not in ("professional", "romantic"):
        raise HTTPException(400, "mode must be 'professional' or 'romantic'")
    S.mode_manager.set_mode(req.session_id, req.mode)
    S.session_repo.update_mode(req.session_id, req.mode)
    if req.mode == "romantic":
        S.tts.speak("Of course... I'm here for you now. ❤️", mode="romantic", block=False)
    msg = S.mode_manager.mode_switch_message(req.mode)
    return {"session_id": req.session_id, "mode": req.mode, "message": msg}


# ── /chat — 4-layer tool architecture ────────────────────────────────────────

@app.post("/chat", tags=["Chat"])
async def chat(req: ChatRequest):
    session_id = get_or_create_session(req.session_id)

    clean_msg, safe = sanitize_input(req.message)
    if not safe:
        raise HTTPException(400, "Input contains potentially unsafe content.")
    # NEW FIX: Phantom Transcription / Filler Word Filter
    # If Whisper just heard "Hmm." or "Um.", ignore it completely.
    # ══════════════════════════════════════════════════════════════════════════
    core_text = re.sub(r'[^a-zA-Z]', '', clean_msg.lower())
    if core_text in ("hmm", "hm", "um", "umm", "uh", "oh", "ah"):
        logger.info("Filtered out phantom filler word: " + clean_msg)
        
        # Return a silent/ignored response without invoking the LLM
        ignored_msg = "..."
        if req.stream:
            async def filler_stream():
                yield f"data: {json.dumps({'response': ignored_msg, 'model': 'filter'})}\n\n"
                yield f"data: {json.dumps({'done': True})}\n\n"
            return StreamingResponse(filler_stream(), media_type="text/event-stream")
            
        return {
            "session_id": session_id,
            "response": ignored_msg,
            "mode": S.mode_manager.get_mode(session_id),
            "model": "filter"
        }
        
    mode = S.mode_manager.get_mode(session_id)

    # ── Romantic mode explicit content guard ──────────────────────────────────
    if mode == "romantic" and is_explicit_request(clean_msg):
        return {"session_id": session_id,
                "response": "Let's keep things warm and respectful between us. ❤️",
                "mode": mode}

    # ── Mode auto-detection ───────────────────────────────────────────────────
    new_mode, switched = S.mode_manager.detect_and_switch(session_id, clean_msg)
    if switched:
        S.session_repo.update_mode(session_id, new_mode)
        switch_msg = S.mode_manager.mode_switch_message(new_mode)
        S.memory.add_message(session_id, "user", clean_msg)
        S.memory.add_message(session_id, "assistant", switch_msg)
        S.message_repo.save(session_id, "user", clean_msg)
        S.message_repo.save(session_id, "assistant", switch_msg)
        if req.tts:
            S.tts.speak(switch_msg, mode=new_mode, block=False)
        return {"session_id": session_id, "response": switch_msg,
                "mode_switched_to": new_mode}

    # ══════════════════════════════════════════════════════════════════════════
    # LAYER 1 — Pre-LLM tool detection (deterministic, <1ms, always runs)
    # ══════════════════════════════════════════════════════════════════════════
    tool_def, params = S.registry.detect_intent(clean_msg)

    if tool_def:
        result = S.executor.execute(tool_def.name, params, session_id)

        S.tool_log_repo.log(
            tool_def.name, params, result.output,
            result.success, result.error, result.exec_ms, session_id
        )

        answer = _format_tool_response(tool_def.name, result)

        if tool_def.name == "reset_memory":
            S.memory.clear_session(session_id)
            S.message_repo.delete_session(session_id)

        S.memory.add_message(session_id, "user", clean_msg)
        S.memory.add_message(session_id, "assistant", answer)
        S.message_repo.save(session_id, "user", clean_msg)
        S.message_repo.save(session_id, "assistant", answer)
        S.session_repo.increment_count(session_id)

        if req.tts:
            S.tts.speak(answer, mode=new_mode, block=False)

        logger.info(f"Tool '{tool_def.name}' handled directly | {result.exec_ms:.0f}ms")
        
        # SSE format for tools if streaming was requested
        if req.stream:
            async def tool_stream():
                yield f"data: {json.dumps({'response': answer, 'tool_used': tool_def.name, 'tool_result': result.to_dict(), 'mode': new_mode, 'model': 'tool_direct'})}\n\n"
                yield f"data: {json.dumps({'done': True})}\n\n"
            return StreamingResponse(tool_stream(), media_type="text/event-stream")

        return {
            "session_id":  session_id,
            "response":    answer,
            "tool_used":   tool_def.name,
            "tool_result": result.to_dict(),
            "mode":        new_mode,
            "model":       "tool_direct",
        }

    # ══════════════════════════════════════════════════════════════════════════
    # LAYER 2 — RAG (document Q&A)
    # ══════════════════════════════════════════════════════════════════════════
    active_model = get_current_model()

    if active_model == "ollama" and req.use_rag and S.rag.stats()["total_chunks"] > 0:
        try:
            system_prompt = get_prompt(new_mode)
            
            if req.stream:
                # 1. Fetch chunks manually for streaming
                rag_chunks = S.rag.retrieve(clean_msg)
                
                if not rag_chunks:
                    # Fallback if no documents match
                    answer = "No relevant documents found."
                    async def empty_stream():
                        yield f"data: {json.dumps({'response': answer, 'rag_sources': [], 'mode': new_mode, 'model': active_model})}\n\n"
                        yield f"data: {json.dumps({'done': True})}\n\n"
                    return StreamingResponse(empty_stream(), media_type="text/event-stream")

                # 2. Build the prompt with document context
                prompt = S.rag.build_prompt(clean_msg, rag_chunks)
                
                seen_files = set()
                rag_sources_list = []
                for c in rag_chunks:
                    c_dict = c.to_dict()
                    fname = c_dict.get("filename", "Unknown Document")
                    if fname not in seen_files:
                        seen_files.add(fname)
                        rag_sources_list.append(c_dict)
                active_llm = _get_active_llm()
                
                # 3. Stream it exactly like normal chat
                async def rag_stream():
                    full_response = ""
                    try:
                        # Send sources immediately so the UI shows the citations at the bottom!
                        yield f"data: {json.dumps({'rag_sources': rag_sources_list, 'model': active_model})}\n\n"
                        
                        gen = active_llm.stream_response([{"role": "user", "content": prompt}], system_prompt=system_prompt)
                        
                        if inspect.isasyncgen(gen):
                            async for token in gen:
                                full_response += token
                                yield f"data: {json.dumps({'token': token, 'model': active_model})}\n\n"
                        else:
                            for token in gen:
                                full_response += token
                                yield f"data: {json.dumps({'token': token, 'model': active_model})}\n\n"
                        
                        answer = filter_response(full_response, new_mode)
                        
                        # Post-processing memory saving
                        S.memory.add_message(session_id, "user", clean_msg, llm_client=S.llm)
                        S.memory.add_message(session_id, "assistant", answer)
                        S.message_repo.save(session_id, "user", clean_msg)
                        S.message_repo.save(session_id, "assistant", answer)
                        
                        if req.tts:
                            spoken = _clean_for_tts(answer)
                            if spoken:
                                S.tts.speak(spoken, mode=new_mode, block=False)
                                
                        yield f"data: {json.dumps({'done': True})}\n\n"
                        
                    except Exception as e:
                        logger.error(f"RAG Stream failed: {e}")
                        yield f"data: {json.dumps({'error': str(e)})}\n\n"
                        
                return StreamingResponse(rag_stream(), media_type="text/event-stream")
                
            else:
                # Sync version fallback
                rag_result = S.rag.query(clean_msg, llm_client=S.llm, system_prompt=system_prompt)
                answer = filter_response(rag_result.get("answer", ""), new_mode)
                S.memory.add_message(session_id, "user", clean_msg)
                S.memory.add_message(session_id, "assistant", answer)
                S.message_repo.save(session_id, "user", clean_msg)
                S.message_repo.save(session_id, "assistant", answer)
                if req.tts:
                    spoken = _clean_for_tts(answer)
                    if spoken:
                        S.tts.speak(spoken, mode=new_mode, block=False)

                return {"session_id": session_id, "response": answer,
                        "rag_sources": rag_result.get("sources"),
                        "mode": new_mode, "model": active_model}
        except Exception as e:
            logger.warning(f"RAG failed, falling through to LLM: {e}")

    # ══════════════════════════════════════════════════════════════════════════
    # LAYER 3 — LLM call
    # ══════════════════════════════════════════════════════════════════════════
    active_llm = _get_active_llm()
    system_prompt = get_prompt(new_mode)
    ctx = S.memory.get_context(session_id, clean_msg)

    if ctx.get("summary"):
        system_prompt += f"\n\n[PRIOR SUMMARY]\n{ctx['summary']}"

    messages = [{"role": m["role"], "content": m["content"]}
                for m in ctx.get("short_term", [])]
    messages.append({"role": "user", "content": clean_msg})

    if req.stream:
        async def llm_stream():
            full_response = ""
            try:
                gen = active_llm.stream_response(messages, system_prompt=system_prompt)
                # Check if generator is async (Ollama) or sync (Fallback models)
                if inspect.isasyncgen(gen):
                    async for token in gen:
                        full_response += token
                        yield f"data: {json.dumps({'token': token, 'model': active_model})}\n\n"
                else:
                    for token in gen:
                        full_response += token
                        yield f"data: {json.dumps({'token': token, 'model': active_model})}\n\n"
                
                answer = filter_response(full_response, new_mode)
                if not answer or not answer.strip():
                    answer = "Kuch hua kya? Batao na..." if new_mode == "romantic" else "I'm sorry, could you rephrase that?"
                
                # Post-processing memory saving
                S.memory.add_message(session_id, "user", clean_msg, llm_client=S.llm)
                S.memory.add_message(session_id, "assistant", answer)
                S.message_repo.save(session_id, "user", clean_msg)
                S.message_repo.save(session_id, "assistant", answer, 0, 0)
                S.session_repo.increment_count(session_id)
                save_to_history(session_id, "user", clean_msg)
                save_to_history(session_id, "assistant", answer)
                
                if req.tts:
                    S.tts.speak(answer, mode=new_mode, block=False)
                    
                yield f"data: {json.dumps({'done': True})}\n\n"
                
            except Exception as e:
                logger.error(f"Stream failed: {e}")
                # Layer 4 Fallback embedded inside the stream
                fallback = "I'm having trouble with the AI engine right now. You can still use tools."
                yield f"data: {json.dumps({'error': str(e), 'fallback': fallback, 'model': 'fallback'})}\n\n"
                
        return StreamingResponse(llm_stream(), media_type="text/event-stream")
        
    else:
        # Standard Sync Request
        try:
            llm_resp = active_llm.generate_response(messages, system_prompt=system_prompt)
            answer = filter_response(llm_resp.content, new_mode)

            if not answer or not answer.strip():
                answer = ("Kuch hua kya? Batao na..."
                          if new_mode == "romantic"
                          else "I'm sorry, could you rephrase that?")

            S.memory.add_message(session_id, "user", clean_msg, llm_client=S.llm)
            S.memory.add_message(session_id, "assistant", answer)
            S.message_repo.save(session_id, "user", clean_msg)
            S.message_repo.save(session_id, "assistant", answer,
                                 llm_resp.total_tokens, llm_resp.latency_ms)
            S.session_repo.increment_count(session_id)
            save_to_history(session_id, "user", clean_msg)
            save_to_history(session_id, "assistant", answer)

            if req.tts:
                S.tts.speak(answer, mode=new_mode, block=False)

            return {"session_id": session_id, "response": answer,
                    "mode": new_mode, "metrics": llm_resp.to_dict(),
                    "model": active_model}

        except Exception as e:
            # ══════════════════════════════════════════════════════════════════════
            # LAYER 4 — LLM failure fallback
            # ══════════════════════════════════════════════════════════════════════
            logger.error(f"LLM failed: {e}")
            fallback = (
                "I'm having trouble with the AI engine right now. "
                "You can still use tools — try 'what time is it', "
                "'check battery', 'set a reminder', or 'take a screenshot'."
            )
            S.memory.add_message(session_id, "user", clean_msg)
            S.memory.add_message(session_id, "assistant", fallback)
            S.message_repo.save(session_id, "user", clean_msg)
            S.message_repo.save(session_id, "assistant", fallback)

            if req.tts:
                S.tts.speak(fallback, mode=new_mode, block=False)

            return {
                "session_id": session_id,
                "response":   fallback,
                "mode":       new_mode,
                "model":      "fallback",
                "error":      str(e),
            }


# ── Voice Endpoints ───────────────────────────────────────────────────────────

@app.post("/voice", tags=["Voice"])
async def voice_input(req: VoiceRequest):
    try:
        text = S.stt.listen_and_transcribe(req.duration_seconds)
        if not text:
            return {"transcribed": "", "status": "no_speech"}
        return {"transcribed": text, "status": "ok", "session_id": req.session_id}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/voice/transcribe", tags=["Voice"])
async def transcribe_audio(file: UploadFile = File(...)):
    try:
        audio_bytes = await file.read()
        if len(audio_bytes) < 1000:
            return {"transcribed": "", "status": "too_short"}

        suffix = ".webm"
        if file.filename:
            ext = file.filename.rsplit(".", 1)[-1].lower()
            if ext in ("wav", "mp3", "m4a", "ogg", "webm"):
                suffix = f".{ext}"
        elif file.content_type:
            ct = file.content_type
            if "wav" in ct:   suffix = ".wav"
            elif "mp3" in ct: suffix = ".mp3"
            elif "ogg" in ct: suffix = ".ogg"

        text = S.stt.transcribe_bytes(audio_bytes, suffix=suffix)
        if not text or not text.strip():
            return {"transcribed": "", "status": "no_speech"}

        logger.info(f"Whisper transcribed: {text[:80]}")
        return {"transcribed": text.strip(), "status": "ok"}

    except Exception as e:
        logger.error(f"Transcribe error: {e}")
        raise HTTPException(500, str(e))


# ── RAG / Documents ───────────────────────────────────────────────────────────

@app.post("/upload_document", tags=["RAG"])
async def upload_document(file: UploadFile = File(...)):
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in config.rag.allowed_extensions:
        raise HTTPException(400, f"Unsupported type: .{ext}")
    content = await file.read()
    if len(content) > config.api.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "File too large.")
    fname = f"{uuid.uuid4()}_{file.filename}"
    path = os.path.join(config.tools.sandbox_directory, fname)
    with open(path, "wb") as f:
        f.write(content)
    doc_id = S.document_repo.save(file.filename, ext, path)
    try:

        # Read the chunks into FAISS
        chunks = S.rag.index_document(path, doc_id, file.filename)
        S.document_repo.update_indexed(doc_id, chunks)

        # Delete the heavy raw PDF file from the hard drive immediately to save space!
        if os.path.exists(path):
            os.remove(path)
            logger.info(f"Deleted raw file {fname} to save space.")


        return {"doc_id": doc_id, "filename": file.filename,
                "chunks_indexed": chunks, "status": "indexed"}
    except Exception as e:
        raise HTTPException(500, f"Indexing failed: {e}")


@app.get("/documents", tags=["RAG"])
async def list_documents():
    return {"documents": S.document_repo.list_all()}


# ── Memory ────────────────────────────────────────────────────────────────────

@app.get("/memory", tags=["Memory"])
async def get_memory(session_id: str, query: Optional[str] = None):
    # 1. Fetch the FULL permanent history from the SQLite database
    db_messages = S.message_repo.get_all(session_id)
    
    # 2. Format it exactly how the React frontend expects it
    formatted_msgs = [
        {
            "role": m["role"],
            "content": m["content"],
            "timestamp": m.get("created_at")
        }
        for m in db_messages
    ]

    # 3. Keep all your original memory stats intact
    stats   = S.memory.stats(session_id)
    summary = S.memory.get_summary(session_id)
    lt      = S.memory.search_long_term(session_id, query) if query else []
    
    return {
        "session_id": session_id, 
        "stats": stats,
        "short_term": formatted_msgs,  
        "summary": summary, 
        "long_term_results": lt
    }
# ── Tools ─────────────────────────────────────────────────────────────────────

@app.post("/tool", tags=["Tools"])
async def run_tool(req: ToolRequest):
    tool = S.registry.get(req.tool_name)
    if not tool:
        raise HTTPException(404, f"Tool '{req.tool_name}' not found.")
    if not tool.enabled:
        raise HTTPException(403, f"Tool '{req.tool_name}' disabled.")
    result = S.executor.execute(req.tool_name, req.parameters, req.session_id)
    S.tool_log_repo.log(req.tool_name, req.parameters, result.output,
                        result.success, result.error, result.exec_ms, req.session_id)
    if not result.success:
        raise HTTPException(400, result.error)
    return result.to_dict()


@app.get("/tools", tags=["Tools"])
async def list_tools():
    return {"tools": S.registry.list_tools()}


# ── Productivity ──────────────────────────────────────────────────────────────

@app.get("/reminders", tags=["Productivity"])
async def get_reminders():
    return {"reminders": S.reminder_repo.list_active()}


@app.get("/notes", tags=["Productivity"])
async def get_notes():
    return {"notes": S.note_repo.list_all()}


# ── Session ops ───────────────────────────────────────────────────────────────

@app.post("/reset", tags=["Sessions"])
async def reset_session(req: ResetRequest):
    S.memory.clear_session(req.session_id)
    S.message_repo.delete_session(req.session_id)

    # wipe rag on clear memory
    if hasattr(S.rag, 'clear'):
        S.rag.clear()
        logger.info("Wiped FAISS database due to memory reset.")

    return {"message": f"Session {req.session_id} reset.", "session_id": req.session_id}


@app.post("/export", tags=["Sessions"])
async def export_conversation(req: ExportRequest):
    msgs = S.message_repo.get_all(req.session_id)
    if not msgs:
        raise HTTPException(404, "No messages found.")
    result = S.executor.execute(
        "export_chat",
        {"session_id": req.session_id, "messages": msgs},
        req.session_id
    )
    return result.to_dict()


# ── Error handlers ────────────────────────────────────────────────────────────

@app.exception_handler(HTTPException)
async def http_error(request, exc):
    logger.warning(f"HTTP {exc.status_code}: {exc.detail}")
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(Exception)
async def generic_error(request, exc):
    logger.error(f"Unhandled: {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"error": "Internal server error."})


import multiprocessing
multiprocessing.freeze_support()

if __name__ == "__main__":
    port = int(os.getenv("MAYA_PORT", str(config.api.port)))
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        reload=False,
        log_level=config.logging.log_level.lower()
    )
