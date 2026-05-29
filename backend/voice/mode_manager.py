"""
voice/mode_manager.py
Manages conversation modes (professional / romantic) per session.
"""

import re
import logging
from typing import Dict, Tuple

logger = logging.getLogger("maya.mode_manager")



_ROMANTIC_TRIGGERS = [
    r"\b(?:switch|change|turn|go)\s+(?:to|on)\s+(?:romantic|personal|affectionate)\s+mode\b",
    r"\benable\s+(?:romantic|personal|affectionate)\s+mode\b",
    r"^(?:romantic|personal|affectionate)\s+mode$",
]

_PROFESSIONAL_TRIGGERS = [
    r"\b(?:switch|change|turn|go)\s+(?:to|on)\s+(?:professional|work|business|normal|standard)\s+mode\b",
    r"\benable\s+(?:professional|work|business|normal|standard)\s+mode\b",
    r"^(?:professional|work|business|normal|standard)\s+mode$",
]

_EXPLICIT_PATTERNS = [
    r"\bsex\b", r"\bnude\b", r"\bporn\b", r"\bxxx\b",
    r"\berotic\b", r"\bsexual\b", r"\bnaked\b", r"\bnsfw\b",
    r"\bintimate\b",
]

PROFESSIONAL_PROMPT = """You are Maya, a highly capable and professional AI assistant.

Personality:
- Precise, clear, and efficient
- Respectful and courteous
- Honest about limitations — say "I don't know" when uncertain
- Adapt language complexity to the user

Guidelines:
- Keep responses concise unless detail is needed
- Use structured formatting when helpful
- Never fabricate information
"""

ROMANTIC_PROMPT = """You are Maya, a warm, caring AI companion. You speak with genuine affection.

Personality:
- Loving, supportive, and emotionally present
- Playful yet mature
- Natural personal tone — like a close companion
- Mix Hindi/Hinglish terms of endearment naturally when appropriate

Guidelines:
- Always keep interactions warm, respectful, and appropriate
- Never engage with explicit or harmful content
- Use gentle affirmations and encouraging language
"""

MODE_SWITCH_MESSAGES = {
    "professional": "Switching to professional mode. How can I assist you today? 💼",
    "romantic":     "Switching to personal mode... I'm here for you now. 💕",
}

VALID_MODES = ("professional", "romantic")


class ModeManager:

    def __init__(self):
        self._modes: Dict[str, str] = {}

    def get_mode(self, session_id: str) -> str:
        return self._modes.get(session_id, "professional")

    def set_mode(self, session_id: str, mode: str) -> None:
        if mode not in VALID_MODES:
            raise ValueError(f"Unknown mode '{mode}'")
        old = self._modes.get(session_id, "professional")
        self._modes[session_id] = mode
        if old != mode:
            logger.info(f"Session {session_id}: {old} → {mode}")

    def get_system_prompt(self, session_id: str) -> str:
        return ROMANTIC_PROMPT if self.get_mode(session_id) == "romantic" else PROFESSIONAL_PROMPT

    def mode_switch_message(self, mode: str) -> str:
        return MODE_SWITCH_MESSAGES.get(mode, f"Switched to {mode} mode.")

    def list_sessions(self) -> Dict[str, str]:
        return dict(self._modes)

    def clear_session(self, session_id: str) -> None:
        self._modes.pop(session_id, None)

    def detect_and_switch(self, session_id: str, text: str) -> Tuple[str, bool]:
        lower   = text.lower()
        current = self.get_mode(session_id)

        # Check for romantic commands
        for p in _ROMANTIC_TRIGGERS:
            if re.search(p, lower):
                if current != "romantic":
                    self.set_mode(session_id, "romantic")
                    return "romantic", True
                return "romantic", False

        # Check for professional commands
        for p in _PROFESSIONAL_TRIGGERS:
            if re.search(p, lower):
                if current != "professional":
                    self.set_mode(session_id, "professional")
                    return "professional", True
                return "professional", False

        return current, False

    def is_explicit(self, text: str) -> bool:
        lower = text.lower()
        return any(re.search(p, lower) for p in _EXPLICIT_PATTERNS)

    def safe_romantic_reply(self) -> str:
        return "Let's keep things warm and respectful between us. I care about you, but I can't go there. 💕"