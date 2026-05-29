# backend/api/setup.py
# Setup status endpoint — Electron handles all downloads directly via Node.js
# This endpoint just reports what is already installed

import os
from fastapi import APIRouter

router = APIRouter(prefix="/api/setup", tags=["setup"])

def _data_dir() -> str:
    return os.getenv("MAYA_DATA_DIR", os.path.expanduser("~/.maya"))

def _models_dir() -> str:
    return os.path.join(_data_dir(), "models", "piper")

def _piper_dir() -> str:
    return os.path.join(_data_dir(), "piper")


@router.get("/status")
async def setup_status():
    """
    Returns installation status of all components.
    Called by SetupScreen to check what is already downloaded
    so completed steps can be skipped on retry.
    """
    models   = _models_dir()
    piper    = _piper_dir()
    piper_bin = os.path.join(piper,  "piper")
    piper_en  = os.path.join(models, "en_US-lessac-medium.onnx")
    piper_hi  = os.path.join(models, "hi_IN-hindi_ldcil-medium.onnx")

    def file_ok(path, min_size=10_000_000):
        return os.path.exists(path) and os.path.getsize(path) > min_size

    def bin_ok(path):
        return os.path.exists(path) and os.access(path, os.X_OK) and os.path.getsize(path) > 1000

    return {
        "piper_bin": {
            "installed": bin_ok(piper_bin),
            "path":      piper_bin if bin_ok(piper_bin) else None,
        },
        "piper_en": {
            "installed": file_ok(piper_en),
            "size":      os.path.getsize(piper_en) if os.path.exists(piper_en) else 0,
        },
        "piper_hi": {
            "installed": file_ok(piper_hi),
            "size":      os.path.getsize(piper_hi) if os.path.exists(piper_hi) else 0,
        },
        "data_dir": _data_dir(),
    }
