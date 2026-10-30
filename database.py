"""SQLite persistence for dashboard settings and detection event metadata."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

DEFAULT_CONFIG: dict[str, int | float] = {
    "ear_threshold": 0.22,
    "eye_closure_seconds": 1.8,
    "perclos_window_seconds": 60,
    "risk_threshold": 65,
    "yawning_detection_threshold": 0.65,
    "yawning_count_threshold": 3,
    "alarm_cooldown_seconds": 5,
    "head_tilt_degrees": 18,
}


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS detection_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    eye_closure_duration REAL NOT NULL,
                    risk_score REAL NOT NULL,
                    alert_status INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_events_timestamp
                    ON detection_events(timestamp DESC);
                """
            )
            for key, value in DEFAULT_CONFIG.items():
                connection.execute(
                    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                    (key, json.dumps(value)),
                )

    def get_config(self) -> dict[str, int | float]:
        with self._connect() as connection:
            rows = connection.execute("SELECT key, value FROM settings").fetchall()
        config = dict(DEFAULT_CONFIG)
        config.update({row["key"]: json.loads(row["value"]) for row in rows})
        return config

    def save_config(self, config: dict[str, int | float]) -> None:
        with self._connect() as connection:
            connection.executemany(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [(key, json.dumps(value)) for key, value in config.items()],
            )

    def add_event(
        self,
        event_type: str,
        eye_closure_duration: float,
        risk_score: float,
        alert_status: bool,
    ) -> dict[str, Any]:
        timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO detection_events
                    (event_type, timestamp, eye_closure_duration, risk_score, alert_status)
                VALUES (?, ?, ?, ?, ?)
                """,
                (event_type, timestamp, eye_closure_duration, risk_score, int(alert_status)),
            )
            event_id = cursor.lastrowid
        return {
            "id": event_id,
            "event_type": event_type,
            "timestamp": timestamp,
            "eye_closure_duration": eye_closure_duration,
            "risk_score": risk_score,
            "alert_status": alert_status,
        }

    def get_events(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, event_type, timestamp, eye_closure_duration, risk_score, alert_status
                FROM detection_events
                ORDER BY id DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            {
                **dict(row),
                "alert_status": bool(row["alert_status"]),
            }
            for row in rows
        ]

    def get_statistics(self, monitoring_active: bool) -> dict[str, Any]:
        with self._connect() as connection:
            total = connection.execute("SELECT COUNT(*) FROM detection_events").fetchone()[0]
            grouped = connection.execute(
                "SELECT event_type, COUNT(*) AS count FROM detection_events GROUP BY event_type"
            ).fetchall()
            latest = connection.execute(
                "SELECT risk_score FROM detection_events ORDER BY id DESC LIMIT 1"
            ).fetchone()
        return {
            "total_events": total,
            "events_by_type": {row["event_type"]: row["count"] for row in grouped},
            "latest_risk_score": latest["risk_score"] if latest else 0,
            "monitoring_active": monitoring_active,
        }

    def clear_events(self) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM detection_events")
            connection.execute("DELETE FROM sqlite_sequence WHERE name = 'detection_events'")
