from __future__ import annotations

import csv
import base64
import hashlib
import hmac
import io
import itertools
import json
import os
import random
import socket
import sqlite3
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from mutagen.mp4 import MP4
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .database import engine, events, init_db, records, sessions, transaction


APP_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = Path(os.getenv("CONFIG_PATH", PROJECT_ROOT / "data" / "stimuli.json"))
if not DATA_PATH.exists():
    DATA_PATH = APP_ROOT / "data" / "stimuli.json"
CONFIG = json.loads(DATA_PATH.read_text(encoding="utf-8"))
CONFIG_VERSION = CONFIG["config_version"]
CONDITIONS = ("AI", "EXPERT", "CONTROL")
VIDEO_PERMUTATIONS = list(itertools.permutations(CONFIG["video_ids"]))
NASA_PERMUTATIONS = list(itertools.permutations(CONDITIONS))
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")
ADMIN_SECRET_KEY = os.getenv("ADMIN_SECRET_KEY", ADMIN_PASSWORD)
ADMIN_TOKEN_TTL_SEC = 12 * 60 * 60


app = FastAPI(title="Эксперимент с комментариями", version="0.1.0")
CLIPS_PATH = Path(os.getenv("CLIPS_PATH", PROJECT_ROOT / "clips"))
app.mount("/clips", StaticFiles(directory=CLIPS_PATH, check_dir=False), name="clips")


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


class AdminLoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)


def create_admin_token() -> str:
    expires_at = int(time.time()) + ADMIN_TOKEN_TTL_SEC
    payload = str(expires_at)
    signature = hmac.new(ADMIN_SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}.{signature}".encode()).decode()


def require_admin(authorization: str | None = Header(default=None)) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Требуется вход администратора")
    try:
        decoded = base64.urlsafe_b64decode(authorization.removeprefix("Bearer ").encode()).decode()
        expires_at, signature = decoded.split(".", 1)
        expected = hmac.new(ADMIN_SECRET_KEY.encode(), expires_at.encode(), hashlib.sha256).hexdigest()
        valid = hmac.compare_digest(signature, expected) and int(expires_at) >= int(time.time())
    except (ValueError, UnicodeDecodeError):
        valid = False
    if not valid:
        raise HTTPException(401, "Сессия администратора истекла")


def stable_seed(subject_id: str, namespace: str) -> int:
    digest = hashlib.sha256(f"{subject_id}:{namespace}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def decode_json(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def assignment_values(connection) -> list[Any]:
    if isinstance(connection, sqlite3.Connection):
        return [row[0] for row in connection.execute("SELECT assignment_json FROM sessions")]
    return list(connection.execute(select(sessions.c.assignment_json)).scalars())


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
    for value in assignment_values(connection):
        assignment = decode_json(value)
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
    for value in assignment_values(connection):
        assignment = decode_json(value)
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
                errors.append(f"{item['id']}: отсутствует комментарий {condition}")
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


def session_out(row) -> dict[str, Any]:
    result = {
        "subject_id": row["subject_id"],
        "sex": row["sex"],
        "age": row["age"],
        "education": row["education"],
        "assignment": decode_json(row["assignment_json"]),
        "state": decode_json(row["state_json"]),
        "status": row["status"],
        "config_version": row["config_version"],
    }
    if "created_at" in row.keys():
        result["created_at"] = row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else row["created_at"]
        result["updated_at"] = row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else row["updated_at"]
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
    with transaction() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ok", "config_version": CONFIG_VERSION}


@app.get("/api/config")
def get_config():
    return CONFIG


@app.post("/api/admin/login")
def admin_login(data: AdminLoginIn):
    if not hmac.compare_digest(data.password, ADMIN_PASSWORD):
        raise HTTPException(401, "Неверный пароль")
    return {"token": create_admin_token(), "expires_in": ADMIN_TOKEN_TTL_SEC}


@app.get("/api/admin/sessions")
def admin_sessions(_: None = Depends(require_admin)):
    event_count = select(func.count()).where(events.c.subject_id == sessions.c.subject_id).scalar_subquery()
    record_count = select(func.count()).where(records.c.subject_id == sessions.c.subject_id).scalar_subquery()
    statement = select(
        sessions,
        event_count.label("event_count"),
        record_count.label("record_count"),
    ).order_by(sessions.c.updated_at.desc())
    with transaction() as connection:
        rows = connection.execute(statement).mappings().all()
    return [
        {
            **session_out(row),
            "event_count": row["event_count"],
            "record_count": row["record_count"],
        }
        for row in rows
    ]


@app.post("/api/sessions")
def start_session(data: StartIn):
    if not data.consent_confirmed:
        raise HTTPException(422, "Подтвердите, что информированное согласие оформлено отдельно")
    now = datetime.now(timezone.utc)
    subject_id = data.subject_id.strip()
    with transaction() as connection:
        if engine.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(73194721)"))
        existing = connection.execute(select(sessions).where(sessions.c.subject_id == subject_id)).mappings().first()
        if existing:
            return session_out(existing)
        assignment = build_assignment(connection, subject_id)
        state = {"screen": "instructions", "video_position": 0, "segment_position": 0}
        connection.execute(
            insert(sessions).values(
                subject_id=subject_id,
                sex=data.sex,
                age=data.age,
                education=data.education,
                assignment_json=assignment,
                state_json=state,
                status="active",
                config_version=CONFIG_VERSION,
                created_at=now,
                updated_at=now,
            )
        )
        row = connection.execute(select(sessions).where(sessions.c.subject_id == subject_id)).mappings().first()
    return session_out(row)


@app.get("/api/sessions/{subject_id}")
def get_session(subject_id: str):
    with transaction() as connection:
        row = connection.execute(select(sessions).where(sessions.c.subject_id == subject_id)).mappings().first()
    if not row:
        raise HTTPException(404, "Сессия не найдена")
    return session_out(row)


@app.put("/api/sessions/{subject_id}/state")
def save_state(subject_id: str, data: StateIn):
    now = datetime.now(timezone.utc)
    with transaction() as connection:
        cursor = connection.execute(
            update(sessions)
            .where(sessions.c.subject_id == subject_id)
            .values(state_json=data.state, updated_at=now)
        )
        if not cursor.rowcount:
            raise HTTPException(404, "Сессия не найдена")
    return {"ok": True}


@app.post("/api/sessions/{subject_id}/events")
def add_event(subject_id: str, event: EventIn):
    server_ms = int(time.time() * 1000)
    with transaction() as connection:
        if not connection.execute(select(sessions.c.subject_id).where(sessions.c.subject_id == subject_id)).first():
            raise HTTPException(404, "Сессия не найдена")
        connection.execute(
            insert(events).values(
                subject_id=subject_id,
                timestamp_unix_ms=event.timestamp_unix_ms,
                timestamp_monotonic_ms=event.timestamp_monotonic_ms,
                server_unix_ms=server_ms,
                event_code=event.event_code,
                event_name=event.event_name,
                segment_id=event.segment_id,
                condition_name=event.condition,
                payload_json=event.payload,
            )
        )
    emit_udp(event, subject_id)
    return {"ok": True, "server_unix_ms": server_ms}


@app.put("/api/sessions/{subject_id}/records")
def save_record(subject_id: str, record: RecordIn):
    now = datetime.now(timezone.utc)
    insert_factory = postgresql_insert if engine.dialect.name == "postgresql" else sqlite_insert
    statement = insert_factory(records).values(
        subject_id=subject_id,
        record_type=record.record_type,
        record_key=record.record_key,
        payload_json=record.payload,
        created_at=now,
    )
    statement = statement.on_conflict_do_update(
        index_elements=[records.c.subject_id, records.c.record_type, records.c.record_key],
        set_={"payload_json": record.payload, "created_at": now},
    )
    with transaction() as connection:
        if not connection.execute(select(sessions.c.subject_id).where(sessions.c.subject_id == subject_id)).first():
            raise HTTPException(404, "Сессия не найдена")
        connection.execute(
            statement
        )
    return {"ok": True}


@app.post("/api/sessions/{subject_id}/complete")
def complete_session(subject_id: str):
    with transaction() as connection:
        cursor = connection.execute(
            update(sessions)
            .where(sessions.c.subject_id == subject_id)
            .values(status="completed", updated_at=datetime.now(timezone.utc))
        )
        if not cursor.rowcount:
            raise HTTPException(404, "Сессия не найдена")
    return {"ok": True}


@app.get("/api/sessions/{subject_id}/export/events.csv")
def export_events(subject_id: str, _: None = Depends(require_admin)):
    with transaction() as connection:
        rows = connection.execute(select(events).where(events.c.subject_id == subject_id).order_by(events.c.id)).mappings().all()
    output = io.StringIO()
    headers = ["timestamp_unix_ms", "timestamp_monotonic_ms", "server_unix_ms", "event_code", "event_name", "subject_id", "segment_id", "condition", "payload_json"]
    writer = csv.DictWriter(output, fieldnames=headers)
    writer.writeheader()
    for row in rows:
        writer.writerow({"timestamp_unix_ms": row["timestamp_unix_ms"], "timestamp_monotonic_ms": row["timestamp_monotonic_ms"], "server_unix_ms": row["server_unix_ms"], "event_code": row["event_code"], "event_name": row["event_name"], "subject_id": row["subject_id"], "segment_id": row["segment_id"], "condition": row["condition_name"], "payload_json": json.dumps(decode_json(row["payload_json"]), ensure_ascii=False)})
    return Response(output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{subject_id}_events.csv"'})


@app.get("/api/sessions/{subject_id}/export/results.json")
def export_results(subject_id: str, _: None = Depends(require_admin)):
    with transaction() as connection:
        session = connection.execute(select(sessions).where(sessions.c.subject_id == subject_id)).mappings().first()
        result_rows = connection.execute(select(records).where(records.c.subject_id == subject_id).order_by(records.c.id)).mappings().all()
    if not session:
        raise HTTPException(404, "Сессия не найдена")
    payload = session_out(session)
    payload["records"] = [{"record_type": row["record_type"], "record_key": row["record_key"], "payload": decode_json(row["payload_json"]), "created_at": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else row["created_at"]} for row in result_rows]
    return Response(json.dumps(payload, ensure_ascii=False, indent=2), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{subject_id}_results.json"'})


def session_and_records(subject_id: str):
    with transaction() as connection:
        session = connection.execute(select(sessions).where(sessions.c.subject_id == subject_id)).mappings().first()
        result_rows = connection.execute(select(records).where(records.c.subject_id == subject_id).order_by(records.c.id)).mappings().all()
    if not session:
        raise HTTPException(404, "Сессия не найдена")
    return session, result_rows


@app.get("/api/sessions/{subject_id}/export/meta.json")
def export_meta(subject_id: str, _: None = Depends(require_admin)):
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
def export_trials(subject_id: str, _: None = Depends(require_admin)):
    session, result_rows = session_and_records(subject_id)
    assignment = decode_json(session["assignment_json"])
    trials = {row["record_key"]: decode_json(row["payload_json"]) for row in result_rows if row["record_type"] == "trial"}
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
def export_aoi(subject_id: str, _: None = Depends(require_admin)):
    with transaction() as connection:
        rows = connection.execute(select(events.c.event_name, events.c.payload_json).where(events.c.subject_id == subject_id).order_by(events.c.id)).mappings().all()
    definitions = []
    seen = set()
    for row in rows:
        payload = decode_json(row["payload_json"])
        for area in payload.get("aoi", []):
            key = (row["event_name"], area.get("name"), area.get("x"), area.get("y"), area.get("w"), area.get("h"))
            if key not in seen:
                seen.add(key)
                definitions.append({"screen": row["event_name"], **area, "viewport": payload.get("viewport")})
    return Response(json.dumps(definitions, ensure_ascii=False, indent=2), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{subject_id}_aoi_definitions.json"'})


def build_export_archive(subject_ids: list[str]) -> bytes:
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        summary = io.StringIO()
        writer = csv.writer(summary)
        writer.writerow(["subject_id", "sex", "age", "education", "status", "created_at", "updated_at"])
        with transaction() as connection:
            rows = connection.execute(
                select(sessions).where(sessions.c.subject_id.in_(subject_ids)).order_by(sessions.c.created_at)
            ).mappings().all()
        for row in rows:
            writer.writerow([
                row["subject_id"], row["sex"], row["age"], row["education"], row["status"],
                row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else row["created_at"],
                row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else row["updated_at"],
            ])
        archive.writestr("participants.csv", summary.getvalue().encode("utf-8-sig"))
        exporters = (
            ("trials.csv", export_trials),
            ("events.csv", export_events),
            ("meta.json", export_meta),
            ("aoi_definitions.json", export_aoi),
            ("results.json", export_results),
        )
        for subject_id in subject_ids:
            for filename, exporter in exporters:
                response = exporter(subject_id, None)
                archive.writestr(f"{subject_id}/{filename}", response.body)
    return archive_buffer.getvalue()


@app.get("/api/admin/export.zip")
def admin_export_all(_: None = Depends(require_admin)):
    with transaction() as connection:
        subject_ids = list(connection.execute(select(sessions.c.subject_id).order_by(sessions.c.created_at)).scalars())
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return Response(
        build_export_archive(subject_ids),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="experiment-{stamp}.zip"'},
    )


NASA_TITLES = {item["id"]: item["title"] for item in CONFIG["nasa"]}
MANIPULATION_TITLES = {
    "ai": "Комментарии «ИИ-помощник» действительно от ИИ",
    "expert": "Комментарии «Эксперт» действительно от человека",
}


def _answer_row(item, condition, answer, rating):
    """Один вопрос глазами исследователя: что показали и что отметил участник."""
    options = item["options"]
    selected = (answer or {}).get("selected")
    return {
        "id": item["id"],
        "segment_id": item.get("segment_id", item["id"]),
        "video_id": item["video_id"],
        "topic": item.get("topic"),
        "condition": condition,
        "stem": item["stem"],
        "answered": bool(answer),
        "selected": selected,
        "selected_text": options.get(selected) if selected else None,
        "correct": item["correct"],
        "correct_text": options.get(item["correct"]),
        "is_correct": (answer or {}).get("is_correct"),
        "timeout": (answer or {}).get("timeout", False),
        "rt_ms": (answer or {}).get("rt_ms"),
        "satisfaction": (rating or {}).get("value"),
    }


@app.get("/api/admin/sessions/{subject_id}/detail")
def admin_session_detail(subject_id: str, _: None = Depends(require_admin)):
    """Всё, что участник отметил, по порядку прохождения."""
    session, result_rows = session_and_records(subject_id)
    assignment = decode_json(session["assignment_json"])
    conditions = assignment.get("segment_conditions", {})
    by_type: dict[str, dict[str, Any]] = {}
    for row in result_rows:
        by_type.setdefault(row["record_type"], {})[row["record_key"]] = decode_json(row["payload_json"])

    segments = []
    for video_position, video_id in enumerate(assignment["video_order"], start=1):
        for segment in [item for item in CONFIG["segments"] if item["video_id"] == video_id]:
            segments.append({
                **_answer_row(
                    segment,
                    conditions.get(segment["id"]),
                    by_type.get("segment_answer", {}).get(segment["id"]),
                    by_type.get("hint_rating", {}).get(segment["id"]),
                ),
                "video_position": video_position,
                "within_video": segment["within_video"],
            })

    final = [
        _answer_row(
            item,
            conditions.get(item["segment_id"]),
            by_type.get("final_answer", {}).get(item["id"]),
            None,
        )
        for item in CONFIG["final_test"]
    ]

    video_ratings = [
        {"video_id": video_id, "position": position, "value": (by_type.get("video_rating", {}).get(video_id) or {}).get("value")}
        for position, video_id in enumerate(assignment["video_order"], start=1)
    ]
    nasa = [
        {"key": key, "condition": payload.get("condition"), "item_id": payload.get("item_id"),
         "title": NASA_TITLES.get(payload.get("item_id"), payload.get("item_id")), "value": payload.get("value")}
        for key, payload in sorted(by_type.get("nasa", {}).items())
    ]
    manipulation = [
        {"key": key, "title": MANIPULATION_TITLES.get(key, key), "value": payload.get("value")}
        for key, payload in sorted(by_type.get("manipulation", {}).items())
    ]

    answered = sum(1 for item in segments if item["answered"])
    correct = sum(1 for item in segments if item["is_correct"])
    final_answered = sum(1 for item in final if item["answered"])
    final_correct = sum(1 for item in final if item["is_correct"])
    return {
        "session": session_out(session),
        "totals": {
            "segments": len(segments), "segments_answered": answered, "segments_correct": correct,
            "final": len(final), "final_answered": final_answered, "final_correct": final_correct,
        },
        "segments": segments,
        "final": final,
        "video_ratings": video_ratings,
        "nasa": nasa,
        "manipulation": manipulation,
    }


@app.delete("/api/admin/sessions/{subject_id}")
def admin_delete_session(subject_id: str, _: None = Depends(require_admin)):
    """Полное удаление участника: сессия, её события и ответы. Необратимо."""
    with transaction() as connection:
        exists = connection.execute(select(sessions.c.subject_id).where(sessions.c.subject_id == subject_id)).first()
        if not exists:
            raise HTTPException(404, "Сессия не найдена")
        deleted_events = connection.execute(delete(events).where(events.c.subject_id == subject_id)).rowcount
        deleted_records = connection.execute(delete(records).where(records.c.subject_id == subject_id)).rowcount
        connection.execute(delete(sessions).where(sessions.c.subject_id == subject_id))
    return {"subject_id": subject_id, "deleted_events": deleted_events, "deleted_records": deleted_records}


@app.get("/api/admin/sessions/{subject_id}/export.zip")
def admin_export_subject(subject_id: str, _: None = Depends(require_admin)):
    with transaction() as connection:
        exists = connection.execute(select(sessions.c.subject_id).where(sessions.c.subject_id == subject_id)).first()
    if not exists:
        raise HTTPException(404, "Сессия не найдена")
    return Response(
        build_export_archive([subject_id]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{subject_id}.zip"'},
    )
