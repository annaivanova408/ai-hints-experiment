from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, insert, select, text

from .database import engine, events, init_db, records, sessions, transaction


SOURCE_PATH = Path(os.getenv("SQLITE_SOURCE_PATH", "/data/experiment.sqlite3"))
TABLES = (sessions, events, records)


def decode_json(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def decode_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


def sqlite_rows(connection: sqlite3.Connection, table_name: str) -> list[sqlite3.Row]:
    return connection.execute(f"SELECT * FROM {table_name} ORDER BY rowid").fetchall()


def target_counts(connection) -> dict[str, int]:
    return {
        table.name: connection.execute(select(func.count()).select_from(table)).scalar_one()
        for table in TABLES
    }


def reset_sequence(connection, table_name: str) -> None:
    connection.execute(
        text(
            f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), "
            f"COALESCE((SELECT MAX(id) FROM {table_name}), 1), "
            f"EXISTS(SELECT 1 FROM {table_name}))"
        )
    )


def migrate() -> None:
    if engine.dialect.name != "postgresql":
        raise RuntimeError("Миграцию нужно запускать с DATABASE_URL для PostgreSQL")
    if not SOURCE_PATH.exists():
        raise RuntimeError(f"Исходная SQLite база не найдена: {SOURCE_PATH}")

    source = sqlite3.connect(SOURCE_PATH)
    source.row_factory = sqlite3.Row
    try:
        source_data = {table.name: sqlite_rows(source, table.name) for table in TABLES}
    finally:
        source.close()

    source_counts = {name: len(rows) for name, rows in source_data.items()}
    init_db()
    with transaction() as connection:
        existing_counts = target_counts(connection)
        if any(existing_counts.values()):
            raise RuntimeError(
                "PostgreSQL уже содержит данные. Чтобы исключить перезапись, миграция остановлена. "
                f"SQLite={source_counts}, PostgreSQL={existing_counts}."
            )

        if source_data["sessions"]:
            connection.execute(
                insert(sessions),
                [
                    {
                        **dict(row),
                        "assignment_json": decode_json(row["assignment_json"]),
                        "state_json": decode_json(row["state_json"]),
                        "created_at": decode_datetime(row["created_at"]),
                        "updated_at": decode_datetime(row["updated_at"]),
                    }
                    for row in source_data["sessions"]
                ],
            )
        if source_data["events"]:
            connection.execute(
                insert(events),
                [
                    {**dict(row), "payload_json": decode_json(row["payload_json"])}
                    for row in source_data["events"]
                ],
            )
        if source_data["records"]:
            connection.execute(
                insert(records),
                [
                    {
                        **dict(row),
                        "payload_json": decode_json(row["payload_json"]),
                        "created_at": decode_datetime(row["created_at"]),
                    }
                    for row in source_data["records"]
                ],
            )

        reset_sequence(connection, "events")
        reset_sequence(connection, "records")
        migrated_counts = target_counts(connection)
        if migrated_counts != source_counts:
            raise RuntimeError(
                f"Количество строк после миграции не совпало: SQLite={source_counts}, PostgreSQL={migrated_counts}"
            )

    print(f"[migration] Готово: {source_counts}")


if __name__ == "__main__":
    migrate()
