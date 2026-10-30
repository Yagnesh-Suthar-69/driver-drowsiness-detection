# DriveAware — Driver Drowsiness Detection

A Flask dashboard for a real-time driver-monitoring prototype. The browser accesses the camera and runs MediaPipe Face Landmarker locally; Flask receives detection-event metadata only and keeps dashboard settings and event history in memory. Camera images and video frames are not sent to the server. No database or database file is used.

> **Safety notice:** This is an educational prototype, not a certified automotive safety device. Thresholds and fatigue cues have not been validated for real driving. Lighting, glasses, camera position, and individual differences can cause missed detections or false alarms. Never rely on this system as the sole protection against driver fatigue, and do not interact with the dashboard while driving.

## Requirements

- Python 3.10 or later
- A modern browser with camera access, WebAssembly, and Web Audio API support
- Internet access when loading the MediaPipe Tasks Vision JavaScript library and Face Landmarker model
- A webcam (built-in or USB)

The model is downloaded by the browser from Google's public MediaPipe model hosting when the camera is started; it is not bundled in this repository. Camera permission is available on `localhost`. The app uses Google's CDN for the MediaPipe JavaScript/WASM runtime and model, so the first session requires internet access.

## Install and run on Windows

From this directory, open PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000), allow camera access, and select **Start monitoring**. **Start camera** can also be used to preview the camera without running detection. If the PowerShell activation policy prevents activation, run `.venv\Scripts\python.exe -m pip install -r requirements.txt` and `.venv\Scripts\python.exe app.py`.

## Install and run on macOS/Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python app.py
```

Then open `http://127.0.0.1:5000` in a browser and allow camera access.

## Detection and controls

- **Eyes:** computes the standard six-landmark-per-eye Eye Aspect Ratio (EAR) and times continuous closure. The initial EAR threshold is `0.22`; the initial alarm duration is `1.8 s`.
- **Yawning:** compares vertical mouth opening with mouth width, counts detected openings over a rolling five-minute period, and raises fatigue risk for repeated yawns.
- **Head movement:** estimates eye-line tilt and changes in nose position relative to face height. A sustained tilt/drop is an approximate cue, not a validated pose or fatigue measurement.
- **PERCLOS:** estimates the fraction of sampled face-visible frames with closed eyes in a rolling window (default `60 s`). Frames where no single face is visible are excluded.
- **Fatigue risk:** a heuristic percentage combining closure duration, PERCLOS, recent yawns, and sustained head movement. It is not a probability or medical measurement.
- **Alerts:** the browser plays a Web Audio tone while a drowsy condition remains active, repeating at the configured cooldown; optional browser speech alerts are available. Use **Test alarm** to verify browser audio.
- **Landmarks:** eye, mouth, and nose points are drawn over the local camera preview. The system pauses measurements if no face or multiple faces are present to avoid attributing measurements to an ambiguous person.
- **Statistics:** detection event metadata and thresholds are held in memory while the Flask process runs. The latest 100 events appear in the history. Settings and event history reset when the server restarts; use **Reset statistics** to clear event history before then.

Open **Detection settings** in the dashboard to change the EAR threshold, eye-closure alarm duration, PERCLOS window, risk threshold, yawn ratio/count threshold, alarm cooldown, and head-tilt threshold. Values are validated by the Flask API before being saved.

## Project layout

```text
app.py
requirements.txt
templates/
  index.html
static/
  css/style.css
  js/
    alarm.js
    camera.js
    dashboard.js
    detection.js
```

The Face Landmarker task file is fetched at runtime from Google's model host rather than copied into `models/`. The webcam is opened and processed by the browser; Flask never receives image frames.
