# backend/utils/paths.py
"""
Resource path resolver.
Works in both development (raw Python) and PyInstaller bundle.

Usage:
    from utils.paths import rp, data_dir, models_dir

    WAKE_MODEL = rp("models/wake/maya.ppn")
    PIPER_EN   = os.path.join(models_dir(), "en_US-lessac-medium.onnx")
"""

import os
import sys


def rp(relative_path: str) -> str:
    """
    Returns the correct absolute path for any bundled resource file.
    - In development: resolves from backend/ directory
    - In PyInstaller bundle: resolves from sys._MEIPASS temp directory
    """
    if hasattr(sys, "_MEIPASS"):
        base = sys._MEIPASS
    else:
        # Go up one level from utils/ to backend/
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, relative_path)


def data_dir() -> str:
    """
    Returns the user data directory for runtime files:
    - Conversation history JSON
    - Session data
    - Downloaded models

    Priority:
    1. MAYA_DATA_DIR env var (set by Electron)
    2. OS app data directory (production)
    3. backend/data/ (development)
    """
    env = os.getenv("MAYA_DATA_DIR")
    if env:
        os.makedirs(env, exist_ok=True)
        return env

    if hasattr(sys, "_MEIPASS"):
        home = os.path.expanduser("~")
        if sys.platform == "darwin":
            d = os.path.join(home, "Library", "Application Support", "Maya")
        elif sys.platform == "win32":
            d = os.path.join(os.getenv("APPDATA", home), "Maya")
        else:
            d = os.path.join(home, ".config", "Maya")
        os.makedirs(d, exist_ok=True)
        return d

    # Development
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    d = os.path.join(base, "data")
    os.makedirs(d, exist_ok=True)
    return d


def models_dir() -> str:
    """Returns path to Piper TTS model directory."""
    d = os.path.join(data_dir(), "models", "piper")
    os.makedirs(d, exist_ok=True)
    return d


def piper_bin() -> str:
    """
    Returns path to the Piper TTS binary, or None if not found.
    Checks:
    1. MAYA_DATA_DIR/piper/piper  (downloaded by SetupScreen)
    2. System PATH
    """
    # Downloaded location
    candidate = os.path.join(data_dir(), "piper", "piper")
    if os.path.exists(candidate) and os.access(candidate, os.X_OK):
        return candidate

    # System PATH fallback
    import shutil
    found = shutil.which("piper")
    return found if found else None
