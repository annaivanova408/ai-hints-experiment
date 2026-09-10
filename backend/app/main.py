from __future__ import annotations

import csv
import hashlib
import io
import itertools
import json
import os
import random
import socket
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from mutagen.mp4 import MP4
from pydantic import BaseModel, Field


APP_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = Path(os.getenv("CONFIG_PATH", PROJECT_ROOT / "data" / "stimuli.json"))
if not DATA_PATH.exists():
    DATA_PATH = APP_ROOT / "data" / "stimuli.json"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{PROJECT_ROOT / 'experiment.sqlite3'}")
DB_PATH = DATABASE_URL.removeprefix("sqlite:///")
CONFIG = json.loads(DATA_PATH.read_text(encoding="utf-8"))
CONFIG_VERSION = CONFIG["config_version"]
CONDITIONS = ("AI", "EXPERT", "CONTROL")
VIDEO_PERMUTATIONS = list(itertools.permutations(CONFIG["video_ids"]))
NASA_PERMUTATIONS = list(itertools.permutations(CONDITIONS))
DB_LOCK = threading.Lock()


app = FastAPI(title="Эксперимент с подсказками", version="0.1.0")
CLIPS_PATH = Path(os.getenv("CLIPS_PATH", PROJECT_ROOT / "clips"))
app.mount("/clips", StaticFiles(directory=CLIPS_PATH, check_dir=False), name="clips")


def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def init_db() -> None:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                subject_id TEXT PRIMARY KEY,
                sex TEXT NOT NULL,
                age INTEGER NOT NULL,
                education TEXT NOT NULL,
                assignment_json TEXT NOT NULL,
                state_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                config_version TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subject_id TEXT NOT NULL,
                timestamp_unix_ms INTEGER NOT NULL,
                timestamp_monotonic_ms REAL NOT NULL,
                server_unix_ms INTEGER NOT NULL,
                event_code INTEGER NOT NULL,
                event_name TEXT NOT NULL,
                segment_id TEXT,
                condition_name TEXT,
                payload_json TEXT NOT NULL,
                FOREIGN KEY(subject_id) REFERENCES sessions(subject_id)
            );
            CREATE INDEX IF NOT EXISTS ix_events_subject ON events(subject_id, id);
            CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subject_id TEXT NOT NULL,
                record_type TEXT NOT NULL,
                record_key TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(subject_id, record_type, record_key),
                FOREIGN KEY(subject_id) REFERENCES sessions(subject_id)
            );
            """
        )


@app.on_event("startup")
def startup() -> None:
    init_db()
    validate_config()


class StartIn(BaseModel):
    subject_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-zА-Яа-я0-9_.-]+$")
    sex: str = Field(min_length=1, max_length=32)
    age: int = Field(ge=18, le=100)
    education: str = Field(min_length=1, max_length=120)
    consent_confirmed: bool


class EventIn(BaseModel):
    timestamp_unix_ms: int
    timestamp_monotonic_ms: float
    event_code: int
    event_name: str = Field(min_length=1, max_length=80)
    segment_id: str | None = None
    condition: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class StateIn(BaseModel):
    state: dict[str, Any]


class RecordIn(BaseModel):
    record_type: str = Field(min_length=1, max_length=40)
    record_key: str = Field(min_length=1, max_length=100)
    payload: dict[str, Any]


def stable_seed(subject_id: str, namespace: str) -> int:
    digest = hashlib.sha256(f"{subject_id}:{namespace}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def constrained_conditions(count: int, rng: random.Random, previous: str | None) -> list[str]:
    per_condition = count // 3
    source = [condition for condition in CONDITIONS for _ in range(per_condition)]
    for _ in range(100):
        rng.shuffle(source)
        if previous and source[0] == previous:
            continue
        if any(source[i] == source[i + 1] == source[i + 2] for i in range(len(source) - 2)):
            continue
        return list(source)
    raise RuntimeError("Не удалось распределить условия с заданными ограничениями")


def least_used_permutation(connection: sqlite3.Connection, key: str, variants: int, subject_id: str) -> int:
    counts = [0] * variants
    for row in connection.execute("SELECT assignment_json FROM sessions"):
        assignment = json.loads(row[0])
        index = assignment.get(key)
        if isinstance(index, int) and 0 <= index < variants:
            counts[index] += 1
    minimum = min(counts)
    candidates = [i for i, value in enumerate(counts) if value == minimum]
    rng = random.Random(stable_seed(subject_id, key))
    return rng.choice(candidates)


def least_used_slot(connection: sqlite3.Connection, subject_id: str) -> int:
    slots = CONFIG["assignment_slots"]
    counts = [0] * len(slots)
    for row in connection.execute("SELECT assignment_json FROM sessions"):
        assignment = json.loads(row[0])
        index = assignment.get("assignment_slot")
        if isinstance(index, int) and 0 <= index < len(slots):
            counts[index] += 1
    minimum = min(counts)
    candidates = [index for index, count in enumerate(counts) if count == minimum]
    return random.Random(stable_seed(subject_id, "assignment-slot")).choice(candidates)


def build_assignment(connection: sqlite3.Connection, subject_id: str) -> dict[str, Any]:
    slot_index = least_used_slot(connection, subject_id)
    slot = CONFIG["assignment_slots"][slot_index]
    video_order = list(slot["video_order"])
    segment_conditions = dict(slot["segment_conditions"])

    option_orders = {}
    for item in [*CONFIG["segments"], *CONFIG["final_test"]]:
        keys = list(item["options"])
        random.Random(stable_seed(subject_id, f"options:{item['id']}")).shuffle(keys)
        option_orders[item["id"]] = keys
    final_test_order = [item["id"] for item in CONFIG["final_test"]]
    random.Random(stable_seed(subject_id, "final-test")).shuffle(final_test_order)
    anxiety_order = list(range(len(CONFIG["anxiety"]["items"])))
    random.Random(stable_seed(subject_id, "anxiety")).shuffle(anxiety_order)
    return {
        "assignment_slot": slot_index,
        "video_permutation_index": list(VIDEO_PERMUTATIONS).index(tuple(video_order)),
        "video_order": video_order,
        "nasa_permutation_index": list(NASA_PERMUTATIONS).index(tuple(slot["nasa_order"])),
        "nasa_order": list(slot["nasa_order"]),
        "segment_conditions": segment_conditions,
        "option_orders": option_orders,
        "final_test_order": final_test_order,
        "anxiety_order": anxiety_order,
    }


def validate_config() -> None:
    errors = []
    segment_ids = set()
    for item in CONFIG["segments"]:
        segment_ids.add(item["id"])
        if item["correct"] not in item["options"]:
            errors.append(f"{item['id']}: верный ответ отсутствует среди вариантов")
        for condition in ("ai", "expert", "control"):
            if not item["hints"].get(condition):
                errors.append(f"{item['id']}: отсутствует подсказка {condition}")
        ai_words = len(item["hints"]["ai"].split())
        expert_words = len(item["hints"]["expert"].split())
        if max(ai_words, expert_words) and abs(ai_words - expert_words) / max(ai_words, expert_words) > 0.2:
            errors.append(f"{item['id']}: длины AI/EXPERT различаются более чем на 20%")
    for item in CONFIG["final_test"]:
        if item["segment_id"] not in segment_ids:
            errors.append(f"{item['id']}: неизвестный сегмент")
        if item["correct"] not in item["options"]:
            errors.append(f"{item['id']}: неверный ключ correct")
    slots = CONFIG.get("assignment_slots", [])
    if len(slots) != 30:
        errors.append("assignment_slots: должно быть ровно 30 заранее сформированных слотов")
    if os.getenv("VALIDATE_MEDIA", "true").lower() == "true":
        media = [clip for video in CONFIG["videos"] for clip in video["clips"]]
        media.extend([
            {"file": "practice_1.mp4", "duration_sec": 8.0},
            {"file": "practice_2.mp4", "duration_sec": 8.0},
        ])
        for clip in media:
            path = CLIPS_PATH / clip["file"]
            if not path.exists():
                errors.append(f"{clip['file']}: файл клипа не найден")
                continue
            try:
                actual = float(MP4(path).info.length)
            except Exception as error:
                errors.append(f"{clip['file']}: не удалось прочитать длительность ({error})")
                continue
            if abs(actual - float(clip["duration_sec"])) > 0.04:
                errors.append(f"{clip['file']}: длительность {actual:.3f} вместо {clip['duration_sec']:.3f}")
    if errors:
        raise RuntimeError("Ошибки stimuli.json:\n" + "\n".join(errors))


def session_out(row: sqlite3.Row) -> dict[str, Any]:
    result = {
        "subject_id": row["subject_id"],
        "sex": row["sex"],
        "age": row["age"],
        "education": row["education"],
        "assignment": json.loads(row["assignment_json"]),
        "state": json.loads(row["state_json"]),
        "status": row["status"],
        "config_version": row["config_version"],
    }
    if "created_at" in row.keys():
        result["created_at"] = row["created_at"]
        result["updated_at"] = row["updated_at"]
    return result


def emit_udp(event: EventIn, subject_id: str) -> None:
    host = os.getenv("MARKER_UDP_HOST", "").strip()
    port = int(os.getenv("MARKER_UDP_PORT", "0") or 0)
    if not host or not port:
        return
    message = json.dumps({"subject_id": subject_id, **event.model_dump()}, ensure_ascii=False).encode()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.sendto(message, (host, port))
    except OSError:
        pass


@app.get("/api/health")
def health():
    return {"status": "ok", "config_version": CONFIG_VERSION}


@app.get("/api/config")
def get_config():
    return CONFIG


@app.post("/api/sessions")
def start_session(data: StartIn):
    if not data.consent_confirmed:
        raise HTTPException(422, "Подтвердите, что информированное согласие оформлено отдельно")
    now = datetime.now(timezone.utc).isoformat()
    subject_id = data.subject_id.strip()
    with DB_LOCK, db() as connection:
        existing = connection.execute("SELECT * FROM sessions WHERE subject_id=?", (subject_id,)).fetchone()
        if existing:
            return session_out(existing)
        assignment = build_assignment(connection, subject_id)
        state = {"screen": "instructions", "video_position": 0, "segment_position": 0}
        connection.execute(
            "INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)",
            (subject_id, data.sex, data.age, data.education, json.dumps(assignment), json.dumps(state), CONFIG_VERSION, now, now),
        )
        row = connection.execute("SELECT * FROM sessions WHERE subject_id=?", (subject_id,)).fetchone()
    return session_out(row)


@app.get("/api/sessions/{subject_id}")
def get_session(subject_id: str):
    with db() as connection:
        row = connection.execute("SELECT * FROM sessions WHERE subject_id=?", (subject_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Сессия не найдена")
    return session_out(row)


@app.put("/api/sessions/{subject_id}/state")
def save_state(subject_id: str, data: StateIn):
    now = datetime.now(timezone.utc).isoformat()
    with DB_LOCK, db() as connection:
        cursor = connection.execute(
            "UPDATE sessions SET state_json=?, updated_at=? WHERE subject_id=?",
            (json.dumps(data.state, ensure_ascii=False), now, subject_id),
        )
        if not cursor.rowcount:
            raise HTTPException(404, "Сессия не найдена")
    return {"ok": True}


@app.post("/api/sessions/{subject_id}/events")
def add_event(subject_id: str, event: EventIn):
    server_ms = int(time.time() * 1000)
    with DB_LOCK, db() as connection:
        if not connection.execute("SELECT 1 FROM sessions WHERE subject_id=?", (subject_id,)).fetchone():
            raise HTTPException(404, "Сессия не найдена")
        connection.execute(
            "INSERT INTO events (subject_id,timestamp_unix_ms,timestamp_monotonic_ms,server_unix_ms,event_code,event_name,segment_id,condition_name,payload_json) VALUES (?,?,?,?,?,?,?,?,?)",
            (subject_id, event.timestamp_unix_ms, event.timestamp_monotonic_ms, server_ms, event.event_code, event.event_name, event.segment_id, event.condition, json.dumps(event.payload, ensure_ascii=False)),
        )
    emit_udp(event, subject_id)
    return {"ok": True, "server_unix_ms": server_ms}


@app.put("/api/sessions/{subject_id}/records")
def save_record(subject_id: str, record: RecordIn):
    now = datetime.now(timezone.utc).isoformat()
    with DB_LOCK, db() as connection:
        connection.execute(
            "INSERT INTO records (subject_id,record_type,record_key,payload_json,created_at) VALUES (?,?,?,?,?) ON CONFLICT(subject_id,record_type,record_key) DO UPDATE SET payload_json=excluded.payload_json, created_at=excluded.created_at",
            (subject_id, record.record_type, record.record_key, json.dumps(record.payload, ensure_ascii=False), now),
        )
    return {"ok": True}


@app.post("/api/sessions/{subject_id}/complete")
def complete_session(subject_id: str):
    with DB_LOCK, db() as connection:
        connection.execute("UPDATE sessions SET status='completed', updated_at=? WHERE subject_id=?", (datetime.now(timezone.utc).isoformat(), subject_id))
    return {"ok": True}


@app.get("/api/sessions/{subject_id}/export/events.csv")
def export_events(subject_id: str):
    with db() as connection:
        rows = connection.execute("SELECT * FROM events WHERE subject_id=? ORDER BY id", (subject_id,)).fetchall()
    output = io.StringIO()
    headers = ["timestamp_unix_ms", "timestamp_monotonic_ms", "server_unix_ms", "event_code", "event_name", "subject_id", "segment_id", "condition", "payload_json"]
    writer = csv.DictWriter(output, fieldnames=headers)
    writer.writeheader()
    for row in rows:
        writer.writerow({"timestamp_unix_ms": row["timestamp_unix_ms"], "timestamp_monotonic_ms": row["timestamp_monotonic_ms"], "server_unix_ms": row["server_unix_ms"], "event_code": row["event_code"], "event_name": row["event_name"], "subject_id": row["subject_id"], "segment_id": row["segment_id"], "condition": row["condition_name"], "payload_json": row["payload_json"]})
    return Response(output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{subject_id}_events.csv"'})


@app.get("/api/sessions/{subject_id}/export/results.json")
def export_results(subject_id: str):
    with db() as connection:
        session = connection.execute("SELECT * FROM sessions WHERE subject_id=?", (subject_id,)).fetchone()
        records = connection.execute("SELECT record_type,record_key,payload_json,created_at FROM records WHERE subject_id=? ORDER BY id", (subject_id,)).fetchall()
    if not session:
        raise HTTPException(404, "Сессия не найдена")
    payload = session_out(session)
    payload["records"] = [{"record_type": row[0], "record_key": row[1], "payload": json.loads(row[2]), "created_at": row[3]} for row in records]
    return Response(json.dumps(payload, ensure_ascii=False, indent=2), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{subject_id}_results.json"'})


def session_and_records(subject_id: str) -> tuple[sqlite3.Row, list[sqlite3.Row]]:
    with db() as connection:
        session = connection.execute("SELECT * FROM sessions WHERE subject_id=?", (subject_id,)).fetchone()
        records = connection.execute("SELECT record_type,record_key,payload_json,created_at FROM records WHERE subject_id=? ORDER BY id", (subject_id,)).fetchall()
    if not session:
        raise HTTPException(404, "Сессия не найдена")
    return session, records


@app.get("/api/sessions/{subject_id}/export/meta.json")
def export_meta(subject_id: str):
    session, _ = session_and_records(subject_id)
    payload = session_out(session)
    payload["screen_background"] = CONFIG["settings"]["background"]
    payload["viewport_required"] = {"width": 1920, "height": 1080}
    payload["randomization_seed_source"] = "SubjectID"
    payload["settings"] = CONFIG["settings"]
    return Response(json.dumps(payload, ensure_ascii=False, indent=2), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{subject_id}_meta.json"'})


TRIAL_HEADERS = [
    "SubjectID", "Sex", "Age", "VideoID", "VideoOrderPosition", "SegmentWithinVideo", "SegmentGlobal", "SegmentID", "ClipFile", "ClipDuration_ms", "Condition", "ExpectedDifficulty", "LatencyToHint_ms", "HintReadTime_ms", "Satisfaction", "SatisfactionRT_ms", "ProbeAnswerKey", "ProbeAnswerPosition", "ProbeCorrect", "ProbeRT_ms", "T_clipStart_ms", "T_clipEnd_ms", "T_fixation_ms", "T_question_ms", "T_hintRequest_ms", "T_hintShown_ms", "T_hintClosed_ms", "T_recoveryStart_ms", "T_recoveryEnd_ms", "T_answer_ms", "IsPractice"
]


@app.get("/api/sessions/{subject_id}/export/trials.csv")
def export_trials(subject_id: str):
    session, records = session_and_records(subject_id)
    assignment = json.loads(session["assignment_json"])
    trials = {row[1]: json.loads(row[2]) for row in records if row[0] == "trial"}
    segment_map = {item["id"]: item for item in CONFIG["segments"]}
    presented = []
    for video_position, video_id in enumerate(assignment["video_order"], start=1):
        for segment in [item for item in CONFIG["segments"] if item["video_id"] == video_id]:
            presented.append((video_position, segment))
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=TRIAL_HEADERS)
    writer.writeheader()
    for global_position, (video_position, segment) in enumerate(presented, start=1):
        trial = trials.get(segment["id"], {})
        row = {header: "" for header in TRIAL_HEADERS}
        row.update({
            "SubjectID": subject_id, "Sex": session["sex"], "Age": session["age"], "VideoID": segment["video_id"], "VideoOrderPosition": video_position,
            "SegmentWithinVideo": segment["within_video"], "SegmentGlobal": global_position, "SegmentID": segment["id"], "ClipFile": segment["clip_file"],
            "ClipDuration_ms": round(segment["duration_sec"] * 1000), "Condition": assignment["segment_conditions"][segment["id"]], "ExpectedDifficulty": segment["expected_difficulty"], "IsPractice": False,
        })
        row.update({key: trial.get(key, "") for key in TRIAL_HEADERS if key in trial})
        writer.writerow(row)
    return Response(output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{subject_id}_trials.csv"'})


@app.get("/api/sessions/{subject_id}/export/aoi_definitions.json")
def export_aoi(subject_id: str):
    with db() as connection:
        rows = connection.execute("SELECT event_name,payload_json FROM events WHERE subject_id=? ORDER BY id", (subject_id,)).fetchall()
    definitions = []
    seen = set()
    for row in rows:
        payload = json.loads(row["payload_json"])
        for area in payload.get("aoi", []):
            key = (row["event_name"], area.get("name"), area.get("x"), area.get("y"), area.get("w"), area.get("h"))
            if key not in seen:
                seen.add(key)
                definitions.append({"screen": row["event_name"], **area, "viewport": payload.get("viewport")})
    return Response(json.dumps(definitions, ensure_ascii=False, indent=2), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{subject_id}_aoi_definitions.json"'})
