# build/maya-backend.spec
# PyInstaller spec file for Maya AI backend
# Run from Maya/ root: pyinstaller build/maya-backend.spec --distpath dist/backend/

import sys
import os
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_all

block_cipher = None

# ── Resolve paths ──────────────────────────────────────────────────────────────
SPEC_DIR    = os.path.dirname(os.path.abspath(SPEC))
ROOT_DIR    = os.path.dirname(SPEC_DIR)
BACKEND_DIR = os.path.join(ROOT_DIR, 'backend')

import pvporcupine
PORCUPINE_DIR = os.path.dirname(pvporcupine.__file__)

import whisper as _whisper_pkg
WHISPER_ASSETS = os.path.join(os.path.dirname(_whisper_pkg.__file__), 'assets')

import pvrecorder
RECORDER_DIR = os.path.dirname(pvrecorder.__file__)

import shutil
FFMPEG_BIN = shutil.which('ffmpeg') or ''
try:
    import imageio_ffmpeg
    FFMPEG_BIN = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    pass

# ── Collect sentence-transformers + transformers data files ───────────────────
st_datas,    st_binaries,    st_hiddens    = collect_all('sentence_transformers')
trans_datas, trans_binaries, trans_hiddens = collect_all('transformers')
tok_datas,   tok_binaries,   tok_hiddens   = collect_all('tokenizers')

# ── Analysis ───────────────────────────────────────────────────────────────────
a = Analysis(
    [os.path.join(BACKEND_DIR, 'main.py')],
    pathex=[BACKEND_DIR],
    binaries=[
        (os.path.join(RECORDER_DIR, 'lib', 'mac', 'arm64'),   'pvrecorder/lib/mac/arm64'),
        (os.path.join(RECORDER_DIR, 'lib', 'mac', 'x86_64'),  'pvrecorder/lib/mac/x86_64'),
        *( [(FFMPEG_BIN, '.')] if FFMPEG_BIN else [] ),
        *collect_dynamic_libs('sounddevice'),
        *st_binaries,
        *trans_binaries,
        *tok_binaries,
    ],
    datas=[
        (os.path.join(PORCUPINE_DIR, 'lib'),       'pvporcupine/lib'),
        (os.path.join(PORCUPINE_DIR, 'resources'), 'pvporcupine/resources'),
        (WHISPER_ASSETS,                            'whisper/assets'),
        (os.path.expanduser('~/.cache/whisper'),    'whisper_cache'),
        # ── sentence-transformers + transformers data ─────────────────────
        *st_datas,
        *trans_datas,
        *tok_datas,
        # ── HuggingFace cached model (all-MiniLM-L6-v2) ──────────────────
        *collect_data_files('sentence_transformers'),
        *( [(os.path.expanduser('~/.cache/huggingface'), 'huggingface_cache')]
           if os.path.exists(os.path.expanduser('~/.cache/huggingface')) else [] ),
    ],
    hiddenimports=[
        # ── anyio backends ────────────────────────────────────────────────
        'anyio',
        'anyio._backends',
        'anyio._backends._asyncio',
        'anyio._backends._trio',
        'anyio._core',
        'anyio._core._eventloop',
        'anyio._core._synchronization',
        'anyio._core._tasks',
        'anyio._core._sockets',
        'anyio._core._fileio',
        'anyio.abc',
        'anyio.streams',
        'anyio.streams.memory',
        'sniffio',
        # ── Uvicorn ───────────────────────────────────────────────────────
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.http.httptools_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.protocols.websockets.websockets_impl',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        # ── FastAPI / Starlette ───────────────────────────────────────────
        'fastapi',
        'fastapi.middleware.cors',
        'starlette.middleware',
        'starlette.middleware.errors',
        'starlette.middleware.base',
        'starlette.responses',
        'pydantic',
        'pydantic.deprecated.decorator',
        # ── Voice ─────────────────────────────────────────────────────────
        'whisper',
        'pvporcupine',
        'sounddevice',
        'soundfile',
        # ── sentence-transformers + transformers ──────────────────────────
        'sentence_transformers',
        'sentence_transformers.models',
        'sentence_transformers.util',
        'transformers',
        'transformers.models',
        'transformers.models.auto',
        'transformers.models.bert',
        'transformers.modeling_utils',
        'transformers.tokenization_utils',
        'transformers.tokenization_utils_fast',
        'transformers.configuration_utils',
        'transformers.feature_extraction_utils',
        'transformers.pipelines',
        'tokenizers',
        'huggingface_hub',
        'huggingface_hub.file_download',
        # ── torch ─────────────────────────────────────────────────────────
        'torch',
        'torch.nn',
        'torch.nn.functional',
        'torch.utils',
        'torch.utils.data',
        # ── FAISS ─────────────────────────────────────────────────────────
        'faiss',
        # ── PIL / Pillow (required by sentence-transformers) ──────────────
        'PIL',
        'PIL.Image',
        # ── Other ─────────────────────────────────────────────────────────
        'multipart',
        'h11',
        'httptools',
        'email.mime',
        'email.mime.multipart',
        # ── multiprocessing freeze support ────────────────────────────────
        'multiprocessing',
        'multiprocessing.freeze_support',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        'tkinter', 'matplotlib', 'notebook',
        'IPython',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='maya-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='maya-backend',
)
