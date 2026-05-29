"""
memory/memory_manager.py - Multi-layer memory for Maya.

Layers:
  A. Short-term  — last N messages (in-memory list)
  B. Long-term   — FAISS vector store with sentence-transformer embeddings
  C. Summarization — auto-summarize after N messages, inject into context
"""

import json
import os
import time
import threading
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import numpy as np

from config import config
from utils.logger import setup_logger

logger = setup_logger("memory.manager")


class EmbeddingEngine:
    """Lazy-loaded sentence-transformers embedding engine."""
    _model = None
    _lock = threading.Lock()

    @classmethod
    def get_model(cls):
        if cls._model is None:
            with cls._lock:
                # Double-checked locking pattern
                if cls._model is None:
                    logger.info("Loading embedding model (sentence-transformers)...")
                    from sentence_transformers import SentenceTransformer
                    cls._model = SentenceTransformer(config.memory.embedding_model)
                    logger.info("Embedding model ready.")
        return cls._model

    @classmethod
    def embed(cls, texts: List[str]) -> np.ndarray:
        t0 = time.perf_counter()
        model = cls.get_model()
        vecs = model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
        logger.debug(f"Embedded {len(texts)} texts in {(time.perf_counter()-t0)*1000:.0f}ms")
        return vecs.astype("float32")


class FAISSMemoryStore:
    """Persistent FAISS cosine-similarity store."""

    def __init__(self, index_path: str, meta_path: str, dim: int = 384, max_size: int = 2000):
        self.index_path = index_path
        self.meta_path = meta_path
        self.dim = dim
        self.max_size = max_size  # Cap the total vector count
        self.metadata: List[dict] = []
        self.index = None
        self._load_or_create()

    def _load_or_create(self):
        import faiss
        os.makedirs(os.path.dirname(self.index_path) if os.path.dirname(self.index_path) else ".", exist_ok=True)
        if os.path.exists(self.index_path) and os.path.exists(self.meta_path):
            self.index = faiss.read_index(self.index_path)
            with open(self.meta_path) as f:
                self.metadata = json.load(f)
            logger.info(f"Loaded FAISS: {self.index.ntotal} vectors")
        else:
            self.index = faiss.IndexFlatIP(self.dim)
            self.metadata = []
            logger.info("Created new FAISS index.")

    def save(self):
        import faiss
        faiss.write_index(self.index, self.index_path)
        with open(self.meta_path, "w") as f:
            json.dump(self.metadata, f, indent=2)

    def _prune(self):
        """Removes the oldest vectors if we exceed max_size to prevent memory bloat."""
        if self.index.ntotal <= self.max_size:
            return
            
        import faiss
        import numpy as np
        
        excess = self.index.ntotal - self.max_size
        logger.info(f"Pruning {excess} old vectors from FAISS index.")
        
        # 1. Extract all raw math vectors currently stored in the FAISS index
        all_vectors = np.array([self.index.reconstruct(i) for i in range(self.index.ntotal)])
        
        # 2. Slice BOTH the vectors and the metadata so they stay perfectly synced
        kept_vectors = all_vectors[excess:]
        self.metadata = self.metadata[excess:]
        
        # 3. Rebuild the index from scratch and insert the kept vectors
        self.index = faiss.IndexFlatIP(self.dim)
        self.index.add(kept_vectors)
        
        self.save()

    def add(self, embeddings: np.ndarray, entries: List[dict]):
        self.index.add(embeddings)
        self.metadata.extend(entries)
        
        # Check and enforce memory bounds
        if self.index.ntotal > self.max_size:
            self._prune()
            
        self.save()

    def search(self, query_vec: np.ndarray, top_k: int = 5,
               threshold: float = 0.5) -> List[Tuple[dict, float]]:
        if self.index.ntotal == 0:
            return []
        q = query_vec.reshape(1, -1).astype("float32")
        scores, idxs = self.index.search(q, min(top_k, self.index.ntotal))
        results = []
        for score, idx in zip(scores[0], idxs[0]):
            if idx >= 0 and score >= threshold:
                results.append((self.metadata[idx], float(score)))
        return results

    def clear(self):
        import faiss
        self.index = faiss.IndexFlatIP(self.dim)
        self.metadata = []
        self.save()


class MemoryManager:
    """
    Maya's complete memory system.

    Public API:
      pre_warm()
      add_message(session_id, role, content)
      get_short_term(session_id) → List[Dict]
      search_long_term(session_id, query) → List[Dict]
      get_summary(session_id) → str | None
      summarize_session(session_id, llm_client) → str
      get_context(session_id, query) → dict
      clear_session(session_id)
      stats(session_id) → dict
    """

    def __init__(self):
        self.cfg = config.memory
        self._short_term: Dict[str, list] = {}
        self._summaries: Dict[str, str] = {}
        self._counts: Dict[str, int] = {}
        self.store = FAISSMemoryStore(self.cfg.faiss_index_path, self.cfg.faiss_meta_path)
        logger.info("MemoryManager ready.")

    def pre_warm(self):
        """
        Silently load the sentence-transformers model in a background daemon thread.
        This eliminates the 2-second 'cold start' penalty on the user's first chat message.
        """
        def _load_bg():
            try:
                EmbeddingEngine.get_model()
            except Exception as e:
                logger.warning(f"Memory embedding pre-warm failed: {e}")

        t = threading.Thread(target=_load_bg, daemon=True, name="memory-prewarm")
        t.start()

    def add_message(self, session_id: str, role: str, content: str,
                    metadata: dict = None, llm_client=None):
        # Short-term
        if session_id not in self._short_term:
            self._short_term[session_id] = []
        entry = {
            "role": role, "content": content,
            "session_id": session_id,
            "timestamp": datetime.utcnow().isoformat(),
            "metadata": metadata or {}
        }
        self._short_term[session_id].append(entry)
        # Trim to window
        max_w = self.cfg.short_term_window * 2
        if len(self._short_term[session_id]) > max_w:
            self._short_term[session_id] = self._short_term[session_id][-max_w:]

        # Long-term FAISS
        try:
            vec = EmbeddingEngine.embed([content])
            self.store.add(vec, [entry])
        except Exception as e:
            logger.warning(f"FAISS embed error: {e}")

        # Count & auto-summarize
        self._counts[session_id] = self._counts.get(session_id, 0) + 1
        if self._counts[session_id] % self.cfg.summarize_after_n == 0:
            try:
                self.summarize_session(session_id, llm_client)
            except Exception as e:
                logger.warning(f"Auto-summarize failed: {e}")

    def get_short_term(self, session_id: str, n: int = None) -> List[dict]:
        n = n or self.cfg.short_term_window
        return self._short_term.get(session_id, [])[-n:]

    def search_long_term(self, session_id: str, query: str,
                         top_k: int = None) -> List[dict]:
        top_k = top_k or self.cfg.long_term_top_k
        try:
            t0 = time.perf_counter()
            vec = EmbeddingEngine.embed([query])
            raw = self.store.search(vec, top_k=top_k * 3,
                                    threshold=self.cfg.similarity_threshold)
            results = [
                {"entry": m, "score": s}
                for m, s in raw
                if m.get("session_id") == session_id
            ][:top_k]
            logger.debug(f"Long-term search: {len(results)} hits in {(time.perf_counter()-t0)*1000:.0f}ms")
            return results
        except Exception as e:
            logger.warning(f"Long-term search failed: {e}")
            return []

    def summarize_session(self, session_id: str, llm_client=None) -> str:
        msgs = self._short_term.get(session_id, [])
        if not msgs:
            return "No conversation yet."
        if llm_client:
            try:
                conv = "\n".join(f"{m['role'].upper()}: {m['content'][:200]}" for m in msgs[-20:])
                resp = llm_client.generate_response(
                    [{"role": "user", "content":
                      f"Summarize this conversation in 3-5 sentences:\n\n{conv}"}],
                    system_prompt="You are a concise summarizer.",
                    temperature=0.2,
                )
                summary = resp.content
            except Exception as e:
                logger.warning(f"LLM summarize failed: {e}")
                summary = self._basic_summary(msgs)
        else:
            summary = self._basic_summary(msgs)
        self._summaries[session_id] = summary
        logger.info(f"Session {session_id[:8]}… summarized ({len(summary)} chars)")
        return summary

    def _basic_summary(self, msgs: list) -> str:
        roles = [m["role"] for m in msgs]
        return (f"Conversation of {len(msgs)} messages "
                f"({roles.count('user')} user, {roles.count('assistant')} assistant). "
                f"From {msgs[0]['timestamp']} to {msgs[-1]['timestamp']}.")

    def get_summary(self, session_id: str) -> Optional[str]:
        return self._summaries.get(session_id)

    def get_context(self, session_id: str, query: str) -> dict:
        return {
            "short_term": self.get_short_term(session_id),
            "long_term": self.search_long_term(session_id, query),
            "summary": self.get_summary(session_id),
        }

    def clear_session(self, session_id: str):
        self._short_term.pop(session_id, None)
        self._summaries.pop(session_id, None)
        self._counts.pop(session_id, None)
        logger.info(f"Memory cleared: {session_id[:8]}…")

    def stats(self, session_id: str) -> dict:
        return {
            "short_term_msgs": len(self._short_term.get(session_id, [])),
            "total_faiss_vectors": self.store.index.ntotal,
            "has_summary": session_id in self._summaries,
            "total_messages": self._counts.get(session_id, 0),
        }