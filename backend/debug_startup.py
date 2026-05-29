#!/usr/bin/env python3
"""Debug script to test component initialization."""

import sys
sys.path.insert(0, '.')

from config import config

# Test each component initialization
tests = []

try:
    print('[1] Testing Database...')
    from database.repository import Database, SessionRepo, MessageRepo, ReminderRepo, NoteRepo
    db = Database(config.database.db_path)
    print('    ✅ Database OK')
    tests.append(True)
except Exception as e:
    print(f'    ❌ Database ERROR: {e}')
    tests.append(False)

try:
    print('[2] Testing OllamaClient...')
    from llm.ollama_client import OllamaClient
    llm = OllamaClient()
    print('    ✅ OllamaClient OK')
    tests.append(True)
except Exception as e:
    print(f'    ❌ OllamaClient ERROR: {e}')
    tests.append(False)

try:
    print('[3] Testing MemoryManager...')
    from memory.memory_manager import MemoryManager
    memory = MemoryManager()
    print('    ✅ MemoryManager OK')
    tests.append(True)
except Exception as e:
    print(f'    ❌ MemoryManager ERROR: {e}')
    tests.append(False)

try:
    print('[4] Testing RAGManager...')
    from rag.rag_manager import RAGManager
    rag = RAGManager()
    print('    ✅ RAGManager OK')
    tests.append(True)
except Exception as e:
    print(f'    ❌ RAGManager ERROR: {e}')
    tests.append(False)

try:
    print('[5] Testing build_registry...')
    from tools.executor import build_registry
    
    class DBBundle:
        def __init__(self):
            self.reminder_repo = ReminderRepo(db)
            self.note_repo = NoteRepo(db)
            self.message_repo = MessageRepo(db)
    
    bundle = DBBundle()
    registry, executor = build_registry(db=bundle)
    print('    ✅ build_registry OK')
    tests.append(True)
except Exception as e:
    print(f'    ❌ build_registry ERROR: {e}')
    import traceback
    traceback.print_exc()
    tests.append(False)

print()
print(f"Summary: {sum(tests)}/{len(tests)} tests passed")
if all(tests):
    print("✅ All components initialized successfully!")
else:
    print("❌ Some components failed to initialize")
    sys.exit(1)
