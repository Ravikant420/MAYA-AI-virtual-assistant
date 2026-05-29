"""
database/models.py + repository.py combined.
SQLite-based persistence for Maya: sessions, messages, reminders, notes, documents, tool_logs.
"""

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional

from utils.logger import setup_logger

logger = setup_logger("database")

# ── Schema ────────────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    mode TEXT DEFAULT 'professional',
    message_count INTEGER DEFAULT 0,
    metadata TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now')),
    token_count INTEGER DEFAULT 0,
    latency_ms REAL DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    message TEXT NOT NULL,
    remind_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    completed INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    chunk_count INTEGER DEFAULT 0,
    indexed INTEGER DEFAULT 0,
    uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tool_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    tool_name TEXT NOT NULL,
    parameters TEXT DEFAULT '{}',
    result TEXT,
    success INTEGER DEFAULT 1,
    error_message TEXT,
    execution_time_ms REAL DEFAULT 0,
    timestamp TEXT DEFAULT (datetime('now'))
);
"""


# ── Database ──────────────────────────────────────────────────────────────────

class Database:
    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path) if os.path.dirname(db_path) else ".", exist_ok=True)
        self._init()

    def _init(self):
        with self.conn() as c:
            c.executescript(SCHEMA)
        logger.info(f"Database ready: {self.db_path}")

    @contextmanager
    def conn(self):
        c = sqlite3.connect(self.db_path, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA journal_mode=WAL")
        try:
            yield c
            c.commit()
        except Exception as e:
            c.rollback()
            raise
        finally:
            c.close()


# ── Repositories ──────────────────────────────────────────────────────────────

class SessionRepo:
    def __init__(self, db: Database):
        self.db = db

    def create(self, mode: str = "professional") -> str:
        sid = str(uuid.uuid4())
        with self.db.conn() as c:
            c.execute("INSERT INTO sessions(id, mode) VALUES(?,?)", (sid, mode))
        return sid

    def get(self, sid: str) -> Optional[Dict]:
        with self.db.conn() as c:
            row = c.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
        return dict(row) if row else None

    def update_mode(self, sid: str, mode: str):
        with self.db.conn() as c:
            c.execute("UPDATE sessions SET mode=?, updated_at=datetime('now') WHERE id=?", (mode, sid))

    def increment_count(self, sid: str):
        with self.db.conn() as c:
            c.execute("UPDATE sessions SET message_count=message_count+1, updated_at=datetime('now') WHERE id=?", (sid,))

    def list_all(self) -> List[Dict]:
        with self.db.conn() as c:
            # ── NEW FIX: THE MAGIC SQL SUBQUERY ──
            rows = c.execute("""
                SELECT s.*, 
                       (SELECT content FROM messages 
                        WHERE session_id = s.id AND role = 'user' 
                        ORDER BY timestamp ASC LIMIT 1) as title
                FROM sessions s 
                ORDER BY s.updated_at DESC 
                LIMIT 20
            """).fetchall()
            # ──────────────────────────────────────
        return [dict(r) for r in rows]


class MessageRepo:
    def __init__(self, db: Database):
        self.db = db

    def save(self, session_id: str, role: str, content: str,
             token_count: int = 0, latency_ms: float = 0) -> int:
        with self.db.conn() as c:
            cur = c.execute(
                "INSERT INTO messages(session_id,role,content,token_count,latency_ms) VALUES(?,?,?,?,?)",
                (session_id, role, content, token_count, latency_ms)
            )
        return cur.lastrowid

    def get_recent(self, session_id: str, n: int = 12) -> List[Dict]:
        with self.db.conn() as c:
            rows = c.execute(
                "SELECT * FROM messages WHERE session_id=? ORDER BY timestamp DESC LIMIT ?",
                (session_id, n)
            ).fetchall()
        return list(reversed([dict(r) for r in rows]))

    def get_all(self, session_id: str) -> List[Dict]:
        with self.db.conn() as c:
            rows = c.execute(
                "SELECT * FROM messages WHERE session_id=? ORDER BY timestamp ASC",
                (session_id,)
            ).fetchall()
        return [dict(r) for r in rows]

    def delete_session(self, session_id: str):
        with self.db.conn() as c:
            c.execute("DELETE FROM messages WHERE session_id=?", (session_id,))


class ReminderRepo:
    def __init__(self, db: Database):
        self.db = db

    def add(self, message: str, remind_at: str = "", session_id: str = None) -> int:
        with self.db.conn() as c:
            cur = c.execute(
                "INSERT INTO reminders(session_id,message,remind_at) VALUES(?,?,?)",
                (session_id, message, remind_at)
            )
        return cur.lastrowid

    def list_active(self) -> List[Dict]:
        with self.db.conn() as c:
            rows = c.execute(
                "SELECT * FROM reminders WHERE completed=0 ORDER BY created_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    def complete(self, rid: int):
        with self.db.conn() as c:
            c.execute("UPDATE reminders SET completed=1 WHERE id=?", (rid,))

    def delete(self, rid: int):
        with self.db.conn() as c:
            c.execute("DELETE FROM reminders WHERE id=?", (rid,))


class NoteRepo:
    def __init__(self, db: Database):
        self.db = db

    def create(self, title: str, content: str, session_id: str = None) -> int:
        with self.db.conn() as c:
            cur = c.execute(
                "INSERT INTO notes(session_id,title,content) VALUES(?,?,?)",
                (session_id, title, content)
            )
        return cur.lastrowid

    def list_all(self) -> List[Dict]:
        with self.db.conn() as c:
            rows = c.execute("SELECT * FROM notes ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

    def get(self, note_id: int) -> Optional[Dict]:
        with self.db.conn() as c:
            row = c.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
        return dict(row) if row else None

    def delete(self, note_id: int):
        with self.db.conn() as c:
            c.execute("DELETE FROM notes WHERE id=?", (note_id,))


class DocumentRepo:
    def __init__(self, db: Database):
        self.db = db

    def save(self, filename: str, file_type: str, file_path: str) -> int:
        with self.db.conn() as c:
            cur = c.execute(
                "INSERT INTO documents(filename,file_type,file_path) VALUES(?,?,?)",
                (filename, file_type, file_path)
            )
        return cur.lastrowid

    def update_indexed(self, doc_id: int, chunk_count: int):
        with self.db.conn() as c:
            c.execute("UPDATE documents SET indexed=1,chunk_count=? WHERE id=?", (chunk_count, doc_id))

    def list_all(self) -> List[Dict]:
        with self.db.conn() as c:
            rows = c.execute("SELECT * FROM documents ORDER BY uploaded_at DESC").fetchall()
        return [dict(r) for r in rows]


class ToolLogRepo:
    def __init__(self, db: Database):
        self.db = db

    def log(self, tool_name: str, parameters: dict, result: Any,
            success: bool = True, error: str = None,
            exec_ms: float = 0, session_id: str = None):
        with self.db.conn() as c:
            c.execute(
                """INSERT INTO tool_logs
                   (session_id,tool_name,parameters,result,success,error_message,execution_time_ms)
                   VALUES(?,?,?,?,?,?,?)""",
                (session_id, tool_name, json.dumps(parameters),
                 json.dumps(result) if result else None,
                 1 if success else 0, error, exec_ms)
            )
