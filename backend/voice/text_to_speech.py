"""
voice/text_to_speech.py
Cross-platform TTS for Maya.
Priority: Piper → macOS say → Windows SAPI (pyttsx3)
"""

import os
import platform
import subprocess
import threading
import re
from utils.logger import setup_logger

logger = setup_logger("voice.tts")

IS_MAC     = platform.system() == "Darwin"
IS_WINDOWS = platform.system() == "Windows"

PIPER_EN = os.path.abspath(os.getenv("PIPER_MODEL_EN", "models/piper/en_US-lessac-medium.onnx"))
PIPER_HI = os.path.abspath(os.getenv("PIPER_MODEL_HI", "models/piper/hi_IN-priyamvada-medium.onnx"))


def _lang(text: str) -> str:
    """
    Detect language from text.
    - Devanagari characters → Hindi (hi)
    - Common Hinglish Latin-script words → Hindi voice
    - Everything else → English (en)
    """
    # Devanagari script — definite Hindi
    if any('\u0900' <= c <= '\u097F' for c in text):
        logger.info("[Lang Detect] Devanagari script found -> 'hi'")
        return "hi"

    # Hinglish Latin-script words
    hinglish_words = {
        "haan", "nahi", "nai", "acha", "accha", "achha", "theek", "bilkul",
        "shukriya", "shukriyaa", "arre", "oho", "wah", "waah",
        "hota", "hoti", "hote", "hai", "hain", "tha", "thi", "the",
        "kar", "karo", "karta", "karti", "karte", "kiya", "karna",
        "hona", "hua", "hui", "hue", "raha", "rahi", "rahe",
        "aata", "aati", "aate", "aaya", "aayi", "aayen", "aao", "jao",
        "bolo", "batao", "dekho", "suno", "ruko", "sunao",
        "rehna", "rehte", "rehti", "rehta", "dete", "deta", "deti",
        "main", "mujhe", "mera", "meri", "mere", "mujhko",
        "tum", "tumhe", "tera", "teri", "tere", "tumhara", "tumhari",
        "aap", "aapko", "aapka", "aapki", "hum", "humara", "humari",
        "yaar", "bhai", "dost", "jaan",
        "kya", "kaise", "kaisi", "kaisa", "kyun", "kyunki", "kab",
        "kahan", "kaun", "kitna", "kitni",
        "pyar", "pyaar", "mohabbat", "dil", "dilo", "zindagi", "duniya",
        "baat", "baatein", "kaam", "waqt", "din", "raat",
        "ghar", "log", "insaan", "saath",
        "bahut", "bohot", "zyada", "thoda", "sirf", "bas", "abhi",
        "phir", "sab", "kuch", "aur", "lekin", "magar", "toh",
        "mat", "bhi", "mein", "par",
        "wala", "wali", "waale", "liye", "saaye",
        "kisi", "koi", "unka", "unki", "unhe", "inhe", "inka",
        "apna", "apni", "apne", "khud", "sath",
    }
    
    # Strip all punctuation and convert to lowercase for matching
    clean_text = re.sub(r'[^\w\s]', '', text.lower())
    words = set(clean_text.split())
    
    # Find intersecting words
    matches = words & hinglish_words
    if matches:
        logger.info(f"[Lang Detect] Hinglish words found {matches} -> 'hi'")
        return "hi"

    return "en"


def _strip_md(text: str) -> str:
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = re.sub(r'\*(.*?)\*',     r'\1', text)
    text = re.sub(r'#{1,6}\s',      '',    text)
    text = re.sub(r'`{1,3}[^`]*`{1,3}', '', text)
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    return text.strip()


# Per-language voice cache — avoids reloading but never mixes models
_piper_voices: dict = {}

def _piper(text: str, lang: str) -> bool:
    try:
        from piper import PiperVoice
        import sounddevice as sd
        import soundfile as sf
        import io, wave
        path = PIPER_HI if lang == "hi" else PIPER_EN
        if not os.path.exists(path):
            logger.warning(f"Piper model not found for lang={lang}: {path}")
            return False
        
        # Cache voice per language
        if lang not in _piper_voices:
            logger.info(f"Loading Piper model [{lang}]: {path}")
            _piper_voices[lang] = PiperVoice.load(path)
            
        voice = _piper_voices[lang]
        buf = io.BytesIO()
        with wave.open(buf, 'wb') as wf:
            voice.synthesize(text, wf)
        buf.seek(0)
        data, rate = sf.read(buf)
        sd.play(data, rate)
        sd.wait()
        return True
    except Exception as e:
        logger.warning(f"Piper failed (lang={lang}): {e}")
        _piper_voices.pop(lang, None)
        return False


def _mac(text: str, mode: str, lang: str) -> bool:
    if not IS_MAC:
        return False
    try:
        rate = "155" if mode == "romantic" else "180"
        
        if lang == "hi":
            # Try Lekha first, then Rishi, then default back to Samantha
            try:
                subprocess.run(["say", "-v", "Lekha", "-r", rate, text], check=True, capture_output=True)
                return True
            except subprocess.CalledProcessError:
                try:
                    subprocess.run(["say", "-v", "Rishi", "-r", rate, text], check=True, capture_output=True)
                    return True
                except subprocess.CalledProcessError:
                    logger.warning("Could not find macOS Hindi voices (Lekha/Rishi). Falling back to English.")
                    voice = "Samantha"
        else:
            voice = "Samantha"
            
        subprocess.run(["say", "-v", voice, "-r", rate, text], check=True, capture_output=True)
        return True
    except Exception as e:
        logger.warning(f"macOS say failed: {e}")
        return False


def _windows(text: str, mode: str, lang: str) -> bool:
    if not IS_WINDOWS:
        return False
    try:
        import pyttsx3
        engine = pyttsx3.init()
        voices = engine.getProperty('voices')
        
        target_voice = None
        if lang == "hi":
            target_voice = next((v for v in voices if 'hindi' in v.name.lower() or 'india' in v.name.lower()), None)
            
        if not target_voice:
            target_voice = next((v for v in voices if 'zira' in v.name.lower() or 'female' in v.name.lower()), None)
            
        if target_voice:
            engine.setProperty('voice', target_voice.id)
            
        engine.setProperty('rate',   145 if mode == "romantic" else 175)
        engine.setProperty('volume', 1.0)
        engine.say(text)
        engine.runAndWait()
        engine.stop()
        return True
    except Exception as e:
        logger.warning(f"pyttsx3 failed: {e}")
        return False


class TTSManager:

    def __init__(self):
        self._lock = threading.Lock()

    def health_check(self) -> dict:
        return {
            "running":            True,
            "platform":           "mac" if IS_MAC else "windows" if IS_WINDOWS else "linux",
            "piper_en_available": os.path.exists(PIPER_EN),
            "piper_hi_available": os.path.exists(PIPER_HI),
        }

    def speak(self, text: str, mode: str = "professional", block: bool = False):
        if not text:
            return
        clean = _strip_md(text)
        if not clean:
            return

        def _run():
            with self._lock:
                lang = _lang(clean)
                logger.info(f"TTS [{mode}|{lang}]: {clean[:60]}")
                
                if _piper(clean, lang): return
                if IS_MAC and _mac(clean, mode, lang): return
                if IS_WINDOWS and _windows(clean, mode, lang): return
                logger.error("All TTS engines failed")

        if block:
            _run()
        else:
            threading.Thread(target=_run, daemon=True).start()

    def play_hmm(self):
        def _run():
            try:
                import numpy as np
                import sounddevice as sd
                sr = 22050

                def seg(f0, f1, ms, vol=0.35):
                    n   = int(sr * ms / 1000)
                    f   = np.linspace(f0, f1, n)
                    ph  = np.cumsum(2 * np.pi * f / sr)
                    w   = np.sin(ph)
                    fade = min(int(sr * 0.005), n // 4)
                    env  = np.ones(n)
                    env[:fade]  = np.linspace(0, 1, fade)
                    env[-fade:] = np.linspace(1, 0, fade)
                    return (w * env * vol).astype(np.float32)

                hmm = np.concatenate([seg(220, 260, 120),
                                      np.zeros(int(sr * 0.005), dtype=np.float32),
                                      seg(260, 200, 160)])
                sd.play(hmm, samplerate=sr); sd.wait()
                return
            except Exception as e:
                logger.debug(f"Hmm tone failed: {e}")

            if IS_MAC:
                try:
                    subprocess.run(["say", "-v", "Samantha", "-r", "200", "Hmm"],
                                   capture_output=True)
                    return
                except Exception:
                    pass
            try:
                import pyttsx3
                e = pyttsx3.init()
                e.setProperty("rate", 200)
                e.say("Hmm"); e.runAndWait(); e.stop()
            except Exception as ex:
                logger.warning(f"Hmm fallback failed: {ex}")

        threading.Thread(target=_run, daemon=True).start()


# ─── Singleton ──────────────────────────────────────────────────────────────
_tts: TTSManager = None

def get_tts() -> TTSManager:
    global _tts
    if _tts is None:
        _tts = TTSManager()
    return _tts