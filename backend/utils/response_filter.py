"""
utils/response_filter.py - Safety and content filtering layer for Maya.

Prevents:
- Explicit content (especially in romantic mode)
- Command injection attempts
- Dangerous system commands in tool inputs
- Oversized responses
"""

import re
from typing import Tuple
from utils.logger import setup_logger

logger = setup_logger("utils.response_filter")

# Patterns that indicate command injection attempts
INJECTION_PATTERNS = [
    r";\s*(rm|del|format|mkfs|dd)\s",
    r"\|\s*(bash|sh|cmd|powershell)\s",
    r"`[^`]+`",
    r"\$\([^\)]+\)",
    r"&&\s*(rm|del|format)\s",
    r"\.\./\.\./",
    r"\/etc\/passwd",
    r"\/etc\/shadow",
]

# Dangerous shell commands
DANGEROUS_COMMANDS = {
    "rm -rf", "del /f", "format c:", "mkfs", ":(){:|:&};:",
    "chmod 777 /", "sudo rm", "dd if=", "shutdown", "reboot",
    "halt", "> /dev/sda", "mv /* /dev/null",
}

# Explicit content keywords (blocked in romantic mode)
EXPLICIT_KEYWORDS = [
    "sex", "naked", "nude", "explicit", "porn", "erotic",
    "sexual", "nsfw", "xxx", "intimate act",
]

MAX_RESPONSE_CHARS = 8000


def sanitize_input(text: str) -> Tuple[str, bool]:
    """
    Sanitize user input. Returns (cleaned_text, is_safe).
    Strips control characters and detects injection attempts.
    """
    # Remove null bytes and control chars (keep newlines/tabs)
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    cleaned = cleaned.strip()

    # Check injection patterns
    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, cleaned, re.IGNORECASE):
            logger.warning(f"[SECURITY] Injection pattern detected: {pattern}")
            return cleaned, False

    # Check dangerous commands
    lower = cleaned.lower()
    for cmd in DANGEROUS_COMMANDS:
        if cmd in lower:
            logger.warning(f"[SECURITY] Dangerous command detected: {cmd}")
            return cleaned, False

    return cleaned, True


def filter_response(response: str, mode: str = "professional") -> str:
    """
    Filter LLM response before sending to user.
    - Truncate oversized responses
    - In romantic mode: remove explicit content
    - In professional mode: strip excess emojis
    """
    if not response:
        return response

    # Truncate if too long
    if len(response) > MAX_RESPONSE_CHARS:
        response = response[:MAX_RESPONSE_CHARS] + "\n\n[Response truncated for length]"
        logger.warning("[FILTER] Response truncated due to length.")

    if mode == "romantic":
        # Block explicit content
        lower = response.lower()
        for kw in EXPLICIT_KEYWORDS:
            if kw in lower:
                logger.warning(f"[FILTER] Explicit keyword '{kw}' detected in romantic mode — blocking.")
                return "I'm here for you, but let's keep our conversation warm and respectful. ❤️"

        # Allow max 2 emojis total
        emoji_pattern = re.compile(
            "[\U00010000-\U0010ffff]", flags=re.UNICODE
        )
        emojis_found = emoji_pattern.findall(response)
        if len(emojis_found) > 2:
            # Keep only first 2 emoji occurrences
            count = 0
            def replacer(m):
                nonlocal count
                count += 1
                return m.group(0) if count <= 2 else ""
            response = emoji_pattern.sub(replacer, response)

    elif mode == "professional":
        # Strip all emojis in professional mode
        emoji_pattern = re.compile(
            "[\U00010000-\U0010ffff\U00002600-\U000027BF]", flags=re.UNICODE
        )
        response = emoji_pattern.sub("", response).strip()

    return response


def is_explicit_request(text: str) -> bool:
    """Check if user input is requesting explicit content."""
    lower = text.lower()
    return any(kw in lower for kw in EXPLICIT_KEYWORDS)


def check_file_path_safety(path: str, sandbox: str) -> bool:
    """Verify a file path stays within the sandbox directory."""
    import os
    sandbox_abs = os.path.abspath(sandbox)
    target_abs = os.path.abspath(os.path.join(sandbox, path))
    return target_abs.startswith(sandbox_abs)
