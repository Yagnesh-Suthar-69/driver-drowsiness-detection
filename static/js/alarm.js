let audioContext = null;
let soundEnabled = true;
let voiceEnabled = false;
let alarmActive = false;
let repeatTimer = null;
let cooldownSeconds = 5;

function playTone() {
  if (!soundEnabled) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext ??= new AudioContextClass();
  if (audioContext.state === "suspended") void audioContext.resume();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
  oscillator.frequency.setValueAtTime(660, audioContext.currentTime + 0.22);
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.16, audioContext.currentTime + 0.025);
  gain.gain.setValueAtTime(0.16, audioContext.currentTime + 0.38);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.43);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.45);
}

function speakWarning() {
  if (!voiceEnabled || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const message = new SpeechSynthesisUtterance(
    "Drowsiness detected. Please stay alert. Take a break if safe.",
  );
  message.rate = 0.95;
  window.speechSynthesis.speak(message);
}

export function setAlarmPreferences({ sound, voice, cooldown }) {
  soundEnabled = sound;
  voiceEnabled = voice;
  cooldownSeconds = cooldown;
}

export function unlockAlarmAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext ??= new AudioContextClass();
  if (audioContext.state === "suspended") void audioContext.resume();
}

export function setAlarmActive(active) {
  if (alarmActive === active) return;
  alarmActive = active;
  window.clearInterval(repeatTimer);
  repeatTimer = null;
  if (active) {
    playTone();
    speakWarning();
    repeatTimer = window.setInterval(playTone, cooldownSeconds * 1000);
  } else if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

export function testAlarm() {
  playTone();
  speakWarning();
}

export function stopAlarm() {
  setAlarmActive(false);
}
