from fastapi import APIRouter, HTTPException, Request
from pathlib import Path
import json

router = APIRouter(prefix="/api/config")
from common.paths import ROOT, USER_DATA, ENV_FILE, POSITIONS_FILE


def _read_env() -> dict:
    f = ENV_FILE
    if not f.exists():
        return {}
    out = {}
    for line in f.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip()
    return out


@router.get("/env")
async def get_env():
    return _read_env()

@router.post("/env")
async def set_env(payload: dict):
    data = _read_env()
    data.update(payload)
    ENV_FILE.write_text("\n".join(f"{k}={v}" for k, v in data.items()) + "\n")
    return {"status": "saved", "keys": list(payload)}

@router.get("/portfolio")
async def get_portfolio_file():
    return json.loads(POSITIONS_FILE.read_text()) if POSITIONS_FILE.exists() else []

@router.post("/portfolio")
async def save_portfolio_file(request: Request):
    try:
        positions = await request.json()
        if not isinstance(positions, list):
            raise HTTPException(status_code=400, detail="Expected a JSON array")
        POSITIONS_FILE.write_text(json.dumps(positions, indent=2))
        return {"status": "saved", "count": len(positions)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/readme")
async def get_readme():
    f = ROOT / "README.md"
    return {"content": f.read_text() if f.exists() else "README.md not found."}

@router.post("/readme")
async def save_readme(request: Request):
    payload = await request.json()
    (ROOT / "README.md").write_text(payload.get("content", ""))
    return {"status": "saved"}
