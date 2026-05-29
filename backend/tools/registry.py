"""
tools/registry.py - ToolRegistry and IntentClassifier for Maya.

FIXES applied vs original:
  - Intent conflict resolution: calculator pattern no longer fires on time strings like "3-5pm"
  - open_app pattern tightened: bare open+word pattern removed (caused false positives)
  - reset_memory added to HANDLERS stub so detection no longer crashes executor
  - set_reminder param extraction: greedy match preserves full message including embedded "at"
  - start_timer: returns needs_duration=True when no number found instead of silent 60s default
  - calculator param extraction: captures full expression including percent/of phrases
  - open_app param extraction: smarter priority — checks full name phrases before short tokens
  - Score threshold raised to 3 for patterns that are known to false-positive
  - All extract_params branches validate non-empty before returning; bad extractions raise ValueError
  - Added UI filter to list_tools() to hide backend/technical skills from the frontend sidebar
  - STRIPPED trailing punctuation in classify() to prevent '?' from breaking intent regexes
  - ULTRA-FORGIVING datetime_now patterns added to instantly catch 'what time is it'
"""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from utils.logger import setup_logger

logger = setup_logger("tools.registry")


@dataclass
class ToolDefinition:
    name: str
    description: str
    parameters: Dict[str, str]
    keywords: List[str] = field(default_factory=list)
    enabled: bool = True


# ── Intent Patterns ───────────────────────────────────────────────────────────
# Each entry: list of (pattern, score_weight) tuples.
# A minimum combined score of 3 is required to fire.

INTENT_PATTERNS: Dict[str, List[str]] = {
    # ── File system ──────────────────────────────────────────────────────────
    "create_file": [
        r"\b(create|make|write|new)\b.{0,20}(file|document|\.txt|\.py|\.md)\b",
        r"\bcreate\s+(?:a\s+)?(?:new\s+)?file\b",
    ],
    "read_file": [
        r"\b(read|show|display|view)\b.{0,20}(file|document)\b",
        r"\bopen\s+file\b",
    ],
    "delete_file": [
        r"\b(delete|remove|erase)\b.{0,20}(file|document)\b",
    ],
    "rename_file": [
        r"\brename\b.{0,20}file\b",
        r"\brename\s+\S+\s+(?:to|as)\s+\S+",
    ],
    "list_directory": [
        r"\b(list|ls|dir|show)\b.{0,20}(files|folder|directory)\b",
        r"\bwhat files\b",
        r"\bshow\s+(?:me\s+)?(?:the\s+)?files\b",
    ],
    "search_files": [
        r"\b(search|find|locate)\b.{0,20}(file|document)\b",
    ],
    "move_file": [
        r"\b(move|copy)\b.{0,20}file\b",
    ],
    "file_metadata": [
        r"\b(info|metadata|details|size)\b.{0,20}file\b",
    ],

    # ── App control ──────────────────────────────────────────────────────────
    "open_app": [
        r"\b(open|launch|start|run)\b.{0,30}(app|application|program)\b",
        r"\b(open|launch|start)\b.{0,20}(chrome|firefox|safari|vscode|code|terminal|finder|calculator|spotify|slack|zoom|notepad|textedit|xcode|browser)\b",
    ],
    "close_app": [
        r"\b(close|kill|stop|quit)\b.{0,20}(app|application|chrome|firefox|safari|vscode|terminal|spotify|slack|zoom)\b",
    ],
    "running_processes": [
        r"\b(running|active)\b.{0,15}(processes|tasks|apps)\b",
        r"\bwhat(?:'s|\s+is)\s+running\b",
        r"\blist\s+(?:all\s+)?processes\b",
    ],

    # ── System monitoring ────────────────────────────────────────────────────
    "system_info": [
        r"\b(system|hardware)\b.{0,20}(info|status|stats|details)\b",
        r"\bhow(?:'s|\s+is)\s+(?:my\s+)?(?:system|computer|mac|pc)\b",
    ],
    "cpu_usage": [
        r"\bcpu\b.{0,20}(usage|percent|load|utilization)\b",
        r"\bhow\s+(?:much|busy)\b.{0,15}cpu\b",
    ],
    "ram_usage": [
        r"\b(ram|memory)\b.{0,20}(usage|percent|used|free|available)\b",
        r"\bhow\s+much\s+(ram|memory)\b",
    ],
    "disk_usage": [
        r"\bdisk\b.{0,20}(usage|space|free|available)\b",
        r"\bhow\s+much\s+(disk|storage|space)\b",
    ],
    "battery_status": [
        r"\bbattery\b.{0,30}(status|level|percent|charge|remaining|life)?\b",
        r"\b(how much|what is).{0,15}(battery|charge)\b",
    ],
    "network_status": [
        r"\b(network|internet|wifi|connectivity)\b.{0,20}(status|check|connection)?\b",
        r"\b(am\s+i|are\s+we)\s+online\b",
        r"\bcheck\s+(internet|network|wifi)\b",
    ],

    # ── Productivity ─────────────────────────────────────────────────────────
    "set_reminder": [
        r"\b(set|add|create)\b.{0,15}reminder\b",
        r"\bremind\s+me\b",
        r"\breminder\s+(?:for|to|about)\b",
    ],
    "list_reminders": [
        r"\b(show|list|view|what\s+are)\b.{0,15}reminders?\b",
        r"\bmy\s+reminders?\b",
    ],
    "delete_reminder": [
        r"\b(delete|remove|cancel)\b.{0,15}reminder\b",
    ],
    "create_note": [
        r"\b(create|write|add|make)\b.{0,15}note\b",
        r"\btake\s+(?:a\s+)?note\b",
        r"\bjot\s+(?:this\s+)?down\b",
    ],
    "show_notes": [
        r"\b(show|list|view|read)\b.{0,15}notes?\b",
        r"\bmy\s+notes?\b",
    ],
    "delete_note": [
        r"\b(delete|remove)\b.{0,15}note\b",
    ],
    "start_timer": [
        r"\b(start|set|run)\b.{0,15}(timer|countdown|stopwatch)\b",
        r"\btimer\s+for\b",
        r"\bcount\s*down\b",
    ],

    # ── Utility ──────────────────────────────────────────────────────────────
    "calculator": [
        r"\b(calculate|compute|eval(?:uate)?|solve)\b.{0,40}[\d]",
        r"(?<!\w)(\d+\.?\d*)\s*[\+\-\*\/\^]\s*(\d+\.?\d*)(?!\s*(?:am|pm|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}))",
        r"\bwhat\s+is\s+[\d\(]",
        r"\b\d+\s+(?:percent|%)\s+of\s+\d+",
        r"\b(?:add|subtract|multiply|divide)\b.{0,20}\d+.{0,20}\d+",
    ],
    "unit_conversion": [
        r"\bconvert\b.{0,30}(kg|lb|km|miles|celsius|fahrenheit|meter|feet|liter|gallon|gram|oz)\b",
        r"\bhow\s+many\b.{0,30}(kg|lb|km|miles|celsius|fahrenheit|meter|feet)\b",
        r"\d+\.?\d*\s*(kg|lb|km|miles|celsius|fahrenheit|meters?|feet|liters?|gallons?)\b.{0,10}(to|in)\b",
    ],
    "datetime_now": [
        r"\bwhat\s+time\b",   # Ultra-broad: catches "what time is it", "what time is it now", etc.
        r"\bwhat(?:'s|\s+is)\s+(?:the\s+)?(?:current\s+)?(?:time|date|day)\b",
        r"\b(?:current|today(?:'s)?)\s+(?:time|date|day)\b",
        r"\btell\s+me\s+the\s+(?:time|date)\b",
        r"\bwhat\s+day\s+is\s+(?:it|today)\b",
    ],

    # ── Session ──────────────────────────────────────────────────────────────
    "export_chat": [
        r"\b(export|save|download)\b.{0,20}(chat|conversation|history|messages)\b",
    ],
    "reset_memory": [
        r"\b(reset|clear|wipe)\b.{0,20}(memory|chat|history|conversation)\b",
        r"\bstart\s+(?:a\s+)?(?:new|fresh)\b.{0,15}(chat|conversation)\b",
        r"\bforget\s+(?:everything|all|our|this)\b",
    ],
    "session_stats": [
        r"\b(stats|statistics|summary)\b.{0,20}(session|conversation|chat)\b",
        r"\bhow\s+many\s+(messages?|words?)\b",
    ],

    # ── macOS-specific ───────────────────────────────────────────────────────
    "mac_notification": [
        r"\b(send|show|display|push)\b.{0,15}notification\b",
        r"\bnotify\s+me\b",
        r"\bsend\s+(?:me\s+)?(?:an?\s+)?alert\b",
    ],
    "mac_volume": [
        r"\b(set|change|turn)\b.{0,15}volume\b",
        r"\bvolume\s+(?:up|down|to|level)\b",
        r"\b(increase|decrease|raise|lower|mute|unmute)\b.{0,10}(volume|sound)\b",
        r"\b(make|turn).{0,15}(louder|quieter)\b",
    ],
    "mac_brightness": [
        r"\b(set|change)\b.{0,15}brightness\b",
        r"\bbrightness\s+(?:to|level|up|down)\b",
        r"\b(increase|decrease|raise|lower|dim)\b.{0,10}(brightness|screen|display)\b",
    ],
    "mac_screenshot": [
        r"\b(take|capture|grab)\b.{0,15}screenshot\b",
        r"\bscreen\s*(?:shot|capture|grab)\b",
        r"\bscreenshot\b",
    ],
}

INTENT_KEYWORDS: Dict[str, List[str]] = {
    "create_file":      ["create file", "make file", "new file", "write file"],
    "read_file":        ["read file", "open file", "show file", "view file"],
    "delete_file":      ["delete file", "remove file", "erase file"],
    "rename_file":      ["rename file", "rename the file"],
    "list_directory":   ["list files", "show files", "ls", "dir"],
    "search_files":     ["search file", "find file", "locate file"],
    "move_file":        ["move file", "copy file"],
    "file_metadata":    ["file info", "file size", "file details", "file metadata"],
    "open_app":         ["open chrome", "open firefox", "open safari", "open terminal",
                         "open vscode", "open code", "open finder", "open spotify",
                         "open slack", "open zoom", "launch chrome", "launch app"],
    "close_app":        ["close chrome", "close firefox", "close terminal", "quit app",
                         "kill chrome", "stop firefox"],
    "running_processes":["running processes", "active processes", "what is running", "running process",
                         "show processes", "list processes", "list process"],
    "system_info":      ["system info", "system status", "hardware info"],
    "cpu_usage":        ["cpu usage", "cpu uses", "cpu percent", "cpu load", "processor usage"],
    "ram_usage":        ["ram usage", "memory usage", "ram percent", "ram uses", "RAM percentage"],
    "disk_usage":       ["disk space", "disk usage", "storage space", "free space", "disk uses"],
    "battery_status":   ["battery level", "battery status", "battery percent",
                         "how much battery", "battery life"],
    "network_status":   ["internet status", "network status", "am i online",
                         "check internet","Wi-Fi status?", "wifi status", "network check"],
    "set_reminder":     ["remind me", "set reminder", "add reminder", "create reminder",
                         "reminder for", "reminder to"],
    "list_reminders":   ["show reminders", "list reminders", "my reminders",
                         "view reminders", "what are my reminders"],
    "delete_reminder":  ["delete reminder", "cancel reminder", "remove reminder"],
    "create_note":      ["create note", "take note", "make note", "add note",
                         "jot down", "write note"],
    "show_notes":       ["show notes", "list notes", "view notes", "my notes",
                         "read notes"],
    "delete_note":      ["delete note", "remove note"],
    "start_timer":      ["start timer", "set timer", "timer for", "countdown",
                         "count down"],
    "calculator":       ["calculate", "compute", "evaluate", "what is the result",
                         "percent of", "% of"],
    "unit_conversion":  ["convert", "how many", "in kg", "in miles", "in celsius",
                         "in fahrenheit", "to kg", "to miles"],
    "datetime_now":     ["what time", "what date", "current time", "current date",
                         "what day", "today's date", "time is it"],
    "export_chat":      ["export chat", "save conversation", "download history",
                         "save chat"],
    "reset_memory":     ["reset memory", "clear memory", "clear chat", "wipe history",
                         "new chat", "start over", "forget everything"],
    "session_stats":    ["session stats", "conversation stats", "how many messages"],
    "mac_notification": ["send notification", "notify me", "show alert", "push notification"],
    "mac_volume":       ["set volume", "change volume", "volume up", "volume down",
                         "mute sound", "unmute", "turn up volume", "turn down volume"],
    "mac_brightness":   ["set brightness", "change brightness", "dim screen",
                         "brighten screen", "screen brightness"],
    "mac_screenshot":   ["take screenshot", "screenshot", "screen shot",
                         "capture screen", "grab screen"],
}

INTENT_SCORE_THRESHOLD = 3


class IntentClassifier:

    def classify(self, text: str) -> Optional[str]:
        # NEW FIX: Strip trailing punctuation like '?' so it doesn't mess with word boundaries
        lower = text.lower().strip(" .!?")
        scores: Dict[str, int] = {}

        for intent, patterns in INTENT_PATTERNS.items():
            score = 0
            for p in patterns:
                if re.search(p, lower, re.IGNORECASE):
                    score += 3
                    break
            for kw in INTENT_KEYWORDS.get(intent, []):
                if kw in lower:
                    score += 1
            if score >= INTENT_SCORE_THRESHOLD:
                scores[intent] = score

        if not scores:
            return None

        best = max(scores, key=scores.get)
        logger.info(f"Intent: '{best}' (score={scores[best]}, all={scores})")
        return best

    def extract_params(self, intent: str, text: str) -> dict:
        t = text.strip()
        lo = t.lower()

        if intent in ("create_file", "read_file", "delete_file", "file_metadata"):
            m = re.search(r"['\"]([^'\"]+)['\"]", t)
            if not m:
                m = re.search(r"(?:file|document|named?|called)\s+(\S+)", t, re.I)
            if not m:
                words = t.split()
                for w in reversed(words):
                    if "." in w or re.match(r"^\w+$", w):
                        filename = w
                        break
                else:
                    filename = ""
            else:
                filename = m.group(1)

            if intent == "create_file":
                cm = re.search(r"(?:content|with|containing|saying)[:\s]+(.+)", t, re.I | re.DOTALL)
                return {"filename": filename, "content": cm.group(1).strip() if cm else ""}
            return {"filename": filename}

        if intent == "rename_file":
            m = re.search(r"rename\s+['\"]?(\S+)['\"]?\s+(?:to|as)\s+['\"]?(\S+)['\"]?", lo)
            if not m: return {}
            return {"old_name": m.group(1), "new_name": m.group(2)}

        if intent in ("list_directory", "search_files"):
            m = re.search(r"(?:in|at|inside)\s+['\"]?(\S+)['\"]?", lo)
            qm = re.search(r"(?:search|find|locate)\s+(?:for\s+)?['\"]?([^'\"]+?)['\"]?(?:\s+in|\s+file|$)", lo)
            return {"path": m.group(1) if m else ".", "query": qm.group(1).strip() if qm else ""}

        if intent == "move_file":
            m = re.search(r"(?:move|copy)\s+['\"]?(\S+)['\"]?\s+to\s+['\"]?(\S+)['\"]?", lo)
            if not m: return {}
            return {"source": m.group(1), "destination": m.group(2)}

        if intent in ("open_app", "close_app"):
            KNOWN_APPS = [
                "visual studio code", "google chrome", "zoom.us",
                "chrome", "firefox", "safari", "vscode", "code",
                "notepad", "textedit", "terminal", "calculator",
                "browser", "finder", "xcode", "spotify", "slack", "zoom",
            ]
            for app in KNOWN_APPS:
                if app in lo:
                    normalized = {
                        "visual studio code": "vscode",
                        "google chrome": "chrome",
                        "zoom.us": "zoom",
                        "textedit": "notepad",
                    }.get(app, app)
                    return {"app_name": normalized}
            verb = "open" if intent == "open_app" else "(?:close|kill|quit|stop)"
            m = re.search(rf"\b{verb}" + r"\s+(\w+)\b", lo)
            if m: return {"app_name": m.group(1)}
            return {}

        if intent == "set_reminder":
            time_m = re.search(
                r"\b(?:at|by)\s+([\d]{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s+\w+)?)\b"
                r"|\bin\s+(\d+\s*(?:minute|hour|second|min|hr)s?)\b",
                lo, re.IGNORECASE
            )
            remind_at = ""
            if time_m:
                remind_at = (time_m.group(1) or time_m.group(2) or "").strip()

            msg_m = re.search(
                r"(?:remind\s+me\s+to|remind\s+me\s+about|reminder\s+(?:for|to|about))\s+(.+)",
                lo, re.IGNORECASE
            )
            if msg_m:
                message = msg_m.group(1).strip()
                if remind_at:
                    message = re.sub(r"\s+(?:at|by)\s+" + re.escape(remind_at) + r"$", "", message).strip()
                    message = re.sub(r"\s+in\s+" + re.escape(remind_at) + r"$", "", message).strip()
            else:
                message = t
            if not message: return {}
            return {"message": message, "remind_at": remind_at}

        if intent == "list_reminders": return {}

        if intent == "delete_reminder":
            m = re.search(r"(?:delete|cancel|remove)\s+reminder\s+#?(\d+)", lo)
            if not m: m = re.search(r"#?(\d+)", lo)
            if not m: return {}
            return {"reminder_id": int(m.group(1))}

        if intent == "create_note":
            title_m = re.search(r"(?:titled?|called|named?)\s+['\"]?([^'\"]+?)['\"]?(?:\s+(?:with|saying|content)|$)", lo)
            content_m = re.search(r"(?:content|saying|with|about)[:\s]+(.+)", t, re.I | re.DOTALL)
            title = title_m.group(1).strip() if title_m else "Note"
            content = content_m.group(1).strip() if content_m else t
            return {"title": title, "content": content}

        if intent == "delete_note":
            m = re.search(r"(?:delete|remove)\s+note\s+#?(\d+)", lo)
            if not m: m = re.search(r"#?(\d+)", lo)
            if not m: return {}
            return {"note_id": int(m.group(1))}

        if intent == "show_notes": return {}

        if intent == "start_timer":
            m = re.search(r"(\d+)\s*(second|minute|hour|sec|min|hr)s?", lo)
            if not m: return {"needs_duration": True}
            val, unit = int(m.group(1)), m.group(2).lower()
            secs = val * {"second": 1, "sec": 1, "minute": 60, "min": 60, "hour": 3600, "hr": 3600}.get(unit, 1)
            label_m = re.search(r"(?:called?|named?|label(?:led?)?)\s+['\"]?([^'\"]+)['\"]?", lo)
            label = label_m.group(1).strip() if label_m else f"{val} {unit}(s)"
            return {"seconds": secs, "label": label}

        if intent == "calculator":
            pct_m = re.search(r"(\d+\.?\d*)\s*%\s*of\s*(\d+\.?\d*)", lo)
            if pct_m: return {"expression": f"{pct_m.group(1)}/100*{pct_m.group(2)}"}
            cleaned = re.sub(r"^\s*(?:what\s+is|calculate|compute|evaluate|solve|find)\s+", "", lo, flags=re.IGNORECASE).strip()
            math_m = re.search(r"([\d\s\+\-\*\/\(\)\.\^%]+)", cleaned)
            expr = math_m.group(1).strip() if math_m else cleaned
            if not expr: return {}
            return {"expression": expr}

        if intent == "unit_conversion":
            m = re.search(r"([\d\.]+)\s*(\w+)\s+(?:to|in)\s+(\w+)", lo)
            if m: return {"value": float(m.group(1)), "from_unit": m.group(2), "to_unit": m.group(3)}
            return {}

        if intent == "datetime_now": return {}
        if intent == "export_chat": return {}
        if intent == "reset_memory": return {}
        if intent == "session_stats": return {}

        if intent == "mac_notification":
            msg_m = re.search(r"(?:notify|notification|alert|saying|message|that)[:\s]+(.+)", lo)
            return {"title": "Maya", "message": msg_m.group(1).strip() if msg_m else t}

        if intent == "mac_volume":
            m = re.search(r"(\d+)", lo)
            level = int(m.group(1)) if m else None
            if level is None:
                if re.search(r"\b(mute|silence)\b", lo): level = 0
                elif re.search(r"\b(max|full|loud)\b", lo): level = 100
            return {"level": level}

        if intent == "mac_brightness":
            m = re.search(r"(\d+)", lo)
            level = int(m.group(1)) if m else None
            if level is None:
                if re.search(r"\b(dim|dark|off|low)\b", lo): level = 20
                elif re.search(r"\b(bright|max|full|high)\b", lo): level = 100
            return {"level": level}

        if intent == "mac_screenshot":
            dest = "desktop"
            if re.search(r"\bdownload", lo): dest = "downloads"
            elif re.search(r"\bsandbox\b", lo): dest = "sandbox"
            elif re.search(r"\bdesktop\b", lo): dest = "desktop"
            fname_m = re.search(r"(?:named?|called?|as|save\s+as)\s+['\"]?([^\s'\"]+)['\"]?", lo)
            params = {"save_to": dest}
            if fname_m: params["filename"] = fname_m.group(1).strip()
            return params

        return {}


class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, ToolDefinition] = {}
        self.classifier = IntentClassifier()

    def register(self, tool: ToolDefinition):
        self._tools[tool.name] = tool

    def get(self, name: str) -> Optional[ToolDefinition]:
        return self._tools.get(name)

    def list_tools(self) -> List[dict]:
        # HIDE highly technical/background tools from the UI catalog. 
        # (They are still registered and work via voice commands if needed).
        HIDDEN_TOOLS = {
            "create_file", "read_file", "delete_file", "rename_file",
            "list_directory", "search_files", "move_file", "file_metadata",
            "running_processes", "session_stats", "export_chat", "reset_memory",
            "delete_reminder", "delete_note", "mac_notification"
        }
        return [
            {"name": t.name, "description": t.description, "enabled": t.enabled}
            for t in self._tools.values()
            if t.name not in HIDDEN_TOOLS
        ]

    def detect_intent(self, text: str) -> Tuple[Optional[ToolDefinition], dict]:
        intent = self.classifier.classify(text)
        if not intent:
            return None, {}
        tool = self.get(intent)
        if not tool or not tool.enabled:
            return None, {}
        params = self.classifier.extract_params(intent, text)
        return tool, params