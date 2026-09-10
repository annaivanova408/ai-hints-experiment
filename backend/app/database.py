from __future__ import annotations

import os
from contextlib import contextmanager

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    MetaData,
    String,
    Table,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.dialects.postgresql import JSONB


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./experiment.sqlite3")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=connect_args)
metadata = MetaData()
json_type = JSON().with_variant(JSONB(), "postgresql")

sessions = Table(
    "sessions",
    metadata,
    Column("subject_id", String(64), primary_key=True),
    Column("sex", String(32), nullable=False),
    Column("age", Integer, nullable=False),
    Column("education", String(120), nullable=False),
    Column("assignment_json", json_type, nullable=False),
    Column("state_json", json_type, nullable=False),
    Column("status", String(20), nullable=False, default="active"),
    Column("config_version", String(80), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

events = Table(
    "events",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("subject_id", String(64), ForeignKey("sessions.subject_id", ondelete="CASCADE"), nullable=False),
    Column("timestamp_unix_ms", BigInteger, nullable=False),
    Column("timestamp_monotonic_ms", Float, nullable=False),
    Column("server_unix_ms", BigInteger, nullable=False),
    Column("event_code", Integer, nullable=False),
    Column("event_name", String(80), nullable=False),
    Column("segment_id", String(64)),
    Column("condition_name", String(20)),
    Column("payload_json", json_type, nullable=False),
)
Index("ix_events_subject", events.c.subject_id, events.c.id)

records = Table(
    "records",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("subject_id", String(64), ForeignKey("sessions.subject_id", ondelete="CASCADE"), nullable=False),
    Column("record_type", String(40), nullable=False),
    Column("record_key", String(100), nullable=False),
    Column("payload_json", json_type, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("subject_id", "record_type", "record_key", name="uq_records_subject_type_key"),
)


def init_db() -> None:
    metadata.create_all(engine)


@contextmanager
def transaction():
    with engine.begin() as connection:
        yield connection
