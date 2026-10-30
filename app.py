"""Flask dashboard for browser-based driver drowsiness monitoring."""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
state_lock = threading.Lock()
monitoring_active = False
config: dict[str, int | float] = {
    "ear_threshold": 0.22,
    "eye_closure_seconds": 1.8,
    "perclos_window_seconds": 60,
    "risk_threshold": 65,
    "yawning_detection_threshold": 0.65,
    "yawning_count_threshold": 3,
    "alarm_cooldown_seconds": 5,
    "head_tilt_degrees": 18,
}
events: list[dict[str, Any]] = []
events_by_type: dict[str, int] = {}
next_event_id = 1

CONFIG_LIMITS = {
    "ear_threshold": (0.10, 0.40),
    "eye_closure_seconds": (0.5, 5.0),
    "perclos_window_seconds": (15, 300),
    "risk_threshold": (10, 100),
    "yawning_detection_threshold": (0.2, 1.5),
    "yawning_count_threshold": (2, 10),
    "alarm_cooldown_seconds": (1, 30),
    "head_tilt_degrees": (10, 40),
}
EVENT_TYPES = {"EYE_CLOSURE", "YAWN", "HEAD_DROP", "PERCLOS", "DROWSINESS", "CRITICAL"}


def _number(value: Any, name: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number.")
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum:g} and {maximum:g}.")
    return float(value)


@app.get("/")
def dashboard() -> str:
    return render_template("index.html")


@app.get("/api/config")
def get_config() -> Any:
    with state_lock:
        return jsonify(config)


@app.put("/api/config")
def update_config() -> Any:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Expected a JSON object."), 400
    try:
        with state_lock:
            updated = dict(config)
        for key, (minimum, maximum) in CONFIG_LIMITS.items():
            if key in payload:
                updated[key] = _number(payload[key], key, minimum, maximum)
        if "perclos_window_seconds" in payload:
            updated["perclos_window_seconds"] = int(updated["perclos_window_seconds"])
        if "risk_threshold" in payload:
            updated["risk_threshold"] = int(updated["risk_threshold"])
        if "yawning_count_threshold" in payload:
            updated["yawning_count_threshold"] = int(updated["yawning_count_threshold"])
    except ValueError as error:
        return jsonify(error=str(error)), 400
    with state_lock:
        config.update(updated)
    return jsonify(updated)


@app.get("/api/history")
def get_history() -> Any:
    with state_lock:
        return jsonify(list(reversed(events)))


@app.get("/api/statistics")
def get_statistics() -> Any:
    with state_lock:
        active = monitoring_active
        total = sum(events_by_type.values())
        latest_risk_score = events[0]["risk_score"] if events else 0
        statistics = {
            "total_events": total,
            "events_by_type": dict(events_by_type),
            "latest_risk_score": latest_risk_score,
            "monitoring_active": active,
        }
    return jsonify(statistics)


@app.post("/api/events")
def create_event() -> Any:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Expected a JSON object."), 400
    event_type = payload.get("event_type")
    if event_type not in EVENT_TYPES:
        return jsonify(error="Unsupported event_type."), 400
    try:
        duration = _number(payload.get("eye_closure_duration", 0), "eye_closure_duration", 0, 3600)
        risk = _number(payload.get("risk_score", 0), "risk_score", 0, 100)
    except ValueError as error:
        return jsonify(error=str(error)), 400
    alert_status = payload.get("alert_status", False)
    if not isinstance(alert_status, bool):
        return jsonify(error="alert_status must be a boolean."), 400
    global next_event_id
    with state_lock:
        event = {
            "id": next_event_id,
            "event_type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "eye_closure_duration": duration,
            "risk_score": risk,
            "alert_status": alert_status,
        }
        next_event_id += 1
        events.insert(0, event)
        del events[100:]
        events_by_type[event_type] = events_by_type.get(event_type, 0) + 1
    return jsonify(event), 201


@app.post("/api/monitoring")
def set_monitoring() -> Any:
    global monitoring_active
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get("active"), bool):
        return jsonify(error="Expected an active boolean."), 400
    with state_lock:
        monitoring_active = payload["active"]
        active = monitoring_active
    return jsonify(monitoring_active=active)


@app.post("/api/reset")
def reset_history() -> Any:
    global next_event_id
    with state_lock:
        events.clear()
        events_by_type.clear()
        next_event_id = 1
    return jsonify(success=True)


@app.errorhandler(500)
def internal_error(_error: Exception) -> Any:
    app.logger.exception("An unexpected server error occurred")
    return jsonify(error="An unexpected server error occurred."), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
