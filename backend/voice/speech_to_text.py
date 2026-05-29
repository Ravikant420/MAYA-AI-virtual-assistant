"""
voice/speech_to_text.py
Speech-to-text for Maya.

Engines (priority order):
  1. OpenAI Whisper  — local, offline, accurate
  2. Google Speech Recognition — online fallback

Env vars:
  WHISPER_MODEL  — model size: tiny | base | small | medium | large  (default: small)
  WHISPER_LANG   — language code  (default: en)
"""

import logging
import os
import tempfile
import threading
from typing import Optional

logger = logging.getLogger("maya.stt")

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
WHISPER_LANG  = os.environ.get("WHISPER_LANG",  None)
MIC_TIMEOUT   = 10
MIC_LIMIT     = 15


class SpeechToTextManager:

    def __init__(self):
        self._model          = None
        self._lock           = threading.Lock()
        self._whisper_ok     = False
        self._sr_ok          = False
        self._pyaudio_ok     = False
        self._probe()

    def _probe(self):
        try:
            import whisper          # noqa
            self._whisper_ok = True
            logger.info(f"Whisper available (model={WHISPER_MODEL})")
        except ImportError:
            logger.warning("whisper not installed — pip install openai-whisper")

        try:
            import speech_recognition  # noqa
            self._sr_ok = True
        except ImportError:
            logger.warning("SpeechRecognition not installed — pip install SpeechRecognition")

        try:
            import pyaudio          # noqa
            self._pyaudio_ok = True
        except ImportError:
            logger.warning("pyaudio not installed — pip install pyaudio")

    def pre_warm(self):
        """
        Silently loads the Whisper model into RAM in a background daemon thread.
        This prevents the 'cold start' 3-4 second delay on the very first voice command.
        """
        if not self._whisper_ok or self._model is not None:
            return
            
        def _load_bg():
            try:
                logger.info("Pre-warming Whisper model in background...")
                self._get_model()  # This triggers the actual load
                logger.info("Whisper pre-warm complete. Voice is ready!")
            except Exception as e:
                logger.warning(f"Whisper pre-warm failed: {e}")

        # Use daemon=True so it doesn't block app shutdown if it's still loading
        t = threading.Thread(target=_load_bg, daemon=True, name="whisper-prewarm")
        t.start()

    def _setup_whisper_assets(self):
        """
        Tell Whisper where its assets are when running inside PyInstaller bundle.
        Whisper looks for mel_filters.npz relative to its __file__ path.
        In a frozen app __file__ is wrong — must patch it via env var or monkeypatching.
        """
        import sys
        if not hasattr(self, '_whisper_assets_set'):
            self._whisper_assets_set = True
            if hasattr(sys, '_MEIPASS'):
                assets_path = os.path.join(sys._MEIPASS, 'whisper', 'assets')
                if os.path.exists(assets_path):
                    # Monkeypatch whisper module's __file__ so it resolves assets correctly
                    try:
                        import whisper
                        # whisper uses os.path.join(os.path.dirname(__file__), "assets")
                        # We patch the module's __file__ to point to _MEIPASS/whisper/
                        whisper_module_dir = os.path.join(sys._MEIPASS, 'whisper')
                        whisper.__file__ = os.path.join(whisper_module_dir, '__init__.py')
                        logger.info(f'Whisper assets: {assets_path}')
                    except Exception as e:
                        logger.warning(f'Whisper asset patch failed: {e}')
                else:
                    logger.warning(f'Whisper assets not found at: {assets_path}')

    def _setup_ffmpeg(self):
        """
        Configure ffmpeg for PyInstaller bundle.
        imageio-ffmpeg names the binary 'ffmpeg-macos-aarch64-v7.1' not 'ffmpeg'.
        Whisper calls subprocess('ffmpeg', ...) so we must create a symlink
        named exactly 'ffmpeg' that points to the real binary.
        """
        import sys, shutil, stat
        if not hasattr(self, '_ffmpeg_set'):
            self._ffmpeg_set = True

            # Already on PATH as 'ffmpeg' — nothing to do
            if shutil.which('ffmpeg'):
                return

            real_ffmpeg = None

            # Check imageio-ffmpeg first (most reliable in bundle)
            try:
                import imageio_ffmpeg
                real_ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
                logger.info(f'ffmpeg from imageio-ffmpeg: {real_ffmpeg}')
            except Exception:
                pass

            # Check _MEIPASS for bundled binary
            if not real_ffmpeg and hasattr(sys, '_MEIPASS'):
                bundled = os.path.join(sys._MEIPASS, 'ffmpeg')
                if os.path.exists(bundled):
                    real_ffmpeg = bundled

            if not real_ffmpeg:
                logger.warning('ffmpeg not found — voice transcription will fail')
                return

            # Create a symlink named 'ffmpeg' in a temp dir
            # This is needed because Whisper calls subprocess(['ffmpeg', ...])
            import tempfile
            ffmpeg_dir = tempfile.mkdtemp(prefix='maya_ffmpeg_')
            ffmpeg_link = os.path.join(ffmpeg_dir, 'ffmpeg')

            try:
                os.symlink(real_ffmpeg, ffmpeg_link)
                os.chmod(ffmpeg_link, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP)
                os.environ['PATH'] = ffmpeg_dir + os.pathsep + os.environ.get('PATH', '')
                logger.info(f'ffmpeg symlink created: {ffmpeg_link} → {real_ffmpeg}')
            except Exception as e:
                # Symlink failed — try direct copy
                try:
                    import shutil as sh
                    sh.copy2(real_ffmpeg, ffmpeg_link)
                    os.chmod(ffmpeg_link, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP)
                    os.environ['PATH'] = ffmpeg_dir + os.pathsep + os.environ.get('PATH', '')
                    logger.info(f'ffmpeg copy created: {ffmpeg_link}')
                except Exception as e2:
                    logger.warning(f'ffmpeg setup failed: {e2}')

    def _get_model(self):
        if not self._whisper_ok:
            return None
        self._setup_ffmpeg()
        self._setup_whisper_assets()
        if self._model is None:
            with self._lock:
                if self._model is None:
                    try:
                        import whisper
                        logger.info(f"Loading Whisper '{WHISPER_MODEL}'...")
                        self._model = whisper.load_model(WHISPER_MODEL)
                        logger.info("Whisper loaded")
                    except Exception as e:
                        logger.error(f"Whisper load failed: {e}")
                        self._whisper_ok = False
        return self._model

    def health_check(self) -> dict:
        return {
            "whisper_available":    self._whisper_ok,
            "whisper_model":        WHISPER_MODEL,
            "sr_available":         self._sr_ok,
            "microphone_available": self._sr_ok and self._pyaudio_ok,
            "language":             WHISPER_LANG,
        }

    def transcribe_file(self, path: str) -> Optional[str]:
        if not os.path.exists(path):
            logger.error(f"File not found: {path}")
            return None

        model = self._get_model()
        if model:
            try:
                result = model.transcribe(
                    path,
                    language=WHISPER_LANG,
                    task="transcribe",
                    fp16=False,
                    verbose=False,
                    beam_size=5,
                    best_of=5,
                    temperature=0.0,
                    condition_on_previous_text=False,
                    no_speech_threshold=0.6,
                    compression_ratio_threshold=2.4,
                )
                text = result.get("text", "").strip()
                if text:
                    logger.info(f"[Whisper] {text[:100]}")
                    return text
            except Exception as e:
                logger.warning(f"Whisper failed: {e}")

        if self._sr_ok and not self._whisper_ok: 
            try:
                import speech_recognition as sr
                rec = sr.Recognizer()
                with sr.AudioFile(path) as src:
                    audio = rec.record(src)
                text = rec.recognize_google(audio, language=WHISPER_LANG).strip()
                logger.info(f"[Google SR] {text[:100]}")
                return text or None
            except Exception as e:
                logger.warning(f"Google SR failed: {e}")

        logger.error("All STT engines failed")
        return None

    def transcribe_bytes(self, data: bytes, suffix: str = ".wav") -> Optional[str]:
        if not data:
            return None
        path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False, prefix="maya_") as f:
                f.write(data)
                path = f.name
            return self.transcribe_file(path)
        except Exception as e:
            logger.error(f"transcribe_bytes: {e}")
            return None
        finally:
            if path:
                try: os.unlink(path)
                except OSError: pass

    def listen_and_transcribe(self, duration: int = 5, language: Optional[str] = None) -> Optional[str]:
        if not self._sr_ok or not self._pyaudio_ok:
            logger.warning("Mic unavailable")
            return None
        try:
            import speech_recognition as sr
            rec = sr.Recognizer()
            rec.pause_threshold          = 1.0
            rec.phrase_threshold         = 0.3
            rec.non_speaking_duration    = 0.5
            rec.energy_threshold         = 200
            rec.dynamic_energy_threshold = True

            with sr.Microphone() as src:
                logger.info("Calibrating mic (1s)...")
                rec.adjust_for_ambient_noise(src, duration=1.0)
                logger.info(f"Listening ({duration}s max)...")
                audio = rec.listen(src, timeout=MIC_TIMEOUT, phrase_time_limit=duration)

            return self.transcribe_bytes(audio.get_wav_data(), suffix=".wav")
        except Exception as e:
            logger.error(f"listen_and_transcribe: {e}")
            return None

    def transcribe_stream(self, chunks: list) -> Optional[str]:
        if not chunks:
            return None
        return self.transcribe_bytes(b"".join(chunks), suffix=".wav")