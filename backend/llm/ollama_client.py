"""
llm/ollama_client.py - Ollama LLM wrapper for Maya.
Supports: generate, stream, health_check, retry, latency tracking.
"""

import json
import time
from typing import Dict, Generator, AsyncGenerator, List, Optional

import requests
import httpx

from config import config
from utils.logger import setup_logger

logger = setup_logger("llm.ollama")


class LLMResponse:
    def __init__(self, content: str, latency_ms: float,
                 prompt_tokens: int, completion_tokens: int):
        self.content = content
        self.latency_ms = latency_ms
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.total_tokens = prompt_tokens + completion_tokens

    def to_dict(self):
        return {
            "content": self.content,
            "latency_ms": round(self.latency_ms, 2),
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
        }


class OllamaClient:
    def __init__(self):
        self.cfg = config.llm
        self.chat_url = f"{self.cfg.ollama_host}/api/chat"
        self.health_url = f"{self.cfg.ollama_host}/api/tags"
        logger.info(f"OllamaClient ready | model={self.cfg.model_name}")

    def _tokens(self, text: str) -> int:
        return max(1, len(text) // 4)

    def _payload(self, messages: List[Dict], system_prompt: str,
                 temperature: float = None, stream: bool = False) -> dict:

        # ── Detect mode ───────────────────────────────────────────────
        is_romantic = (
            "girlfriend" in system_prompt.lower() or
            "whatsapp"   in system_prompt.lower()
        )

        # ── Detect sayari / poetry request ───────────────────────────
        last_user_msg = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                last_user_msg = m.get("content", "").lower()
                break
        sayari_keywords = ["sayari", "shayari", "sher", "poem", "kavita",
                           "likho", "sunao", "poetry"]
        is_sayari = any(w in last_user_msg for w in sayari_keywords)

        # ── Build message list ────────────────────────────────────────
        all_msgs = []
        if system_prompt:
            all_msgs.append({"role": "system", "content": system_prompt})

        # If user sent a single word in professional mode, rewrite it
        # to prevent the model from echoing "word: definition" pattern
        processed_messages = list(messages)
        if not is_romantic and last_user_msg and len(last_user_msg.split()) == 1:
            # Single word detected — rewrite last user message to be explicit
            for i in range(len(processed_messages) - 1, -1, -1):
                if processed_messages[i].get("role") == "user":
                    original = processed_messages[i]["content"].strip()
                    processed_messages[i] = {
                        "role": "user",
                        "content": f"Explain {original} in detail."
                    }
                    break

        all_msgs.extend(processed_messages)

        # Romantic: append hard constraint reminder
        if is_romantic:
            all_msgs.append({
                "role": "system",
                "content": (
                    "REMEMBER: Reply in 1 to 2 sentences only. "
                    "Max 20 words. No assistant phrases. "
                    "Never start with Maya: or Ravi:"
                ),
            })

        # ── Mode-specific generation options ─────────────────────────
        if is_romantic:
            # Higher temperature = natural, varied, human-feeling replies
            options = {
                "temperature":    temperature or 0.9,
                "top_p":          0.92,
                "top_k":          50,
                "num_predict":    200 if is_sayari else 60,
                "repeat_penalty": 1.4,
                "repeat_last_n":  128,
                # Stop on role labels + blank lines — keeps replies tight
                "stop": ["Ravi:", "Maya:", "\n\n"],
            }
        else:
            # Professional mode:
            # - Lower temperature  → more factual and consistent
            # - NO stop on "\n\n" → markdown uses double newlines between sections,
            #   stopping there would truncate structured answers mid-way
            # - Light repeat_penalty → avoids choppy/fragmented sentences
            options = {
                "temperature":    temperature or 0.35,
                "top_p":          0.9,
                "top_k":          40,
                "num_predict":    1024,
                "repeat_penalty": 1.1,
                "repeat_last_n":  256,
                "stop":           [],
            }

        return {
            "model":    self.cfg.model_name,
            "messages": all_msgs,
            "stream":   stream,
            "options":  options,
        }

    def generate_response(self, messages: List[Dict], system_prompt: str = "",
                          temperature: float = None) -> LLMResponse:
        payload = self._payload(messages, system_prompt, temperature, stream=False)
        last_error = None

        for attempt in range(1, self.cfg.max_retries + 1):
            try:
                t0 = time.perf_counter()
                r = requests.post(self.chat_url, json=payload, timeout=self.cfg.timeout)
                r.raise_for_status()
                elapsed = (time.perf_counter() - t0) * 1000
                content = r.json().get("message", {}).get("content", "")
                if not content or content.strip() == "":
                    content = "OK, Or kya ho rha hai? ..."

                pt = self._tokens(" ".join(m["content"] for m in payload["messages"]))
                ct = self._tokens(content)
                logger.info(f"LLM ok | attempt={attempt} | {elapsed:.0f}ms | {pt}+{ct} tokens")
                return LLMResponse(content, elapsed, pt, ct)

            except requests.exceptions.Timeout:
                last_error = "Timeout"
                logger.warning(f"LLM timeout attempt {attempt}")
            except requests.exceptions.ConnectionError:
                last_error = "Cannot connect to Ollama"
                logger.error(last_error)
            except Exception as e:
                last_error = str(e)
                logger.error(f"LLM error: {e}")

            if attempt < self.cfg.max_retries:
                time.sleep(self.cfg.retry_delay * attempt)

        raise RuntimeError(f"LLM failed after {self.cfg.max_retries} attempts: {last_error}")

    async def stream_response(self, messages: List[Dict], system_prompt: str = "",
                        temperature: float = None) -> AsyncGenerator[str, None]:
        payload = self._payload(messages, system_prompt, temperature, stream=True)
        try:
            t0 = time.perf_counter()
            async with httpx.AsyncClient(timeout=self.cfg.timeout) as client:
                async with client.stream("POST", self.chat_url, json=payload) as r:
                    r.raise_for_status()
                    async for line in r.aiter_lines():
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)
                            token = chunk.get("message", {}).get("content", "")
                            if token:
                                yield token
                            if chunk.get("done"):
                                logger.info(f"Stream done | {(time.perf_counter()-t0)*1000:.0f}ms")
                                break
                        except json.JSONDecodeError:
                            continue
        except Exception as e:
            logger.error(f"Stream error: {e}")
            yield f"\n[Error: {e}]"

    

    def health_check(self) -> Dict:
        try:
            r = requests.get(self.health_url, timeout=5)
            r.raise_for_status()
            models = [m.get("name", "") for m in r.json().get("models", [])]
            available = any(self.cfg.model_name in m for m in models)
            return {
                "running": True,
                "model": self.cfg.model_name,
                "model_available": available,
                "available_models": models,
            }
        except Exception as e:
            return {"running": False, "error": str(e)}

    def count_tokens(self, messages: List[Dict], system_prompt: str = "") -> int:
        text = system_prompt + " ".join(m.get("content", "") for m in messages)
        return self._tokens(text)