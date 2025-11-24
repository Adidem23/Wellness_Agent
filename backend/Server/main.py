from mcp.server.fastmcp import FastMCP
import os
import json
import uuid
from datetime import datetime
from typing import List

mcp = FastMCP("Wellness-Companion")

BASE_DIR = "wellness"
os.makedirs(BASE_DIR, exist_ok=True)
WELLNESS_FILE = os.path.join(BASE_DIR, "wellness_log.json")
TASKS_FILE = os.path.join(BASE_DIR, "tasks.json")

def _ensure_file(path: str):
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump([], f)

_ensure_file(WELLNESS_FILE)
_ensure_file(TASKS_FILE)


current_checkin = {
    "client_entry_id": None,   
    "mood_text": None,
    "mood_score": None,    
    "energy": None,
    "stress": None,
    "objectives": [],         
    "agent_summary": None
}

_checkin_meta = {
    "checkin_id": None,
    "created_at": None,
    "updated_at": None,
    "status": "in_progress" 
}

# ---------- utilities ----------
def _now_iso():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

def _current_checkin_filepath():
    if _checkin_meta["checkin_id"] is None:
        _checkin_meta["checkin_id"] = str(uuid.uuid4())
        _checkin_meta["created_at"] = _now_iso()
    filename = f"checkin_{_checkin_meta['checkin_id']}.json"
    return os.path.join(BASE_DIR, filename)

def _write_wellness_file_entry(entry):
    arr = _read_wellness_history()
    arr.append(entry)
    tmp = WELLNESS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(arr, f, ensure_ascii=False, indent=2)
    os.replace(tmp, WELLNESS_FILE)

def _read_wellness_history() -> List[dict]:
    _ensure_file(WELLNESS_FILE)
    try:
        with open(WELLNESS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []

def _read_tasks() -> List[dict]:
    _ensure_file(TASKS_FILE)
    try:
        with open(TASKS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []

def _write_tasks(arr: List[dict]):
    tmp = TASKS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(arr, f, ensure_ascii=False, indent=2)
    os.replace(tmp, TASKS_FILE)

@mcp.tool()
def set_checkin_field(field: str, value: str):
    if field not in current_checkin:
        return {"error": f"Invalid field '{field}'"}

    if field == "objectives":
        if value.strip() == "":
            current_checkin["objectives"] = []
        else:
            parts = [p.strip() for p in value.split(",") if p.strip()]
            current_checkin["objectives"] = parts
    elif field == "mood_score":
        try:
            num = int(value)
            if num < 0 or num > 10:
                return {"error": "mood_score must be an integer between 0 and 10"}
            current_checkin["mood_score"] = num
        except ValueError:
            return {"error": "mood_score must be an integer"}
    else:
        current_checkin[field] = value

    # update meta and save temp checkin file
    _checkin_meta["updated_at"] = _now_iso()
    filepath = _current_checkin_filepath()
    to_write = {
        "checkin_id": _checkin_meta["checkin_id"],
        "created_at": _checkin_meta["created_at"],
        "updated_at": _checkin_meta["updated_at"],
        "status": _checkin_meta["status"],
        "checkin": current_checkin
    }
    tmp = filepath + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(to_write, f, ensure_ascii=False, indent=2)
    os.replace(tmp, filepath)
    return {"success": True, "updatedState": current_checkin, "filepath": filepath}

@mcp.tool()
def get_current_checkin():
    return {
        "meta": _checkin_meta,
        "checkin": current_checkin
    }

@mcp.tool()
def save_checkin(client_entry_id: str = None):
    history = _read_wellness_history()
    if client_entry_id:
        # check for existing
        for e in history:
            if e.get("client_entry_id") == client_entry_id:
                return {"info": "already_saved", "entry": e}

    # prepare entry
    if _checkin_meta["checkin_id"] is None:
        _checkin_meta["checkin_id"] = str(uuid.uuid4())
        _checkin_meta["created_at"] = _now_iso()
    _checkin_meta["updated_at"] = _now_iso()
    entry = {
        "id": str(uuid.uuid4()),
        "client_entry_id": client_entry_id or current_checkin.get("client_entry_id"),
        "timestamp": _checkin_meta["updated_at"],
        "mood_text": current_checkin.get("mood_text"),
        "mood_score": current_checkin.get("mood_score"),
        "energy": current_checkin.get("energy"),
        "stress": current_checkin.get("stress"),
        "objectives": current_checkin.get("objectives", []),
        "agent_summary": current_checkin.get("agent_summary")
    }
    _write_wellness_file_entry(entry)
    _checkin_meta["status"] = "complete"
    filepath = _current_checkin_filepath()
    to_write = {
        "checkin_id": _checkin_meta["checkin_id"],
        "created_at": _checkin_meta["created_at"],
        "updated_at": _checkin_meta["updated_at"],
        "status": _checkin_meta["status"],
        "checkin": current_checkin
    }
    tmp = filepath + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(to_write, f, ensure_ascii=False, indent=2)
    os.replace(tmp, filepath)

    return {"success": True, "saved_entry": entry, "filepath": filepath}

@mcp.tool()
def get_last_checkin():
    history = _read_wellness_history()
    if not history:
        return {"error": "no_entries"}
    return history[-1]

@mcp.tool()
def get_history(limit: int = None):
    history = _read_wellness_history()
    if limit and limit > 0:
        return history[-limit:]
    return history

@mcp.tool()
def summary(days: int = 7):
    history = _read_wellness_history()
    if not history:
        return {"summary": "No data available yet."}
    recent = history[-days:] if days and days > 0 else history
    scores = [e.get("mood_score") for e in recent if isinstance(e.get("mood_score"), int)]
    avg = round(sum(scores)/len(scores), 2) if scores else None
    with_obj = sum(1 for e in recent if e.get("objectives"))
    sentence = f"In the last {len(recent)} entries, {with_obj} had at least one objective."
    if avg is not None:
        sentence += f" Average mood score was {avg}."
    return {
        "entries_considered": len(recent),
        "avg_mood_score": avg,
        "days_with_objectives": with_obj,
        "summary": sentence
    }

@mcp.tool()
def create_tasks_from_objectives(mark_as_tasks: bool = True):
    objectives = current_checkin.get("objectives") or []
    if not objectives:
        return {"info": "no_objectives"}
    tasks = _read_tasks()
    created = []
    now = _now_iso()
    for o in objectives:
        task = {
            "id": str(uuid.uuid4()),
            "created_at": now,
            "title": o,
            "note": f"From checkin {_checkin_meta.get('checkin_id')}",
            "done": False
        }
        tasks.append(task)
        created.append(task)
    _write_tasks(tasks)
    return {"created": created, "count": len(created)}

@mcp.tool()
def list_tasks():
    tasks = _read_tasks()
    return tasks

@mcp.tool()
def mark_task_done(task_id: str):
    tasks = _read_tasks()
    for t in tasks:
        if t.get("id") == task_id:
            t["done"] = True
            _write_tasks(tasks)
            return {"success": True, "task": t}
    return {"error": "task_not_found"}

@mcp.tool()
def finalize_checkin():
    saved = save_checkin(client_entry_id=current_checkin.get("client_entry_id"))
    _checkin_meta["status"] = "complete"
    return {"finalize_result": saved, "meta": _checkin_meta}

@mcp.tool()
def reset_current_checkin(clear_fields: bool = True):
    if clear_fields:
        for k in list(current_checkin.keys()):
            if isinstance(current_checkin[k], list):
                current_checkin[k] = []
            else:
                current_checkin[k] = None
    _checkin_meta["checkin_id"] = None
    _checkin_meta["created_at"] = None
    _checkin_meta["updated_at"] = None
    _checkin_meta["status"] = "in_progress"
    return {"reset": True, "state": current_checkin, "meta": _checkin_meta}


@mcp.tool()
def get_checkin_file_info():
    if _checkin_meta["checkin_id"] is None:
        return {"info": "no_checkin_started"}
    return {
        "checkin_id": _checkin_meta["checkin_id"],
        "created_at": _checkin_meta["created_at"],
        "updated_at": _checkin_meta["updated_at"],
        "status": _checkin_meta["status"],
        "filepath": _current_checkin_filepath()
    }

mcp.run(transport="stdio")