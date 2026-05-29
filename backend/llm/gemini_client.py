"""
llm/gemini_client.py - Google Gemini API client for Maya.
"""
import time
import os
import google.generativeai as genai
from utils.logger import setup_logger

logger = setup_logger("llm.gemini")


class GeminiClient:
    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not set in .env")
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel("gemini-2.5-flash")
        logger.info("GeminiClient ready | model=gemini-2.5-flash")

    def _tokens(self, text: str) -> int:
        return max(1, len(text) // 4)

    def generate_response(self, messages, system_prompt=""):
        t0 = time.perf_counter()
        try:
            history = []
            for m in messages[:-1]:
                history.append({
                    "role": "user" if m["role"] == "user" else "model",
                    "parts": [m["content"]]
                })
            chat = self.model.start_chat(history=history)
            last = messages[-1]["content"]
            full_prompt = f"{system_prompt}\n\n{last}" if system_prompt else last
            response = chat.send_message(full_prompt)
            content = response.text
            elapsed = (time.perf_counter() - t0) * 1000
            logger.info(f"Gemini ok | {elapsed:.0f}ms")

            # wrap in same LLMResponse-like object
            return _LLMResponse(content, elapsed,
                                self._tokens(full_prompt),
                                self._tokens(content))
        except Exception as e:
            logger.error(f"Gemini error: {e}")
            raise RuntimeError(f"Gemini failed: {e}")

    def stream_response(self, messages, system_prompt=""):
        t0 = time.perf_counter()
        try:
            history = []
            for m in messages[:-1]:
                history.append({
                    "role": "user" if m["role"] == "user" else "model",
                    "parts": [m["content"]]
                })
            chat = self.model.start_chat(history=history)
            last = messages[-1]["content"]
            full_prompt = f"{system_prompt}\n\n{last}" if system_prompt else last
            
            # Request a streaming response from Google
            response = chat.send_message(full_prompt, stream=True)
            
            # Yield each word as it arrives
            for chunk in response:
                if chunk.text:
                    yield chunk.text
                    
            elapsed = (time.perf_counter() - t0) * 1000
            logger.info(f"Gemini stream ok | {elapsed:.0f}ms")
            
        except Exception as e:
            logger.error(f"Gemini stream error: {e}")
            raise RuntimeError(f"Gemini stream failed: {e}")


    def count_tokens(self, messages, system_prompt=""):
        text = system_prompt + " ".join(m.get("content", "") for m in messages)
        return self._tokens(text)

    def health_check(self):
        try:
            self.model.generate_content("ping")
            return {"running": True, "model": "gemini-2.5-flash"}
        except Exception as e:
            return {"running": False, "error": str(e)}


class _LLMResponse:
    def __init__(self, content, latency_ms, prompt_tokens, completion_tokens):
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
