import {
  setAlarmActive,
  setAlarmPreferences,
  stopAlarm,
  testAlarm,
  unlockAlarmAudio,
} from "./alarm.js";
import { startCamera, stopCamera, setMonitoring, updateDetectionConfig } from "./camera.js";
import { resetDetection } from "./detection.js";

const byId = (id) => document.getElementById(id);
let config = null;
let cameraRunning = false;
let monitoring = false;
let latestState = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function setCameraUi(active) {
  cameraRunning = active;
  byId("camera-placeholder").hidden = active;
  byId("camera-dot").classList.toggle("on", active);
  byId("camera-chip-label").textContent = active ? "CAMERA LIVE" : "NO SIGNAL";
  byId("camera-status").textContent = active ? "CAMERA ON" : "CAMERA OFF";
  byId("camera-status").classList.toggle("on", active);
  byId("camera-button").textContent = active ? "Stop camera" : "Start camera";
  byId("test-alarm-button").disabled = !active;
  if (!active) {
    byId("camera-resolution").textContent = "-- × --";
    byId("face-led").classList.remove("on");
    byId("face-status").textContent = "Face not detected";
  }
}

function setMonitoringUi(active) {
  monitoring = active;
  byId("monitor-button").textContent = active ? "Stop monitoring" : "Start monitoring";
  byId("session-label").textContent = active ? "MONITORING ACTIVE" : "SYSTEM STANDBY";
  byId("session-state").classList.toggle("active", active);
  if (!active) {
    setAlarmActive(false);
    updateAlarmUi(false);
    byId("alert-banner").hidden = true;
    byId("driver-status").className = "driver-status normal";
    byId("driver-status-label").textContent = "NORMAL";
    byId("eye-state").textContent = "—";
    byId("closure-duration").textContent = "0.0 s";
    byId("head-status").textContent = "—";
  }
}

function updateAlarmUi(active) {
  const element = byId("alarm-status");
  element.classList.toggle("active", active);
  element.lastElementChild.textContent = active ? "ALARM ACTIVE" : "ALARM OFF";
  byId("alert-banner").hidden = !active;
}

function renderState(state) {
  latestState = state;
  if (!monitoring) return;
  const faceMessage = byId("face-message");
  if (!state.faceDetected) {
    byId("face-led").classList.remove("on");
    byId("face-status").textContent = state.multipleFaces ? "Multiple faces — one person only" : "Face not detected";
    faceMessage.textContent = state.multipleFaces
      ? "Only one face can be monitored at a time"
      : "Position your face in the frame";
    faceMessage.hidden = false;
    byId("ear-readout").textContent = "EAR —";
    byId("eye-state").textContent = "—";
    byId("closure-duration").textContent = "0.0 s";
    byId("head-status").textContent = "—";
    byId("driver-status-label").textContent = state.multipleFaces ? "MULTIPLE FACES" : "NO FACE";
    byId("driver-status").className = "driver-status warning";
    byId("risk-value").textContent = `${Math.round(state.riskScore)}%`;
    byId("risk-bar").style.width = `${state.riskScore}%`;
    byId("perclos-value").textContent = `${Math.round(state.perclos)}%`;
    byId("yawn-count").textContent = String(state.yawnCount);
    setAlarmActive(false);
    updateAlarmUi(false);
    return;
  }
  faceMessage.hidden = true;
  byId("face-led").classList.add("on");
  byId("face-status").textContent = "Face detected";
  byId("ear-readout").textContent = `EAR ${state.ear.toFixed(3)}`;
  byId("eye-state").textContent = state.eyeState;
  byId("eye-state").style.color = state.eyeState === "CLOSED" ? "var(--yellow)" : "";
  byId("closure-duration").textContent = `${state.eyeClosureDuration.toFixed(1)} s`;
  byId("yawn-count").textContent = String(state.yawnCount);
  byId("head-status").textContent = state.headStatus;
  byId("perclos-value").textContent = `${Math.round(state.perclos)}%`;
  byId("risk-value").textContent = `${Math.round(state.riskScore)}%`;
  byId("risk-bar").style.width = `${state.riskScore}%`;
  const severity = state.driverStatus === "CRITICAL" ? "critical"
    : ["DROWSY", "WARNING"].includes(state.driverStatus) ? "warning" : "";
  byId("risk-bar").className = severity;
  byId("driver-status").className = `driver-status ${severity}`;
  byId("driver-status-label").textContent = state.driverStatus;
  setAlarmActive(state.alarmActive);
  updateAlarmUi(state.alarmActive);
  for (const event of state.events) void recordEvent(event);
}

function formatEventName(type) {
  return type.replaceAll("_", " ");
}

function addHistoryRow(event, prepend = true) {
  const body = byId("history-body");
  const emptyRow = body.querySelector(".empty-row");
  if (emptyRow) emptyRow.remove();
  const row = document.createElement("tr");
  const eventCell = document.createElement("td");
  const tag = document.createElement("span");
  tag.className = `event-tag ${event.event_type.toLowerCase().replaceAll("_", "-")}`;
  tag.textContent = formatEventName(event.event_type);
  eventCell.append(tag);
  const timeCell = document.createElement("td");
  timeCell.textContent = new Date(event.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const durationCell = document.createElement("td");
  durationCell.className = "mono";
  durationCell.textContent = `${Number(event.eye_closure_duration).toFixed(1)} s`;
  const riskCell = document.createElement("td");
  riskCell.className = "risk-cell";
  riskCell.textContent = `${Math.round(event.risk_score)}%`;
  const alertCell = document.createElement("td");
  alertCell.className = `alert-cell ${event.alert_status ? "yes" : ""}`;
  alertCell.textContent = event.alert_status ? "ACTIVE" : "—";
  row.append(eventCell, timeCell, durationCell, riskCell, alertCell);
  if (prepend) body.prepend(row);
  else body.append(row);
  while (body.children.length > 100) body.lastElementChild.remove();
}

async function recordEvent(event) {
  try {
    const saved = await api("/api/events", {
      method: "POST",
      body: JSON.stringify(event),
    });
    addHistoryRow(saved);
    updateEventTotal();
  } catch (error) {
    showError(`Could not save detection event: ${error.message}`);
  }
}

function updateEventTotal() {
  const count = byId("history-body").querySelectorAll("tr:not(.empty-row)").length;
  byId("event-total").textContent = `${count} EVENT${count === 1 ? "" : "S"}`;
}

async function loadHistory() {
  const events = await api("/api/history");
  byId("history-body").replaceChildren();
  if (events.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No detection events in this session.";
    row.append(cell);
    byId("history-body").append(row);
  } else {
    for (const event of [...events].reverse()) addHistoryRow(event, false);
  }
  byId("event-total").textContent = `${events.length} EVENT${events.length === 1 ? "" : "S"}`;
}

function showError(message) {
  byId("camera-error").textContent = message;
  byId("camera-error").hidden = false;
}

function hideError() {
  byId("camera-error").textContent = "";
  byId("camera-error").hidden = true;
}

function updateSoundPreferences() {
  setAlarmPreferences({
    sound: byId("sound-toggle").checked,
    voice: byId("voice-toggle").checked,
    cooldown: config.alarm_cooldown_seconds,
  });
}

async function enableCamera() {
  hideError();
  byId("camera-button").disabled = true;
  byId("camera-button").textContent = "Starting camera…";
  try {
    await startCamera(config);
    setCameraUi(true);
    if (monitoring) setMonitoring(true);
  } catch (error) {
    setCameraUi(false);
    showError(error.name === "NotAllowedError"
      ? "Camera permission was denied. Allow camera access in your browser settings, then try again."
      : error.name === "NotFoundError"
        ? "No camera was found. Connect a webcam and try again."
        : error.message);
    if (monitoring) {
      await api("/api/monitoring", { method: "POST", body: JSON.stringify({ active: false }) });
      setMonitoringUi(false);
    }
  } finally {
    byId("camera-button").disabled = false;
    byId("camera-button").textContent = cameraRunning ? "Stop camera" : "Start camera";
  }
}

async function toggleMonitoring() {
  hideError();
  if (monitoring) {
    setMonitoring(false);
    await api("/api/monitoring", { method: "POST", body: JSON.stringify({ active: false }) });
    setMonitoringUi(false);
    return;
  }
  try {
    if (!cameraRunning) await enableCamera();
    if (!cameraRunning) return;
    await api("/api/monitoring", { method: "POST", body: JSON.stringify({ active: true }) });
    setMonitoring(true);
    setMonitoringUi(true);
  } catch (error) {
    showError(`Could not start monitoring: ${error.message}`);
  }
}

async function disableCamera() {
  if (monitoring) {
    await api("/api/monitoring", { method: "POST", body: JSON.stringify({ active: false }) });
  }
  stopCamera();
  setCameraUi(false);
  setMonitoringUi(false);
}

async function saveSettings(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const nextConfig = {};
  for (const [key, value] of formData.entries()) nextConfig[key] = Number(value);
  const message = byId("settings-message");
  message.textContent = "";
  try {
    config = await api("/api/config", { method: "PUT", body: JSON.stringify(nextConfig) });
    updateDetectionConfig(config);
    updateSoundPreferences();
    message.textContent = "Settings saved.";
  } catch (error) {
    message.textContent = error.message;
    message.style.color = "var(--red)";
  }
}

async function initialize() {
  try {
    config = await api("/api/config");
    const form = byId("settings-form");
    for (const [key, value] of Object.entries(config)) {
      if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
    }
    updateSoundPreferences();
    await loadHistory();
  } catch (error) {
    showError(`Could not initialize the dashboard: ${error.message}`);
  }
}

byId("monitor-button").addEventListener("click", () => {
  unlockAlarmAudio();
  void toggleMonitoring();
});
byId("camera-button").addEventListener("click", () => {
  unlockAlarmAudio();
  if (cameraRunning) void disableCamera();
  else void enableCamera();
});
byId("test-alarm-button").addEventListener("click", testAlarm);
byId("sound-toggle").addEventListener("change", updateSoundPreferences);
byId("voice-toggle").addEventListener("change", updateSoundPreferences);
byId("settings-form").addEventListener("submit", (event) => void saveSettings(event));
byId("reset-button").addEventListener("click", async () => {
  try {
    await api("/api/reset", { method: "POST", body: "{}" });
    resetDetection();
    await loadHistory();
  } catch (error) {
    showError(`Could not reset statistics: ${error.message}`);
  }
});
window.addEventListener("detection:update", (event) => renderState(event.detail));
window.addEventListener("beforeunload", () => {
  stopAlarm();
  stopCamera();
});
window.setInterval(() => {
  byId("clock").textContent = new Date().toLocaleTimeString([], { hour12: false });
}, 1000);
void initialize();
