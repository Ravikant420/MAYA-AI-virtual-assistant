"""
voice/wake_word.py
Porcupine wake word listener for Maya.

Setup:
  1. console.picovoice.ai → Porcupine → Train "Hey Maya" keyword
  2. Download .ppn → models/porcupine/hey-maya.ppn
  3. Set PORCUPINE_KEY in .env
"""

import os
import threading
import time
from utils.logger import setup_logger

logger = setup_logger("voice.wake_word")

# Resolved lazily inside _loop() — not at module load time
# This ensures PORCUPINE_KEYWORD_PATH env var from Electron is available
SENSITIVITY = float(os.getenv("PORCUPINE_SENSITIVITY", "0.6"))


def _resolve_keyword_path() -> str:
    """
    Resolve the Porcupine keyword (.ppn) file path.
    Priority:
    1. PORCUPINE_KEYWORD_PATH env var (set by Electron from secrets.json)
    2. DATA_DIR/models/porcupine/hey-maya.ppn (downloaded to user data dir)
    3. Relative path models/porcupine/hey-maya.ppn (dev fallback)
    """
    env_path = os.getenv("PORCUPINE_KEYWORD_PATH", "").strip()
    if env_path and os.path.exists(env_path):
        return env_path

    # Try user data directory (set by Electron)
    data_dir = os.getenv("MAYA_DATA_DIR", "")
    if data_dir:
        data_path = os.path.join(data_dir, "models", "porcupine", "hey-maya.ppn")
        if os.path.exists(data_path):
            return data_path

    # Dev fallback — relative to backend/
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, "models", "porcupine", "hey-maya.ppn")


class WakeWordListener:
    def __init__(self, on_wake=None, on_command=None, stt_manager=None):
        self.on_wake    = on_wake
        self.on_command = on_command
        self._stt       = stt_manager
        self._running   = False
        self._thread    = None

    def start(self):
        if self._running:
            logger.warning('WakeWordListener.start() called but already running — ignored')
            return
        self._running = True
        self._thread  = threading.Thread(target=self._loop, daemon=True, name='wake-word')
        self._thread.start()
        logger.info('Wake word listener started')

    def stop(self):
        self._running = False
        logger.info('Wake word listener stopped')

    def _loop(self):
        import sys
        
        try:
            import pvporcupine
            from pvrecorder import PvRecorder
        except ImportError:
            logger.error('Missing packages — run: pip install pvporcupine pvrecorder')
            self._running = False
            return

        # Handle PyInstaller paths once
        if hasattr(sys, '_MEIPASS'):
            porcupine_data_dir = os.path.join(sys._MEIPASS, 'pvporcupine')
            params_path = os.path.join(porcupine_data_dir, 'lib', 'common', 'porcupine_params.pv')
            if os.path.exists(params_path):
                os.environ['PVPORCUPINE_MODEL_PATH'] = params_path
                logger.info(f'Porcupine params: {params_path}')
            else:
                logger.warning(f'porcupine_params.pv not found at: {params_path}')

        key = os.getenv('PORCUPINE_KEY', '').strip()
        if not key:
            logger.error('PORCUPINE_KEY not set. Get your free key at: console.picovoice.ai')
            self._running = False
            return

        keyword_path = _resolve_keyword_path()
        logger.info(f"Keyword path: {keyword_path}")

        if not os.path.exists(keyword_path):
            logger.error(
                f'Keyword file not found: {keyword_path}\n'
                'Train "Hey Maya" at console.picovoice.ai → Porcupine\n'
                f'Save .ppn to: {keyword_path}'
            )
            self._running = False
            return

        # ── Auto-Recovery Loop ────────────────────────────────────────────────
        while self._running:
            porcupine = None
            recorder  = None
            try:
                porcupine = pvporcupine.create(
                    access_key=key,
                    keyword_paths=[keyword_path],
                    sensitivities=[SENSITIVITY],
                )
                recorder = PvRecorder(
                    frame_length=porcupine.frame_length,
                    device_index=-1,
                )
                recorder.start()
                logger.info(f"Listening for 'Hey Maya' (sensitivity={SENSITIVITY})")

                # Frame processing loop
                while self._running:
                    pcm    = recorder.read()
                    result = porcupine.process(pcm)
                    if result >= 0:
                        logger.info("Wake word 'Hey Maya' detected")
                        if self.on_wake:
                            self.on_wake()
                        time.sleep(0.5)   # brief pause to avoid immediate re-trigger

            except (ValueError, FileNotFoundError) as e:
                # Fatal config errors — stop trying completely
                logger.error(f'Wake word config error:\n{e}')
                self._running = False
                break
            except Exception as e:
                # Device lost lock (Frontend grabbed mic) or other transient error
                if self._running:
                    logger.warning(f'Wake word paused (mic busy). Retrying in 2 seconds...')
                    time.sleep(2)
            finally:
                # Always safely clean up before retrying or exiting
                if recorder:
                    try: recorder.stop(); recorder.delete()
                    except Exception: pass
                if porcupine:
                    try: porcupine.delete()
                    except Exception: pass

        logger.info('Wake word loop exited cleanly')


# ─── Singleton ──────────────────────────────────────────────────────────────
_listener: WakeWordListener = None

def get_listener(stt_manager=None) -> WakeWordListener:
    global _listener
    if _listener is None:
        _listener = WakeWordListener(stt_manager=stt_manager)
    return _listener