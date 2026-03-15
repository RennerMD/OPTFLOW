"""
main.py — OPTFLOW uvicorn entry point
Run: uvicorn main:app --port 8000
"""
from common.api import app  # noqa: F401 — re-exported for uvicorn
