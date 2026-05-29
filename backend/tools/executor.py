"""
tools/executor.py - ToolExecutor with all offline tool handlers for Maya.

FIXES applied vs original:
  - h_set_reminder:    JSON fallback uses absolute path derived from config; context manager for file I/O
  - h_list_reminders:  Same path fix; normalized return schema matches SQLite schema
  - h_delete_reminder: reminder_id=0 now raises error; atomic write (write temp + rename)
  - h_create_note:     JSON fallback now actually saves data (was silently discarding)
  - h_show_notes:      JSON fallback reads and returns notes
  - h_delete_note:     JSON fallback deletes by id
  - h_open_app:        Graceful handling when allowed_apps config is missing/empty
  - h_close_app:       Checks osascript returncode; reports if app was not running
  - h_start_timer:     Cleans up _active_timers dict on completion to prevent memory leak
  - h_start_timer:     Returns guidance when needs_duration=True param passed
  - h_calculator:      Returns error instead of wrong result for unsupported functions
  - h_export_chat:     Warns and returns early if messages list is empty
  - h_network_status:  Fixed local IP detection branch for Linux vs macOS
  - h_system_info:     Uses platform.platform() instead of mac_ver() for portability
  - h_mac_brightness:  IS_MAC guard checked before attempting subprocess
  - reset_memory:      Handler added (was in registry but missing from HANDLERS — caused crash)
  - ToolResult.to_text: Truncates large outputs before returning to LLM context
"""

import ast
import json
import operator
import os
import platform
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from datetime import datetime
from typing import Any, Dict

from config import config
from tools.registry import ToolDefinition, ToolRegistry
from utils.logger import setup_logger
from utils.response_filter import check_file_path_safety

logger = setup_logger("tools.executor")

SANDBOX = os.path.abspath(config.tools.sandbox_directory)
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))

IS_MAC     = platform.system() == "Darwin"
IS_LINUX   = platform.system() == "Linux"
IS_WINDOWS = platform.system() == "Windows"

# Absolute paths for JSON fallback files
_REMINDERS_JSON = os.path.join(DATA_DIR, "reminders.json")
_NOTES_JSON     = os.path.join(DATA_DIR, "notes.json")


class SecurityError(Exception):
    pass


class ToolResult:
    def __init__(self, tool: str, success: bool, output: Any,
                 error: str = None, exec_ms: float = 0):
        self.tool     = tool
        self.success  = success
        self.output   = output
        self.error    = error
        self.exec_ms  = exec_ms

    def to_dict(self):
        return {
            "tool":    self.tool,
            "success": self.success,
            "output":  self.output,
            "error":   self.error,
            "exec_ms": round(self.exec_ms, 2),
        }

    def to_text(self, max_chars: int = 800) -> str:
        """
        Return a text summary for injection into LLM context.
        FIX: output is truncated to max_chars to avoid bloating the prompt.
        """
        if not self.success:
            return f"Tool '{self.tool}' failed: {self.error}"

        if isinstance(self.output, dict):
            raw = json.dumps(self.output, indent=2)
        else:
            raw = str(self.output)

        if len(raw) > max_chars:
            raw = raw[:max_chars] + f"\n... [truncated, {len(raw) - max_chars} chars omitted]"

        return f"Tool '{self.tool}': {raw}"


# ── Security helpers ──────────────────────────────────────────────────────────

def _safe_path(filename: str) -> str:
    os.makedirs(SANDBOX, exist_ok=True)
    name = os.path.basename(filename)
    name = re.sub(r"[^\w\.\-]", "_", name)
    if ".." in name:
        raise SecurityError("Path traversal rejected.")
    full = os.path.join(SANDBOX, name)
    if not os.path.abspath(full).startswith(SANDBOX):
        raise SecurityError("Path outside sandbox.")
    return full


# ── JSON fallback helpers ─────────────────────────────────────────────────────

def _read_json(path: str) -> list:
    """Read a JSON list file; return [] if missing or corrupt."""
    if not os.path.exists(path):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        logger.warning(f"Could not read {path}; treating as empty.")
        return []


def _write_json(path: str, data: list) -> None:
    """
    Atomically write a JSON list file.
    FIX: write to temp file first, then rename — prevents corruption on crash.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)  # atomic on all POSIX systems and Windows Vista+


# ── Safe Math ─────────────────────────────────────────────────────────────────

SAFE_OPS = {
    ast.Add:      operator.add,
    ast.Sub:      operator.sub,
    ast.Mult:     operator.mul,
    ast.Div:      operator.truediv,
    ast.Pow:      operator.pow,
    ast.Mod:      operator.mod,
    ast.USub:     operator.neg,
    ast.FloorDiv: operator.floordiv,
}

def _eval(node, depth=0):
    if depth > 15:
        raise ValueError("Expression too complex (max depth 15).")
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp):
        op = SAFE_OPS.get(type(node.op))
        if not op:
            raise ValueError(f"Unsupported operator: {type(node.op).__name__}")
        l_val = _eval(node.left,  depth + 1)
        r_val = _eval(node.right, depth + 1)
        if isinstance(node.op, ast.Div) and r_val == 0:
            raise ZeroDivisionError("Division by zero.")
        return op(l_val, r_val)
    if isinstance(node, ast.UnaryOp):
        op = SAFE_OPS.get(type(node.op))
        if not op:
            raise ValueError("Unsupported unary operator.")
        return op(_eval(node.operand, depth + 1))
    raise ValueError(
        f"Unsupported expression node: {ast.dump(node)}. "
        "Only basic arithmetic (+, -, *, /, **, %, //, parentheses) is supported."
    )

def safe_calc(expr: str) -> float:
    """
    Safely evaluate a math expression using AST parsing.
    FIX: letters are NOT stripped before parsing. Unsupported names (like sqrt, pi)
    now raise a clear ValueError instead of silently producing wrong results.
    """
    cleaned = expr.replace("^", "**").strip()
    # Reject if any alphabetic identifier remains (e.g. sqrt, sin, pi)
    if re.search(r"[a-zA-Z_]", cleaned):
        raise ValueError(
            f"Unsupported function or constant in expression: '{expr}'. "
            "Only plain arithmetic is supported (no sqrt, pi, sin, etc.)."
        )
    # Strip percent sign → divide by 100 handled by registry before reaching here
    cleaned = re.sub(r"[^\d\s\+\-\*\/\(\)\.\^%]", "", cleaned)
    try:
        tree = ast.parse(cleaned, mode="eval")
    except SyntaxError as e:
        raise ValueError(f"Invalid expression syntax: {e}")
    return _eval(tree.body)


# ── Unit Conversion ───────────────────────────────────────────────────────────

CONVERSIONS = {
    ("kg",          "lb"):         2.20462,
    ("lb",          "kg"):         0.453592,
    ("km",          "miles"):      0.621371,
    ("miles",       "km"):         1.60934,
    ("meter",       "feet"):       3.28084,
    ("meters",      "feet"):       3.28084,
    ("feet",        "meter"):      0.3048,
    ("feet",        "meters"):     0.3048,
    ("celsius",     "fahrenheit"): None,  # special formula
    ("fahrenheit",  "celsius"):    None,  # special formula
    ("liter",       "gallon"):     0.264172,
    ("liters",      "gallon"):     0.264172,
    ("gallon",      "liter"):      3.78541,
    ("gallon",      "liters"):     3.78541,
    ("gram",        "oz"):         0.035274,
    ("grams",       "oz"):         0.035274,
    ("oz",          "gram"):       28.3495,
    ("oz",          "grams"):      28.3495,
}

def convert_unit(value: float, from_unit: str, to_unit: str) -> dict:
    key = (from_unit.lower().rstrip("s"), to_unit.lower().rstrip("s"))
    # Try exact key first, then singular forms
    factor = CONVERSIONS.get(key)
    if factor is None and key == ("celsius", "fahrenheit"):
        result = value * 9 / 5 + 32
    elif factor is None and key == ("fahrenheit", "celsius"):
        result = (value - 32) * 5 / 9
    elif factor is not None:
        result = value * factor
    else:
        # Try with original casing
        key2 = (from_unit.lower(), to_unit.lower())
        factor2 = CONVERSIONS.get(key2)
        if factor2 is None:
            raise ValueError(
                f"Unknown unit conversion: {from_unit!r} → {to_unit!r}. "
                f"Supported: {', '.join(f'{a}→{b}' for a,b in CONVERSIONS)}"
            )
        result = value * factor2

    return {
        "value":  value,
        "from":   from_unit,
        "to":     to_unit,
        "result": round(result, 6),
    }


# ── Tool Handlers ─────────────────────────────────────────────────────────────

# ── File system ───────────────────────────────────────────────────────────────

def h_create_file(filename: str, content: str = "", **kw) -> dict:
    if not filename:
        raise ValueError("filename is required.")
        
    # 1. Resolve to a dedicated "Maya Files" folder on the Desktop
    home = os.path.expanduser("~")
    dest_dir = os.path.join(home, "Desktop", "Maya Files")
    os.makedirs(dest_dir, exist_ok=True)
    
    # 2. Clean the filename to prevent path traversal or bad characters
    safe_name = re.sub(r"[^\w\.\-]", "_", os.path.basename(filename))
    
    # Add a default .txt extension if the user didn't specify one
    if "." not in safe_name:
        safe_name += ".txt"
        
    full_path = os.path.join(dest_dir, safe_name)
    
    # 3. Write the content to the file
    with open(full_path, "w", encoding="utf-8") as f:
        f.write(content)
        
    # 4. Auto-Reveal: Open Finder and highlight the new file instantly
    if IS_MAC:
        try:
            subprocess.run(["open", "-R", full_path], capture_output=True)
        except Exception as e:
            logger.warning(f"Could not reveal file in Finder: {e}")
            
    return {
        "created": safe_name, 
        "path": full_path, 
        "size": len(content),
        "message": f"Created '{safe_name}' in your Desktop/Maya Files folder."
    }

# ... (keep your other file handlers like h_read_file, h_delete_file here) ...

def h_read_file(filename: str, **kw) -> dict:
    if not filename:
        raise ValueError("filename is required.")
    path = _safe_path(filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"'{filename}' not found in sandbox.")
    with open(path, encoding="utf-8", errors="ignore") as f:
        content = f.read()
    return {"filename": filename, "content": content, "size": len(content)}

def h_delete_file(filename: str, **kw) -> dict:
    if not filename:
        raise ValueError("filename is required.")
    path = _safe_path(filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"'{filename}' not found.")
    os.remove(path)
    return {"deleted": filename}

def h_rename_file(old_name: str, new_name: str, **kw) -> dict:
    if not old_name or not new_name:
        raise ValueError("Both old_name and new_name are required.")
    old = _safe_path(old_name)
    new = _safe_path(new_name)
    if not os.path.exists(old):
        raise FileNotFoundError(f"'{old_name}' not found.")
    os.rename(old, new)
    return {"renamed": old_name, "to": new_name}

def h_list_directory(path: str = ".", **kw) -> dict:
    os.makedirs(SANDBOX, exist_ok=True)
    entries = []
    for name in sorted(os.listdir(SANDBOX)):
        full = os.path.join(SANDBOX, name)
        entries.append({
            "name":     name,
            "type":     "dir" if os.path.isdir(full) else "file",
            "size":     os.path.getsize(full) if os.path.isfile(full) else None,
            "modified": datetime.fromtimestamp(
                os.path.getmtime(full)
            ).strftime("%Y-%m-%d %H:%M"),
        })
    return {"directory": SANDBOX, "entries": entries, "count": len(entries)}

def h_search_files(query: str = "", path: str = ".", **kw) -> dict:
    os.makedirs(SANDBOX, exist_ok=True)
    matches = []
    for name in os.listdir(SANDBOX):
        if query.lower() in name.lower():
            full = os.path.join(SANDBOX, name)
            matches.append({
                "name": name,
                "size": os.path.getsize(full) if os.path.isfile(full) else None,
            })
    return {"query": query, "matches": matches, "count": len(matches)}

def h_move_file(source: str, destination: str, **kw) -> dict:
    if not source or not destination:
        raise ValueError("Both source and destination are required.")
    src = _safe_path(source)
    dst = _safe_path(destination)
    if not os.path.exists(src):
        raise FileNotFoundError(f"'{source}' not found.")
    shutil.move(src, dst)
    return {"moved": source, "to": destination}

def h_file_metadata(filename: str, **kw) -> dict:
    if not filename:
        raise ValueError("filename is required.")
    path = _safe_path(filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"'{filename}' not found.")
    stat = os.stat(path)
    return {
        "filename": filename,
        "size_bytes": stat.st_size,
        "created":  datetime.fromtimestamp(stat.st_ctime).isoformat(),
        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "is_file":  os.path.isfile(path),
    }


# ── App control ───────────────────────────────────────────────────────────────

def h_open_app(app_name: str, **kw) -> dict:
    """Open an application. Works on macOS, Linux, and Windows."""
    if not app_name:
        raise ValueError("app_name is required.")

    # FIX: gracefully handle missing / empty allowed_apps config
    allowed_cfg = getattr(getattr(config, "tools", None), "allowed_apps", None)
    if allowed_cfg:
        allowed = [a.lower() for a in allowed_cfg]
        if app_name.lower() not in allowed:
            raise SecurityError(
                f"'{app_name}' is not in the allowed apps list. "
                f"Allowed: {', '.join(allowed_cfg)}"
            )
    else:
        logger.warning("config.tools.allowed_apps not set — allowing all apps in dev mode.")

    MAC_APPS = {
        "chrome":     "Google Chrome",
        "firefox":    "Firefox",
        "code":       "Visual Studio Code",
        "vscode":     "Visual Studio Code",
        "notepad":    "TextEdit",
        "terminal":   "Terminal",
        "calculator": "Calculator",
        "browser":    "Safari",
        "safari":     "Safari",
        "finder":     "Finder",
        "xcode":      "Xcode",
        "spotify":    "Spotify",
        "slack":      "Slack",
        "zoom":       "zoom.us",
    }

    LINUX_APPS = {
        "chrome":     ["google-chrome", "chromium", "chromium-browser"],
        "firefox":    ["firefox"],
        "code":       ["code"],
        "vscode":     ["code"],
        "notepad":    ["gedit", "mousepad", "kate", "nano"],
        "terminal":   ["gnome-terminal", "xterm", "konsole"],
        "calculator": ["gnome-calculator", "kcalc"],
        "browser":    ["google-chrome", "firefox", "chromium"],
    }

    if IS_MAC:
        mac_name = MAC_APPS.get(app_name.lower(), app_name)
        try:
            subprocess.Popen(
                ["open", "-a", mac_name],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            return {"launched": app_name, "method": "macOS open", "app": mac_name}
        except Exception as e:
            raise RuntimeError(f"Could not launch '{app_name}': {e}")

    elif IS_LINUX:
        for cmd in LINUX_APPS.get(app_name.lower(), [app_name]):
            try:
                subprocess.Popen(
                    [cmd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
                return {"launched": app_name, "command": cmd}
            except FileNotFoundError:
                continue
        raise RuntimeError(f"Could not launch '{app_name}'. Is it installed?")

    elif IS_WINDOWS:
        WIN_APPS = {
            "chrome":     "chrome",
            "firefox":    "firefox",
            "code":       "code",
            "vscode":     "code",
            "notepad":    "notepad",
            "calculator": "calc",
            "browser":    "start",
        }
        cmd = WIN_APPS.get(app_name.lower(), app_name)
        try:
            subprocess.Popen(
                ["start", cmd], shell=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            return {"launched": app_name, "command": cmd}
        except Exception as e:
            raise RuntimeError(f"Could not launch '{app_name}': {e}")

    raise RuntimeError(f"Unsupported OS: {platform.system()}")


def h_close_app(app_name: str, **kw) -> dict:
    """Close an application. Works on macOS, Linux, and Windows."""
    if not app_name:
        raise ValueError("app_name is required.")

    blocked = {"bash", "python", "maya", "systemd", "kernel", "init",
               "launchd", "kernel_task", "WindowServer"}
    if app_name.lower() in {b.lower() for b in blocked}:
        raise SecurityError(f"Cannot close system process: '{app_name}'")

    if IS_MAC:
        MAC_APPS = {
            "chrome":   "Google Chrome",
            "firefox":  "Firefox",
            "code":     "Visual Studio Code",
            "vscode":   "Visual Studio Code",
            "notepad":  "TextEdit",
            "terminal": "Terminal",
            "safari":   "Safari",
            "spotify":  "Spotify",
            "slack":    "Slack",
            "zoom":     "zoom.us",
        }
        mac_name = MAC_APPS.get(app_name.lower(), app_name)
        # FIX: check returncode to detect "not running" vs actual error
        result = subprocess.run(
            ["osascript", "-e", f'quit app "{mac_name}"'],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            return {"closed": app_name, "method": "osascript", "app": mac_name}
        # osascript returns non-zero if app wasn't running
        logger.info(f"osascript quit failed (may not be running): {result.stderr.strip()}")
        # Try pkill as fallback
        pkill = subprocess.run(["pkill", "-x", mac_name], capture_output=True)
        if pkill.returncode == 0:
            return {"closed": app_name, "method": "pkill"}
        return {"closed": False, "message": f"'{app_name}' does not appear to be running."}

    elif IS_LINUX:
        result = subprocess.run(["pkill", "-f", app_name], capture_output=True)
        if result.returncode == 0:
            return {"closed": app_name}
        return {"closed": False, "message": f"'{app_name}' does not appear to be running."}

    elif IS_WINDOWS:
        result = subprocess.run(
            ["taskkill", "/IM", f"{app_name}.exe", "/F"], capture_output=True
        )
        if result.returncode == 0:
            return {"closed": app_name}
        return {"closed": False, "message": f"'{app_name}' does not appear to be running."}

    raise RuntimeError(f"Unsupported OS: {platform.system()}")


def h_running_processes(**kw) -> dict:
    """List running processes."""
    try:
        import psutil
        procs = [
            {"pid": p.pid, "name": p.name(), "status": p.status()}
            for p in psutil.process_iter(["pid", "name", "status"])
            if p.info["name"]
        ]
        return {"processes": procs[:30], "count": len(procs)}
    except ImportError:
        if IS_MAC or IS_LINUX:
            result = subprocess.run(["ps", "aux"], capture_output=True, text=True)
            lines = result.stdout.strip().split("\n")[1:31]
            return {"processes": lines, "count": len(lines),
                    "note": "install psutil for structured output"}
        return {"error": "psutil not installed. Run: pip install psutil"}


# ── System monitoring ─────────────────────────────────────────────────────────

def h_system_info(**kw) -> dict:
    """Get system CPU, RAM, disk, and battery info."""
    try:
        import psutil
        cpu  = psutil.cpu_percent(interval=0.5)
        mem  = psutil.virtual_memory()
        disk = psutil.disk_usage("/")
        batt = psutil.sensors_battery()
        return {
            # FIX: use platform.platform() for portability instead of mac_ver()
            "platform":          platform.platform(),
            "python":            platform.python_version(),
            "cpu_percent":       cpu,
            "cpu_cores":         psutil.cpu_count(logical=True),
            "cpu_physical_cores":psutil.cpu_count(logical=False),
            "ram_total_gb":      round(mem.total / 1e9, 2),
            "ram_used_gb":       round(mem.used  / 1e9, 2),
            "ram_percent":       mem.percent,
            "disk_total_gb":     round(disk.total / 1e9, 2),
            "disk_used_gb":      round(disk.used  / 1e9, 2),
            "disk_percent":      round(disk.percent, 1),
            "battery_percent":   round(batt.percent, 1) if batt else "N/A",
            "battery_plugged":   batt.power_plugged if batt else "N/A",
        }
    except ImportError:
        return {"error": "psutil not installed. Run: pip install psutil"}

def h_cpu_usage(**kw) -> dict:
    """Get CPU usage."""
    try:
        import psutil
        freq = psutil.cpu_freq()
        return {
            "cpu_percent":   psutil.cpu_percent(interval=0.5),
            "cores_logical": psutil.cpu_count(logical=True),
            "cores_physical":psutil.cpu_count(logical=False),
            "frequency_mhz": round(freq.current, 1) if freq else "N/A",
        }
    except ImportError:
        if IS_MAC or IS_LINUX:
            result = subprocess.run(["top", "-l", "1", "-n", "0"], capture_output=True, text=True)
            for line in result.stdout.split("\n"):
                if "CPU usage" in line or "Cpu(s)" in line:
                    return {"cpu_info": line.strip()}
        return {"error": "psutil not installed. Run: pip install psutil"}

def h_ram_usage(**kw) -> dict:
    """Get RAM usage."""
    try:
        import psutil
        m = psutil.virtual_memory()
        return {
            "total_gb":     round(m.total     / 1e9, 2),
            "used_gb":      round(m.used      / 1e9, 2),
            "available_gb": round(m.available / 1e9, 2),
            "percent":      m.percent,
        }
    except ImportError:
        return {"error": "psutil not installed. Run: pip install psutil"}

def h_disk_usage(**kw) -> dict:
    """Get disk usage."""
    try:
        import psutil
        d = psutil.disk_usage("/")
        return {
            "total_gb": round(d.total / 1e9, 2),
            "used_gb":  round(d.used  / 1e9, 2),
            "free_gb":  round(d.free  / 1e9, 2),
            "percent":  round(d.percent, 1),
        }
    except ImportError:
        result = subprocess.run(["df", "-h", "/"], capture_output=True, text=True)
        return {"disk_info": result.stdout.strip()}

def h_battery_status(**kw) -> dict:
    """Get battery status."""
    try:
        import psutil
        b = psutil.sensors_battery()
        if not b:
            if IS_MAC:
                result = subprocess.run(
                    ["pmset", "-g", "batt"], capture_output=True, text=True
                )
                return {"battery_info": result.stdout.strip()}
            return {"available": False, "message": "No battery detected (desktop computer?)"}
        secs = b.secsleft
        if secs in (-1, -2):
            time_left = "Calculating..." if b.power_plugged else "Unknown"
        else:
            h, m = divmod(secs // 60, 60)
            time_left = f"{h}h {m}m"
        return {
            "percent":     round(b.percent, 1),
            "plugged":     b.power_plugged,
            "time_left":   time_left,
        }
    except ImportError:
        if IS_MAC:
            result = subprocess.run(
                ["pmset", "-g", "batt"], capture_output=True, text=True
            )
            return {"battery_info": result.stdout.strip()}
        return {"error": "psutil not installed. Run: pip install psutil"}

def h_network_status(**kw) -> dict:
    """Check network/internet connectivity."""
    hosts = [("8.8.8.8", 53), ("1.1.1.1", 53)]
    results = {}
    for host, port in hosts:
        try:
            s = socket.socket()
            s.settimeout(3)
            s.connect((host, port))
            s.close()
            results[host] = "reachable"
        except Exception:
            results[host] = "unreachable"

    online = any(v == "reachable" for v in results.values())

    # FIX: correct platform branching for local IP detection
    local_ip = "unknown"
    try:
        if IS_MAC:
            r = subprocess.run(
                ["ipconfig", "getifaddr", "en0"], capture_output=True, text=True
            )
            local_ip = r.stdout.strip() or "not connected (en0)"
        else:
            # Works on Linux and Windows
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(1)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
    except Exception:
        pass

    return {"online": online, "local_ip": local_ip, "checks": results}


# ── Productivity — Reminders ──────────────────────────────────────────────────

def h_set_reminder(message: str, remind_at: str = "",
                   session_id: str = None, **kw) -> dict:
    """Create a reminder."""
    if not message:
        raise ValueError("message is required for set_reminder.")

    db = kw.get("_db")
    if db:
        rid = db.reminder_repo.add(message, remind_at, session_id)
        return {"id": rid, "message": message,
                "remind_at": remind_at or "no time set", "saved_to": "database"}

    # JSON fallback — FIX: use absolute path; atomic write
    items = _read_json(_REMINDERS_JSON)
    new_id = max((i.get("id", 0) for i in items), default=0) + 1
    new = {
        "id":         new_id,
        "message":    message,
        "remind_at":  remind_at,
        "created":    datetime.now().isoformat(),
        "done":       False,
        "session_id": session_id,
    }
    items.append(new)
    _write_json(_REMINDERS_JSON, items)
    return {**new, "saved_to": "json_fallback"}


def h_list_reminders(session_id: str = None, **kw) -> dict:
    """List active reminders."""
    db = kw.get("_db")
    if db:
        items = db.reminder_repo.list_active()
        return {"reminders": items, "count": len(items), "source": "database"}

    # JSON fallback — FIX: normalize schema to match SQLite output
    items = _read_json(_REMINDERS_JSON)
    active = [
        {
            "id":        i.get("id"),
            "message":   i.get("message", ""),
            "remind_at": i.get("remind_at", ""),
            "created":   i.get("created", ""),
            "done":      i.get("done", False),
        }
        for i in items if not i.get("done")
    ]
    return {"reminders": active, "count": len(active), "source": "json_fallback"}


def h_delete_reminder(reminder_id: int = 0, **kw) -> dict:
    """Delete a reminder by ID."""
    # FIX: treat id=0 as missing rather than silently doing nothing
    if not reminder_id:
        raise ValueError(
            "reminder_id is required. "
            "Use 'list reminders' to see IDs, then say 'delete reminder #N'."
        )

    db = kw.get("_db")
    if db:
        db.reminder_repo.delete(reminder_id)
        return {"deleted_id": reminder_id, "source": "database"}

    # JSON fallback — FIX: atomic write
    items = _read_json(_REMINDERS_JSON)
    before = len(items)
    items = [i for i in items if i.get("id") != reminder_id]
    if len(items) == before:
        raise ValueError(f"Reminder #{reminder_id} not found.")
    _write_json(_REMINDERS_JSON, items)
    return {"deleted_id": reminder_id, "source": "json_fallback"}


# ── Productivity — Notes ──────────────────────────────────────────────────────

def h_create_note(title: str, content: str, session_id: str = None, **kw) -> dict:
    """Create a note."""
    if not content:
        raise ValueError("content is required for create_note.")

    db = kw.get("_db")
    if db:
        nid = db.note_repo.create(title, content, session_id)
        return {"id": nid, "title": title,
                "preview": content[:120], "saved_to": "database"}

    # FIX: was silently discarding data — now saves to JSON
    items = _read_json(_NOTES_JSON)
    new_id = max((i.get("id", 0) for i in items), default=0) + 1
    new = {
        "id":         new_id,
        "title":      title or "Note",
        "content":    content,
        "created":    datetime.now().isoformat(),
        "session_id": session_id,
    }
    items.append(new)
    _write_json(_NOTES_JSON, items)
    return {"id": new_id, "title": new["title"],
            "preview": content[:120], "saved_to": "json_fallback"}


def h_show_notes(**kw) -> dict:
    """List all notes."""
    db = kw.get("_db")
    if db:
        notes = db.note_repo.list_all()
        return {"notes": notes, "count": len(notes), "source": "database"}

    # FIX: was returning empty list — now reads from JSON
    items = _read_json(_NOTES_JSON)
    return {"notes": items, "count": len(items), "source": "json_fallback"}


def h_delete_note(note_id: int = 0, **kw) -> dict:
    """Delete a note by ID."""
    if not note_id:
        raise ValueError(
            "note_id is required. "
            "Use 'show notes' to see IDs, then say 'delete note #N'."
        )

    db = kw.get("_db")
    if db:
        db.note_repo.delete(note_id)
        return {"deleted_id": note_id, "source": "database"}

    # FIX: was stub — now deletes from JSON
    items = _read_json(_NOTES_JSON)
    before = len(items)
    items = [i for i in items if i.get("id") != note_id]
    if len(items) == before:
        raise ValueError(f"Note #{note_id} not found.")
    _write_json(_NOTES_JSON, items)
    return {"deleted_id": note_id, "source": "json_fallback"}


# ── Productivity — Timer ──────────────────────────────────────────────────────

_active_timers: Dict[str, dict] = {}
_timers_lock = threading.Lock()


def h_start_timer(seconds: int = 0, label: str = "Timer",
                  needs_duration: bool = False, **kw) -> dict:
    """Start a countdown timer. On Mac shows a notification when done."""
    # FIX: return guidance if registry couldn't extract a duration
    if needs_duration or not seconds:
        return {
            "success": False,
            "message": "How long should the timer run? "
                       "Try: 'start a 5 minute timer' or 'timer for 30 seconds'.",
        }

    def _ring(tid: str):
        time.sleep(seconds)
        logger.info(f"⏰ Timer done: {label}")
        if IS_MAC:
            try:
                subprocess.run([
                    "osascript", "-e",
                    f'display notification "Timer done: {label}" with title "Maya ⏰"'
                ], capture_output=True)
            except Exception:
                pass
        # FIX: remove from active timers dict after completion to prevent memory leak
        with _timers_lock:
            _active_timers.pop(tid, None)

    tid = f"timer_{int(time.time() * 1000)}"
    t = threading.Thread(target=_ring, args=(tid,), daemon=True)
    t.start()
    with _timers_lock:
        _active_timers[tid] = {
            "label":   label,
            "seconds": seconds,
            "started": datetime.now().isoformat(),
        }
    return {
        "timer_id": tid,
        "label":    label,
        "seconds":  seconds,
        "message":  f"Timer '{label}' started for {seconds} second(s).",
    }


# ── Utility ───────────────────────────────────────────────────────────────────

def h_calculator(expression: str, **kw) -> dict:
    """Evaluate a mathematical expression safely."""
    if not expression:
        raise ValueError("expression is required.")
    result = safe_calc(expression)
    return {"expression": expression, "result": result}


def h_unit_conversion(value: float = 0, from_unit: str = "",
                      to_unit: str = "", **kw) -> dict:
    """Convert between units."""
    if not from_unit or not to_unit:
        raise ValueError("from_unit and to_unit are required.")
    return convert_unit(value, from_unit, to_unit)


def h_datetime_now(**kw) -> dict:
    """Get the current date and time."""
    now = datetime.now()
    return {
        "date":     now.strftime("%A, %d %B %Y"),
        "time":     now.strftime("%I:%M:%S %p"),
        "iso":      now.isoformat(),
        "day":      now.strftime("%A"),
        "timezone": time.tzname[0],
    }


def h_export_chat(session_id: str = "", messages: list = None, **kw) -> dict:
    """Export the conversation to a text file."""
    msgs = messages or []

    # FIX: warn and return early if there's nothing to export
    if not msgs:
        return {
            "success": False,
            "message": "No messages to export. The conversation is empty.",
        }

    lines = [f"=== Maya Conversation Export ===\nSession: {session_id}\nExported: {datetime.now().isoformat()}\n"]
    for m in msgs:
        lines.append(
            f"[{m.get('timestamp', '')}] {m.get('role', '?').upper()}:\n"
            f"{m.get('content', '')}\n{'─' * 50}"
        )
    text = "\n".join(lines)

    fname = f"export_{(session_id or 'session')[:8]}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    path  = _safe_path(fname)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)

    if IS_MAC:
        try:
            subprocess.run(["open", "-R", path], capture_output=True)
        except Exception:
            pass

    return {
        "exported_to":   fname,
        "path":          path,
        "message_count": len(msgs),
    }


def h_session_stats(session_id: str = "", **kw) -> dict:
    """Return message count stats for a session."""
    db = kw.get("_db")
    if db:
        msgs = db.message_repo.get_all(session_id)
        return {
            "session_id":         session_id,
            "total_messages":     len(msgs),
            "user_messages":      sum(1 for m in msgs if m["role"] == "user"),
            "assistant_messages": sum(1 for m in msgs if m["role"] == "assistant"),
        }
    return {"message": "Session stats unavailable without database connection."}


def h_reset_memory(session_id: str = "", **kw) -> dict:
    """
    Signal to reset/clear the conversation memory for this session.
    FIX: this handler was missing — registry detected the intent but executor
         had no handler, causing 'No handler for: reset_memory' error.
    Actual clearing is done by the caller (main.py) using the session_id.
    """
    return {
        "action":     "reset_memory",
        "session_id": session_id,
        "message":    "Memory reset signal sent. The conversation history will be cleared.",
    }


# ── macOS-specific tools ──────────────────────────────────────────────────────

def h_mac_notification(title: str = "Maya", message: str = "", **kw) -> dict:
    """Send a macOS desktop notification."""
    if not IS_MAC:
        return {"success": False, "message": "Desktop notifications via osascript are macOS-only."}
    if not message:
        raise ValueError("message is required for mac_notification.")
    # Sanitize for osascript injection
    title   = title.replace('"', "'")
    message = message.replace('"', "'")
    try:
        subprocess.run([
            "osascript", "-e",
            f'display notification "{message}" with title "{title}"'
        ], capture_output=True, check=True)
        return {"sent": True, "title": title, "message": message}
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"osascript notification failed: {e.stderr}")


def h_mac_volume(level: int = None, **kw) -> dict:
    """Get or set Mac system volume (0–100)."""
    if not IS_MAC:
        return {"success": False, "message": "Volume control via osascript is macOS-only."}
    if level is not None:
        level = max(0, min(100, int(level)))
        subprocess.run(
            ["osascript", "-e", f"set volume output volume {level}"],
            capture_output=True, check=True
        )
        return {"volume_set": level}
    result = subprocess.run(
        ["osascript", "-e", "output volume of (get volume settings)"],
        capture_output=True, text=True
    )
    return {"current_volume": result.stdout.strip()}


def h_mac_brightness(level: int = None, **kw) -> dict:
    """Get or set Mac screen brightness (0–100). Requires: brew install brightness"""
    if not IS_MAC:
        return {"success": False, "message": "Brightness control is macOS-only."}
    try:
        if level is not None:
            level_f = max(0.0, min(1.0, int(level) / 100))
            subprocess.run(["brightness", str(level_f)], capture_output=True, check=True)
            return {"brightness_set": level}
        result = subprocess.run(["brightness", "-l"], capture_output=True, text=True)
        return {"brightness_info": result.stdout.strip()}
    except FileNotFoundError:
        return {
            "success": False,
            "message": "The 'brightness' CLI tool is not installed. "
                       "Install it with: brew install brightness",
        }


def h_mac_screenshot(save_to: str = "desktop", filename: str = "", **kw) -> dict:
    """Take a screenshot on macOS. save_to: desktop | downloads | sandbox."""
    if not IS_MAC:
        return {"success": False, "message": "screencapture is macOS-only."}

    # ── Resolve destination directory ─────────────────────────────────────
    home = os.path.expanduser("~")
    DEST_MAP = {
        # Map "desktop" to the dedicated Maya Files folder!
        "desktop":   os.path.join(home, "Desktop", "Maya Files"),
        "downloads": os.path.join(home, "Downloads"),
        "sandbox":   SANDBOX,
    }
    dest_dir = DEST_MAP.get(save_to.lower(), DEST_MAP["desktop"])
    os.makedirs(dest_dir, exist_ok=True)

    # ── Build filename ────────────────────────────────────────────────────
    if filename:
        # Ensure .png extension
        if not filename.lower().endswith(".png"):
            filename = filename + ".png"
        # Sanitize
        filename = re.sub(r"[^\w\.\-]", "_", filename)
    else:
        filename = f"screenshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"

    # ── Security: only allow writing inside known safe dirs ───────────────
    full_path = os.path.join(dest_dir, os.path.basename(filename))
    allowed_roots = list(DEST_MAP.values())
    if not any(os.path.abspath(full_path).startswith(r) for r in allowed_roots):
        raise SecurityError("Screenshot destination is outside allowed directories.")

    # ── Run screencapture ─────────────────────────────────────────────────
    try:
        result = subprocess.run(
            ["screencapture", "-x", full_path],
            capture_output=True
        )
        if result.returncode != 0:
            err_msg = result.stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(
                f"screencapture exited with code {result.returncode}. "
                f"{err_msg if err_msg else 'Check screen recording permission in System Settings → Privacy & Security → Screen Recording'}."
            )
        # Open the destination folder in Finder so user can see the file
        subprocess.run(["open", "-R", full_path], capture_output=True)
        
        display_dest = "Maya Files" if save_to.lower() == "desktop" else save_to.capitalize()
        
        return {
            "saved":       filename,
            "path":        full_path,
            "destination": dest_dir,
            "message":     f"Screenshot saved to {display_dest}: {filename}",
        }
    except FileNotFoundError:
        raise RuntimeError(
            "screencapture command not found. This should not happen on macOS — "
            "please check your system integrity."
        )


# ── Handler Map ───────────────────────────────────────────────────────────────

HANDLERS: Dict[str, callable] = {
    # File system
    "create_file":       h_create_file,
    "read_file":         h_read_file,
    "delete_file":       h_delete_file,
    "rename_file":       h_rename_file,
    "list_directory":    h_list_directory,
    "search_files":      h_search_files,
    "move_file":         h_move_file,
    "file_metadata":     h_file_metadata,
    # App control
    "open_app":          h_open_app,
    "close_app":         h_close_app,
    "running_processes": h_running_processes,
    # System monitoring
    "system_info":       h_system_info,
    "cpu_usage":         h_cpu_usage,
    "ram_usage":         h_ram_usage,
    "disk_usage":        h_disk_usage,
    "battery_status":    h_battery_status,
    "network_status":    h_network_status,
    # Productivity
    "set_reminder":      h_set_reminder,
    "list_reminders":    h_list_reminders,
    "delete_reminder":   h_delete_reminder,
    "create_note":       h_create_note,
    "show_notes":        h_show_notes,
    "delete_note":       h_delete_note,
    "start_timer":       h_start_timer,
    # Utility
    "calculator":        h_calculator,
    "unit_conversion":   h_unit_conversion,
    "datetime_now":      h_datetime_now,
    # Session
    "export_chat":       h_export_chat,
    "session_stats":     h_session_stats,
    "reset_memory":      h_reset_memory,   # FIX: was missing — caused crash
    # macOS-specific
    "mac_notification":  h_mac_notification,
    "mac_volume":        h_mac_volume,
    "mac_brightness":    h_mac_brightness,
    "mac_screenshot":    h_mac_screenshot,
}


class ToolExecutor:
    def __init__(self, db=None):
        self.db = db

    def execute(self, tool_name: str, params: dict,
                session_id: str = None) -> ToolResult:
        handler = HANDLERS.get(tool_name)
        if not handler:
            return ToolResult(
                tool_name, False, None,
                f"No handler registered for tool: '{tool_name}'"
            )

        t0 = time.perf_counter()
        try:
            output   = handler(session_id=session_id, _db=self.db, **params)
            exec_ms  = (time.perf_counter() - t0) * 1000
            logger.info(f"Tool '{tool_name}' OK | {exec_ms:.0f}ms")
            return ToolResult(tool_name, True, output, exec_ms=exec_ms)

        except SecurityError as e:
            exec_ms = (time.perf_counter() - t0) * 1000
            logger.warning(f"Security violation in '{tool_name}': {e}")
            return ToolResult(tool_name, False, None, f"Security error: {e}", exec_ms)

        except (ValueError, FileNotFoundError) as e:
            exec_ms = (time.perf_counter() - t0) * 1000
            logger.warning(f"Tool '{tool_name}' bad input: {e}")
            return ToolResult(tool_name, False, None, str(e), exec_ms)

        except Exception as e:
            exec_ms = (time.perf_counter() - t0) * 1000
            logger.error(f"Tool '{tool_name}' unexpected error: {e}", exc_info=True)
            return ToolResult(tool_name, False, None, str(e), exec_ms)


def build_registry(db=None) -> tuple:
    registry = ToolRegistry()
    executor = ToolExecutor(db=db)
    for name, handler in HANDLERS.items():
        registry.register(ToolDefinition(
            name=name,
            description=handler.__doc__ or name,
            parameters={},
            keywords=[name.replace("_", " ")],
        ))
    return registry, executor
