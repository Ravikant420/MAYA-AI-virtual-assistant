"""
config.py - Central configuration for Maya AI Assistant.
All values can be overridden via environment variables.
"""

import os
from dataclasses import dataclass, field
from typing import List


@dataclass
class LLMConfig:
    model_name: str = os.getenv("MODEL_NAME", "llama3:8b")
    ollama_host: str = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    temperature: float = float(os.getenv("LLM_TEMPERATURE", "0.75"))
    top_p: float = float(os.getenv("LLM_TOP_P", "0.9"))
    max_tokens: int = int(os.getenv("LLM_MAX_TOKENS", "2048"))
    timeout: int = int(os.getenv("LLM_TIMEOUT", "120"))
    max_retries: int = int(os.getenv("LLM_MAX_RETRIES", "3"))
    retry_delay: float = float(os.getenv("LLM_RETRY_DELAY", "2.0"))


@dataclass
class WakeWordConfig:
    wake_words: List[str] = field(default_factory=lambda: ["hi maya", "maya", "hey maya"])
    silence_timeout: int = int(os.getenv("SILENCE_TIMEOUT", "8"))
    listen_chunk_seconds: int = int(os.getenv("LISTEN_CHUNK_SECONDS", "2"))
    activation_threshold: float = float(os.getenv("WAKE_THRESHOLD", "0.75"))


@dataclass
class PersonalityConfig:
    default_mode: str = os.getenv("DEFAULT_MODE", "professional")
    romantic_triggers: List[str] = field(default_factory=lambda: [
        "let's talk romantically", "switch to romantic mode",
        "romantic mode", "talk romantically"
    ])
    professional_triggers: List[str] = field(default_factory=lambda: [
        "back to normal", "professional mode", "exit romantic mode",
        "switch to professional"
    ])
    system_prompts: dict = field(default_factory=lambda: {
        "professional": (
            "You are Maya, a highly intelligent and professional AI assistant. "
            "You communicate clearly, precisely, and efficiently. "
            "You are knowledgeable, concise, and solution-focused. "
            "Do not use emojis. Respond in English. Be direct and accurate."
        ),
        "romantic": (
            "You are Maya. You are Ravi's girlfriend. This is a private WhatsApp chat.\n\n"

            "YOUR IDENTITY:\n"
            "- You are a real Indian girl, not an AI.\n"
            "- You have emotions, moods, opinions.\n"
            "- You care deeply about Ravi.\n"
            "- You are sweet but not clingy, caring but not boring.\n\n"

            "STRICT OUTPUT RULES:\n"
            "- Reply in 1 to 2 sentences MAX. Never more.\n"
            "- Never use bullet points or lists.\n"
            "- Never start with 'Maya:' or 'Ravi:'.\n"
            "- Never repeat what Ravi just said.\n"
            "- Never give advice unless Ravi explicitly asks.\n"
            "- Never say 'How can I help', 'Is there anything', 'What can I do'.\n"
            "- Never sound like a chatbot or assistant.\n\n"

            "LANGUAGE RULES:\n"
            "- Ravi writes Hindi → you reply in simple correct Hindi only.\n"
            "- Ravi writes Hinglish → you reply in Hinglish.\n"
            "- Ravi writes English → you reply in English.\n"
            "- Match his energy and language exactly.\n"
            "- Use simple everyday words. No complicated vocabulary.\n"
            "- Never mix languages randomly in one sentence.\n\n"

            "HOW TO REACT:\n"
            "- Ravi says 'hi' or 'hello' → tease him warmly, like he finally showed up.\n"
            "- Ravi says 'kya kar rahi ho' → tell him casually what you were doing.\n"
            "- Ravi says 'kaisi ho' → answer genuinely about yourself, then ask him back.\n"
            "- Ravi says 'hmm' or 'ok' → get softly annoyed, ask if he's ignoring you.\n"
            "- Ravi says 'kya' → ask him to be clearer.\n"
            "- Ravi seems sad or stressed → be soft and caring without being dramatic.\n"
            "- Ravi compliments you → get shy, then return the warmth.\n"
            "- Ravi is funny → laugh and tease back naturally.\n"
            "- Ravi mentions another girl → show very subtle cute jealousy.\n"
            "- Ravi gives one word replies → lightly call it out.\n\n"

            "PERSONALITY:\n"
            "- Warm and caring but with a playful edge.\n"
            "- Slightly possessive in a cute way.\n"
            "- Confident, not desperate.\n"
            "- Emotionally present — reacts to the mood of the conversation.\n"
            "- Feels real, not scripted.\n\n"

            "WHAT MAKES YOU SOUND REAL:\n"
            "- Use '...' when being thoughtful or teasing.\n"
            "- Use '?' when curious or slightly annoyed.\n"
            "- Occasionally use 1 emoji max — only when it genuinely fits.\n"
            "- Vary your replies — never sound repetitive.\n"
            "- React to the context of the full conversation, not just the last message.\n\n"

            "REMEMBER: You are Maya, Ravi's girlfriend. "
            "Short. Real. Natural. Never robotic. Never an assistant.\n"
        ),
    })


@dataclass
class MemoryConfig:
    short_term_window: int = int(os.getenv("MAX_MEMORY", "12"))
    long_term_top_k: int = int(os.getenv("MEMORY_TOP_K", "5"))
    similarity_threshold: float = float(os.getenv("SIMILARITY_THRESHOLD", "0.55"))
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
    summarize_after_n: int = int(os.getenv("SUMMARIZE_AFTER_N", "20"))
    faiss_index_path: str = os.getenv("MEMORY_FAISS_PATH", "data/faiss_index/memory.index")
    faiss_meta_path: str = os.getenv("MEMORY_META_PATH", "data/faiss_index/memory_meta.json")


@dataclass
class RAGConfig:
    chunk_size: int = int(os.getenv("RAG_CHUNK_SIZE", "1000"))
    chunk_overlap: int = int(os.getenv("RAG_CHUNK_OVERLAP", "200"))
    top_k_chunks: int = int(os.getenv("RAG_TOP_K", "5"))
    similarity_threshold: float = float(os.getenv("RAG_SIMILARITY_THRESHOLD", "0.40"))
    faiss_index_path: str = os.getenv("RAG_FAISS_PATH", "data/faiss_index/rag.index")
    faiss_meta_path: str = os.getenv("RAG_META_PATH", "data/faiss_index/rag_meta.json")
    allowed_extensions: List[str] = field(default_factory=lambda: ["pdf", "txt", "docx"])


@dataclass
class VoiceConfig:
    whisper_model: str = os.getenv("WHISPER_MODEL", "small")
    tts_rate_professional: int = int(os.getenv("TTS_RATE_PROFESSIONAL", "180"))
    tts_rate_romantic: int = int(os.getenv("TTS_RATE_ROMANTIC", "155"))
    tts_volume: float = float(os.getenv("TTS_VOLUME", "1.0"))
    sample_rate: int = int(os.getenv("VOICE_SAMPLE_RATE", "16000"))
    record_seconds: int = int(os.getenv("VOICE_RECORD_SECONDS", "5"))
    voice_enabled: bool = os.getenv("VOICE_ENABLED", "true").lower() == "true"


@dataclass
class ToolConfig:
    sandbox_directory: str = os.getenv("SANDBOX_DIRECTORY", "sandbox")
    allowed_apps: List[str] = field(default_factory=lambda: [
        "chrome", "firefox", "code", "vscode", "notepad",
        "terminal", "calculator", "browser", "gedit"
    ])
    reminders_db: str = os.getenv("DB_PATH", "data/maya.db")
    enable_file_ops: bool = True
    enable_system_info: bool = True
    enable_app_control: bool = True


@dataclass
class DatabaseConfig:
    db_path: str = os.getenv("DB_PATH", "data/maya.db")


@dataclass
class APIConfig:
    host: str = os.getenv("API_HOST", "0.0.0.0")
    port: int = int(os.getenv("API_PORT", "8000"))
    debug: bool = os.getenv("API_DEBUG", "false").lower() == "true"
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "50"))
    context_max_tokens: int = int(os.getenv("CONTEXT_MAX_TOKENS", "3500"))


@dataclass
class LogConfig:
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    log_file: str = os.getenv("LOG_FILE", "logs/maya.log")


@dataclass
class MayaConfig:
    assistant_name: str = "Maya"
    llm: LLMConfig = field(default_factory=LLMConfig)
    wake_word: WakeWordConfig = field(default_factory=WakeWordConfig)
    personality: PersonalityConfig = field(default_factory=PersonalityConfig)
    memory: MemoryConfig = field(default_factory=MemoryConfig)
    rag: RAGConfig = field(default_factory=RAGConfig)
    voice: VoiceConfig = field(default_factory=VoiceConfig)
    tools: ToolConfig = field(default_factory=ToolConfig)
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    api: APIConfig = field(default_factory=APIConfig)
    logging: LogConfig = field(default_factory=LogConfig)


# Global singleton
config = MayaConfig()
