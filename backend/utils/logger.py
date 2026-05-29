"""
utils/logger.py - Structured rotating logger for Maya.
"""

import logging
import os
import sys
import time
from functools import wraps
from logging.handlers import RotatingFileHandler

LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)-28s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def setup_logger(name: str, log_file: str = "logs/maya.log", level: str = "INFO") -> logging.Logger:
    os.makedirs(os.path.dirname(log_file) if os.path.dirname(log_file) else "logs", exist_ok=True)
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    fmt = logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT)

    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    fh = RotatingFileHandler(log_file, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)
    return logger


def timed(logger):
    """Decorator: log execution time of any function."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            t = time.perf_counter()
            try:
                r = fn(*a, **kw)
                logger.debug(f"[PERF] {fn.__name__} → {(time.perf_counter()-t)*1000:.1f}ms")
                return r
            except Exception as e:
                logger.error(f"[PERF] {fn.__name__} failed after {(time.perf_counter()-t)*1000:.1f}ms: {e}")
                raise
        return wrapper
    return decorator


app_logger = setup_logger("maya", "logs/maya.log")
