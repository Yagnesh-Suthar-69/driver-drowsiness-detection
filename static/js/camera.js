import { analyzeFrame, configureDetection, missingFace, resetDetection } from "./detection.js";

const video = document.getElementById("camera-video");
const canvas = document.getElementById("landmark-canvas");
const context = canvas.getContext("2d");
let stream = null;
let landmarker = null;
let frameRequest = null;
let monitoring = false;
let lastAnalysisTime = 0;

async function createLandmarker() {
  const vision = await import(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22"
  );
  const fileset = await vision.FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm",
  );
  const options = {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    },
    runningMode: "VIDEO",
    numFaces: 2,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    return await vision.FaceLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "GPU" },
    });
  } catch {
    return vision.FaceLandmarker.createFromOptions(fileset, options);
  }
}

function paintEye(points, width, height) {
  if (!points) return;
  context.beginPath();
  points.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.strokeStyle = "#69e5a5";
  context.lineWidth = Math.max(2, width / 500);
  context.stroke();
  for (const point of points) {
    context.beginPath();
    context.arc(point.x * width, point.y * height, Math.max(2, width / 240), 0, Math.PI * 2);
    context.fillStyle = "#e7fff0";
    context.fill();
  }
}

function paintResult(result, width, height) {
  context.clearRect(0, 0, width, height);
  paintEye(result.leftEye, width, height);
  paintEye(result.rightEye, width, height);
  if (result.mouth) {
    for (const point of result.mouth) {
      context.beginPath();
      context.arc(point.x * width, point.y * height, Math.max(2, width / 300), 0, Math.PI * 2);
      context.fillStyle = "#ffc76d";
      context.fill();
    }
  }
  if (result.nose) {
    context.beginPath();
    context.arc(result.nose.x * width, result.nose.y * height, Math.max(2, width / 280), 0, Math.PI * 2);
    context.fillStyle = "#ff767b";
    context.fill();
  }
}

function frameLoop(now) {
  if (!stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    frameRequest = requestAnimationFrame(frameLoop);
    return;
  }
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    document.getElementById("camera-resolution").textContent = `${width} × ${height}`;
  }
  if (monitoring && landmarker && now - lastAnalysisTime >= 90) {
    lastAnalysisTime = now;
    const result = landmarker.detectForVideo(video, now);
    const faces = result.faceLandmarks ?? [];
    const state = faces.length === 1
      ? analyzeFrame(faces[0], width, height, now)
      : missingFace(now, faces.length > 1);
    paintResult(faces.length === 1 ? state : {}, width, height);
    window.dispatchEvent(new CustomEvent("detection:update", { detail: state }));
  } else if (!monitoring) {
    context.clearRect(0, 0, width, height);
  }
  frameRequest = requestAnimationFrame(frameLoop);
}

export async function startCamera(config) {
  if (stream) return;
  configureDetection(config);
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  video.srcObject = stream;
  await video.play();
  try {
    landmarker = await createLandmarker();
  } catch (error) {
    stopCamera();
    throw new Error(
      `Could not load MediaPipe Face Landmarker. Check your internet connection and try again. ${error.message}`,
    );
  }
  resetDetection();
  lastAnalysisTime = 0;
  frameRequest = requestAnimationFrame(frameLoop);
}

export function setMonitoring(active) {
  monitoring = active;
  if (!active) {
    resetDetection();
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
}

export function updateDetectionConfig(config) {
  configureDetection(config);
}

export function stopCamera() {
  monitoring = false;
  if (frameRequest !== null) cancelAnimationFrame(frameRequest);
  frameRequest = null;
  if (landmarker) landmarker.close();
  landmarker = null;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  stream = null;
  video.srcObject = null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  resetDetection();
}
