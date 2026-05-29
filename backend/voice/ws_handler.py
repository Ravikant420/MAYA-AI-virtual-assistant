"""
voice/ws_handler.py
WebSocket bridge: wake word → browser.
- One connection set, one event loop reference
- Wake cooldown prevents duplicate wake events
- command_done from browser resets cooldown immediately
"""

import asyncio
import json
import threading
import time
from utils.logger import setup_logger
from voice.wake_word import get_listener
from voice.speech_to_text import SpeechToTextManager
from voice.text_to_speech import TTSManager
from voice.mode_manager import ModeManager

logger = setup_logger("voice.ws_handler")

# ─── Singletons ────────────────────────────────────────────────────────────
_connections: set                        = set()
_stt:         SpeechToTextManager        = SpeechToTextManager()
_tts:         TTSManager                 = TTSManager()
_mode:        ModeManager                = ModeManager()
_loop:        asyncio.AbstractEventLoop  = None

# ─── Wake cooldown ──────────────────────────────────────────────────────────
_COOLDOWN    = 5.0   # seconds to suppress repeated wake events
_last_wake   = 0.0
_wake_lock   = threading.Lock()


# ─── WebSocket endpoint ─────────────────────────────────────────────────────
async def websocket_endpoint(websocket):
    await websocket.accept()
    _connections.add(websocket)
    logger.info(f"WS connected — total: {len(_connections)}")
    try:
        while True:
            raw = await websocket.receive_text()
            if raw == 'ping':
                await websocket.send_text('pong')
                continue
            try:
                msg = json.loads(raw)
            except Exception:
                continue

            t = msg.get('type')
            if t == 'session':
                websocket.session_id = msg.get('session_id', 'default')

            elif t == 'command_done':
                # Browser finished capturing command — immediately unlock wake
                global _last_wake
                _last_wake = 0.0
                logger.debug('command_done received — wake re-enabled')

    except Exception:
        pass
    finally:
        _connections.discard(websocket)
        logger.info('WS disconnected')


# ─── Broadcast helpers ──────────────────────────────────────────────────────
async def _broadcast(event: dict):
    payload = json.dumps(event)
    dead = set()
    for ws in list(_connections):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    _connections.difference_update(dead)


def _broadcast_sync(event: dict):
    """Send event from any thread to all browser clients."""
    if not _loop or not _loop.is_running():
        logger.warning('No event loop — broadcast skipped')
        return
    asyncio.run_coroutine_threadsafe(_broadcast(event), _loop)


# ─── Init ───────────────────────────────────────────────────────────────────
def init_wake_word_ws(session_id: str = 'default'):
    """
    Called once on startup from main.py lifespan.
    Captures the running asyncio loop, wires wake word callbacks,
    and starts the Porcupine listener thread.
    """
    global _loop, _last_wake
    try:
        _loop = asyncio.get_running_loop()
    except RuntimeError:
        _loop = asyncio.get_event_loop()

    listener = get_listener(stt_manager=_stt)

    def on_wake():
        global _last_wake
        with _wake_lock:
            now = time.monotonic()
            if now - _last_wake < _COOLDOWN:
                logger.debug(f'Wake suppressed (cooldown {now - _last_wake:.1f}s)')
                return
            _last_wake = now

        logger.info('Wake detected — notifying browser')
        _tts.play_hmm()
        _broadcast_sync({'type': 'wake'})

    def on_command(text: str):
        """Fallback: backend captured a command directly (rare)."""
        global _last_wake
        mode, switched = _mode.detect_and_switch(session_id, text)
        if switched:
            threading.Thread(
                target=_tts.speak,
                args=(_mode.mode_switch_message(mode),),
                kwargs={'mode': mode, 'block': True},
                daemon=True
            ).start()
        _broadcast_sync({
            'type':         'command',
            'text':         text,
            'mode':         mode,
            'mode_switched': switched,
        })
        _last_wake = 0.0   # reset so next wake works immediately
        logger.info(f'Command forwarded to browser: {text!r}')

    listener.on_wake    = on_wake
    listener.on_command = on_command
    listener.start()
    logger.info('Wake word WS bridge ready')
