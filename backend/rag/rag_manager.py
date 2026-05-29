"""
rag/rag_manager.py + document_loader.py - Full RAG pipeline for Maya.

Supports: PDF, TXT, DOCX
Pipeline: load → chunk (sliding window) → embed → FAISS → retrieve → augment → generate
Includes: similarity score, source reference, confidence estimate
"""

import json
import os
import re
import time
from typing import Dict, List, Optional, Tuple

import numpy as np

from config import config
from memory.memory_manager import EmbeddingEngine, FAISSMemoryStore
from utils.logger import setup_logger

logger = setup_logger("rag.manager")


# ── Document Loading ──────────────────────────────────────────────────────────

def _clean(text: str) -> str:
    text = re.sub(r"[^\x20-\x7E\n\t]", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return re.sub(r" {2,}", " ", text).strip()


def load_txt(path: str) -> str:
    with open(path, encoding="utf-8", errors="ignore") as f:
        return _clean(f.read())


def load_pdf(path: str) -> str:
    try:
        import fitz
        doc = fitz.open(path)
        pages = [p.get_text("text") for p in doc]
        doc.close()
        return _clean("\n".join(pages))
    except ImportError:
        raise ImportError("Run: pip install pymupdf")


def load_docx(path: str) -> str:
    try:
        from docx import Document
        doc = Document(path)
        return _clean("\n".join(p.text for p in doc.paragraphs if p.text.strip()))
    except ImportError:
        raise ImportError("Run: pip install python-docx")


def load_document(path: str) -> str:
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    loaders = {"txt": load_txt, "pdf": load_pdf, "docx": load_docx}
    if ext not in loaders:
        raise ValueError(f"Unsupported: .{ext}")
    return loaders[ext](path)


def chunk_text(text: str, chunk_size: int = None, overlap: int = None) -> List[str]:
    chunk_size = chunk_size or config.rag.chunk_size
    overlap = overlap or config.rag.chunk_overlap
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks, current, cur_len = [], [], 0
    for sent in sentences:
        slen = len(sent)
        if cur_len + slen > chunk_size and current:
            chunk = " ".join(current)
            chunks.append(chunk)
            overlap_text = chunk[-overlap:] if overlap else ""
            current = [overlap_text] if overlap_text else []
            cur_len = len(overlap_text)
        current.append(sent)
        cur_len += slen + 1
    if current:
        chunks.append(" ".join(current))
    return [c.strip() for c in chunks if len(c.strip()) > 40]


# ── RAG Manager ───────────────────────────────────────────────────────────────

class RetrievedChunk:
    def __init__(self, content: str, source: str, chunk_idx: int,
                 score: float, doc_id: int):
        self.content = content
        self.source = source
        self.chunk_idx = chunk_idx
        self.score = score
        self.doc_id = doc_id

    @property
    def confidence(self) -> str:
        if self.score >= 0.80: return "HIGH"
        if self.score >= 0.60: return "MEDIUM"
        return "LOW"

    def to_dict(self):
        preview = self.content[:250] + "..." if len(self.content) > 250 else self.content
        return {"source": self.source, "chunk": self.chunk_idx,
                "similarity": round(self.score, 4), "confidence": self.confidence,
                "preview": preview, "doc_id": self.doc_id}


class RAGManager:
    def __init__(self):
        self.cfg = config.rag
        self.store = FAISSMemoryStore(
            self.cfg.faiss_index_path, self.cfg.faiss_meta_path
        )
        logger.info("RAGManager ready.")

    def index_document(self, filepath: str, doc_id: int, filename: str) -> int:
        logger.info(f"Indexing: {filename}")
        t0 = time.perf_counter()
        text = load_document(filepath)
        chunks = chunk_text(text)
        if not chunks:
            return 0
        embeddings = EmbeddingEngine.embed(chunks)
        meta = [{"content": c, "source": filename, "chunk_index": i, "doc_id": doc_id}
                for i, c in enumerate(chunks)]
        self.store.add(embeddings, meta)
        logger.info(f"Indexed {len(chunks)} chunks from '{filename}' in {(time.perf_counter()-t0)*1000:.0f}ms")
        return len(chunks)

    def retrieve(self, query: str, top_k: int = None) -> List[RetrievedChunk]:
        top_k = top_k or self.cfg.top_k_chunks
        try:
            vec = EmbeddingEngine.embed([query])
            results = self.store.search(vec, top_k=top_k,
            threshold=self.cfg.similarity_threshold)
            return [RetrievedChunk(
                m.get("content", ""), m.get("source", "?"),
                m.get("chunk_index", 0), s, m.get("doc_id", -1)
            ) for m, s in results]
        except Exception as e:
            logger.error(f"RAG retrieve error: {e}")
            return []

    def build_prompt(self, query: str, chunks: List[RetrievedChunk]) -> str:
        if not chunks:
            return query
        ctx = "\n\n---\n\n".join(
            f"[Source: {c.source} | Chunk {c.chunk_idx} | {c.confidence} ({c.score:.2f})]\n{c.content}"
            for i, c in enumerate(chunks, 1)
        )
        return (
            f"Answer using the document context below. If not found, say so clearly.\n\n"
            f"=== CONTEXT ===\n{ctx}\n\n"
            f"=== QUESTION ===\n{query}\n\nAnswer:"
        )

    def query(self, query_text: str, llm_client=None,
              system_prompt: str = None) -> Dict:
        t0 = time.perf_counter()
        chunks = self.retrieve(query_text)
        if not chunks:
            return {"answer": "No relevant documents found.", "sources": [],
                    "retrieval_count": 0, "latency_ms": 0}
        prompt = self.build_prompt(query_text, chunks)
        answer = None
        if llm_client:
            try:
                resp = llm_client.generate_response(
                    [{"role": "user", "content": prompt}],
                    system_prompt=system_prompt or (
                        "You are a precise assistant. Answer only from the provided context."
                    ),
                    temperature=0.2,
                )
                answer = resp.content
            except Exception as e:
                answer = f"Retrieval succeeded but LLM failed: {e}"
        return {
            "answer": answer or prompt,
            "sources": [c.to_dict() for c in chunks],
            "retrieval_count": len(chunks),
            "top_similarity": chunks[0].score if chunks else 0,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
        }

    def stats(self) -> dict:
        return {"total_chunks": self.store.index.ntotal}

    def clear(self):
        self.store.clear()
