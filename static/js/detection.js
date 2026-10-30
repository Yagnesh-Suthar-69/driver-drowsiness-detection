const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];
const DEFAULTS = {
  ear_threshold: 0.22,
  eye_closure_seconds: 1.8,
  perclos_window_seconds: 60,
  risk_threshold: 65,
  yawning_detection_threshold: 0.65,
  yawning_count_threshold: 3,
  alarm_cooldown_seconds: 5,
  head_tilt_degrees: 18,
};

let config = { ...DEFAULTS };
let closedSince = null;
let lastSampleAt = 0;
let eyeSamples = [];
let yawnSince = null;
let yawnActive = false;
let yawns = [];
let headSince = null;
let headActive = false;
let headBaseline = null;
let perclosLatched = false;
let priorStatus = "NORMAL";
let closureLatched = false;

function pointDistance(a, b, width, height) {
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
}

function eyeAspectRatio(landmarks, indices, width, height) {
  const points = indices.map((index) => landmarks[index]);
  const horizontal = pointDistance(points[0], points[3], width, height);
  if (!horizontal) return 0;
  const verticalOne = pointDistance(points[1], points[5], width, height);
  const verticalTwo = pointDistance(points[2], points[4], width, height);
  return (verticalOne + verticalTwo) / (2 * horizontal);
}

function resetTransientState() {
  closedSince = null;
  closureLatched = false;
  yawnSince = null;
  yawnActive = false;
  headSince = null;
  headActive = false;
  priorStatus = "NORMAL";
}

function noFace(now, multipleFaces = false) {
  resetTransientState();
  return {
    faceDetected: false,
    multipleFaces,
    eyeState: "—",
    eyeClosureDuration: 0,
    yawnCount: yawns.filter((time) => now - time <= 300_000).length,
    headStatus: "—",
    perclos: calculatePerclos(now),
    riskScore: 0,
    driverStatus: multipleFaces ? "MULTIPLE FACES" : "NO FACE",
    alarmActive: false,
    ear: null,
    mouthRatio: null,
    events: [],
  };
}

function calculatePerclos(now) {
  const windowMs = config.perclos_window_seconds * 1000;
  eyeSamples = eyeSamples.filter((sample) => now - sample.time <= windowMs);
  if (eyeSamples.length === 0) return 0;
  const closedCount = eyeSamples.reduce((count, sample) => count + Number(sample.closed), 0);
  return (closedCount / eyeSamples.length) * 100;
}

function processLandmarks(landmarks, width, height, now = performance.now()) {
  const leftEar = eyeAspectRatio(landmarks, LEFT_EYE, width, height);
  const rightEar = eyeAspectRatio(landmarks, RIGHT_EYE, width, height);
  const ear = (leftEar + rightEar) / 2;
  const eyesClosed = ear < config.ear_threshold;
  if (eyesClosed) {
    if (closedSince === null) closedSince = now;
  } else {
    closedSince = null;
    closureLatched = false;
  }
  const eyeClosureDuration = closedSince === null ? 0 : (now - closedSince) / 1000;

  if (now - lastSampleAt >= 100) {
    eyeSamples.push({ time: now, closed: eyesClosed });
    lastSampleAt = now;
  }
  const perclos = calculatePerclos(now);
  const mouthWidth = pointDistance(landmarks[78], landmarks[308], width, height);
  const mouthRatio = mouthWidth
    ? pointDistance(landmarks[13], landmarks[14], width, height) / mouthWidth
    : 0;
  const mouthOpen = mouthRatio >= config.yawning_detection_threshold;
  if (mouthOpen) {
    if (yawnSince === null) yawnSince = now;
  } else {
    yawnSince = null;
    yawnActive = false;
  }
  const events = [];
  if (yawnSince !== null && !yawnActive && now - yawnSince >= 900) {
    yawnActive = true;
    yawns.push(now);
    events.push({ event_type: "YAWN" });
  }
  yawns = yawns.filter((time) => now - time <= 300_000);
  const yawnCount = yawns.length;

  const leftCorner = landmarks[33];
  const rightCorner = landmarks[263];
  const tiltDegrees = Math.abs(
    (Math.atan2(
      (rightCorner.y - leftCorner.y) * height,
      (rightCorner.x - leftCorner.x) * width,
    ) * 180) / Math.PI,
  );
  const nose = landmarks[1];
  const eyeMidY = (leftCorner.y + rightCorner.y) / 2;
  const faceMinY = Math.min(...landmarks.map((point) => point.y));
  const faceMaxY = Math.max(...landmarks.map((point) => point.y));
  const faceHeight = Math.max(faceMaxY - faceMinY, 0.01);
  const noseOffset = (nose.y - eyeMidY) / faceHeight;
  if (!eyesClosed && tiltDegrees < config.head_tilt_degrees && headSince === null) {
    headBaseline = headBaseline === null ? noseOffset : headBaseline * 0.97 + noseOffset * 0.03;
  }
  const dropped = headBaseline !== null && noseOffset - headBaseline > 0.1;
  const headSuspicious = tiltDegrees >= config.head_tilt_degrees || dropped;
  if (headSuspicious) {
    if (headSince === null) headSince = now;
  } else {
    headSince = null;
    headActive = false;
  }
  const sustainedHeadMovement = headSince !== null && now - headSince >= 1200;
  if (sustainedHeadMovement && !headActive) {
    headActive = true;
    events.push({ event_type: "HEAD_DROP" });
  }
  const headStatus = headSuspicious
    ? dropped ? "DROPPED" : "TILTED"
    : "STABLE";

  const riskScore = Math.min(
    100,
    (Math.min(eyeClosureDuration / config.eye_closure_seconds, 1) * 40)
      + (Math.min(perclos / 40, 1) * 30)
      + (Math.min(yawnCount / config.yawning_count_threshold, 1) * 20)
      + (sustainedHeadMovement ? 15 : 0),
  );
  const drowsy = eyeClosureDuration >= config.eye_closure_seconds
    || riskScore >= config.risk_threshold;
  const driverStatus = drowsy
    ? (eyeClosureDuration >= config.eye_closure_seconds * 2 || riskScore >= 85 ? "CRITICAL" : "DROWSY")
    : riskScore >= config.risk_threshold * 0.65 ? "WARNING" : "NORMAL";
  if (eyeClosureDuration >= config.eye_closure_seconds && !closureLatched) {
    closureLatched = true;
    events.push({ event_type: "EYE_CLOSURE" });
  }
  if (perclos >= 20 && !perclosLatched) {
    perclosLatched = true;
    events.push({ event_type: "PERCLOS" });
  } else if (perclos < 15) {
    perclosLatched = false;
  }
  if (driverStatus === "CRITICAL" && priorStatus !== "CRITICAL") {
    events.push({ event_type: "CRITICAL" });
  } else if (drowsy && priorStatus !== "DROWSY" && priorStatus !== "CRITICAL") {
    events.push({ event_type: "DROWSINESS" });
  }
  priorStatus = driverStatus;

  return {
    faceDetected: true,
    multipleFaces: false,
    eyeState: eyesClosed ? "CLOSED" : "OPEN",
    eyeClosureDuration,
    yawnCount,
    headStatus,
    perclos,
    riskScore,
    driverStatus,
    alarmActive: drowsy,
    ear,
    mouthRatio,
    leftEye: LEFT_EYE.map((index) => landmarks[index]),
    rightEye: RIGHT_EYE.map((index) => landmarks[index]),
    mouth: [landmarks[13], landmarks[14], landmarks[78], landmarks[308]],
    nose,
    events: events.map((event) => ({
      ...event,
      eye_closure_duration: eyeClosureDuration,
      risk_score: riskScore,
      alert_status: drowsy,
    })),
  };
}

export function configureDetection(nextConfig) {
  config = { ...config, ...nextConfig };
  resetTransientState();
}

export function resetDetection() {
  eyeSamples = [];
  yawns = [];
  headBaseline = null;
  perclosLatched = false;
  lastSampleAt = 0;
  resetTransientState();
}

export function analyzeFrame(landmarks, width, height, now) {
  return processLandmarks(landmarks, width, height, now);
}

export function missingFace(now, multipleFaces = false) {
  return noFace(now, multipleFaces);
}
