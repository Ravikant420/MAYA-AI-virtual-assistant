"""
llm/chatgpt_client.py - OpenAI ChatGPT API client for Maya.
"""
import time
import os
from openai import OpenAI
from utils.logger import setup_logger

logger = setup_logger("llm.chatgpt")


class ChatGPTClient:
    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY not set in .env")
        self.client = OpenAI(api_key=api_key)
        self.model_name = "gpt-4o-mini"
        logger.info(f"ChatGPTClient ready | model={self.model_name}")

    def _tokens(self, text: str) -> int:
        return max(1, len(text) // 4)

    def generate_response(self, messages, system_prompt=""):
        t0 = time.perf_counter()
        try:
            all_msgs = []
            if system_prompt:
                all_msgs.append({"role": "system", "content": system_prompt})
            all_msgs.extend(messages)

            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=all_msgs,
                max_tokens=200,
                temperature=0.8,
            )
            content = response.choices[0].message.content or ""
            elapsed = (time.perf_counter() - t0) * 1000
            logger.info(f"ChatGPT ok | {elapsed:.0f}ms")

            return _LLMResponse(content, elapsed,
                                response.usage.prompt_tokens,
                                response.usage.completion_tokens)
        except Exception as e:
            logger.error(f"ChatGPT error: {e}")
            raise RuntimeError(f"ChatGPT failed: {e}")

    def stream_response(self, messages, system_prompt=""):
        t0 = time.perf_counter()
        try:
            all_msgs = []
            if system_prompt:
                all_msgs.append({"role": "system", "content": system_prompt})
            all_msgs.extend(messages)

            # Request a streaming response from OpenAI
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=all_msgs,
                max_tokens=1000, 
                temperature=0.8,
                stream=True
            )
            
            # Yield each word as it arrives
            for chunk in response:
                # OpenAI streams deltas, we extract the content if it exists
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content

            elapsed = (time.perf_counter() - t0) * 1000
            logger.info(f"ChatGPT stream ok | {elapsed:.0f}ms")

        except Exception as e:
            logger.error(f"ChatGPT stream error: {e}")
            raise RuntimeError(f"ChatGPT stream failed: {e}")

    def count_tokens(self, messages, system_prompt=""):
        text = system_prompt + " ".join(m.get("content", "") for m in messages)
        return self._tokens(text)

    def health_check(self):
        try:
            self.client.models.retrieve(self.model_name)
            return {"running": True, "model": self.model_name}
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
