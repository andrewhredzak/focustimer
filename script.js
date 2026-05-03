const STORAGE_KEY = "clockFocusApp";
const DB_VERSION = 1;
const MIN_DURATION = 1;
const MAX_DURATION = 180;
const CHART_DAYS = 7;
const DEFAULT_THEME = "graphite";
const THEME_NAMES = ["graphite", "ocean", "forest", "ember", "archive", "nasa"];
const SETTINGS_SHORTCUT_COUNT = 3;
const DEFAULT_ALARM = "alarm-1";
const ALARM_REPEAT_COUNT = 3;
const CLEAR_TODAY_DATA_DATE = "2026-05-03";
const CLEAR_TODAY_DATA_MIGRATION = `clear-data-${CLEAR_TODAY_DATA_DATE}`;
const ALARM_SOUNDS = {
  "alarm-1": "assets/audio/alarm-1.ogg",
  "alarm-2": "assets/audio/alarm-2.ogg"
};
const SPHERE_PARTICLE_COUNT = 7200;
const SPHERE_PARTICLE_SIZE_SCALE = 0.6;

const elements = {
  durationMinutes: document.querySelector("#durationMinutes"),
  durationPicker: document.querySelector(".duration-picker"),
  startButton: document.querySelector("#startButton"),
  sessionPanel: document.querySelector("#sessionPanel"),
  sessionSphere: document.querySelector("#sessionSphere"),
  pauseButton: document.querySelector("#pauseButton"),
  yesterdayMinutes: document.querySelector("#yesterdayMinutes"),
  goalAmount: document.querySelector("#goalAmount"),
  goalUnit: document.querySelector("#goalUnit"),
  streakDays: document.querySelector("#streakDays"),
  completedText: document.querySelector("#completedText"),
  progressRing: document.querySelector("#progressRing"),
  ringGraphic: document.querySelector("#ringGraphic"),
  totalHours: document.querySelector("#totalHours"),
  totalStarts: document.querySelector("#totalStarts"),
  totalPauses: document.querySelector("#totalPauses"),
  totalStops: document.querySelector("#totalStops"),
  totalCompleted: document.querySelector("#totalCompleted"),
  chartBars: document.querySelector("#chartBars"),
  chartRange: document.querySelector("#chartRange"),
  themeOptions: document.querySelector("#themeOptions"),
  alarmOptions: document.querySelector("#alarmOptions"),
  sphereEnabledInput: document.querySelector("#sphereEnabledInput"),
  goalMinutesInput: document.querySelector("#goalMinutesInput")
};

const hasTimerView = Boolean(elements.durationMinutes);
const hasProgressView = Boolean(elements.progressRing);
const hasStatsView = Boolean(elements.chartBars);
const hasSettingsView = Boolean(elements.themeOptions);

const defaultState = {
  duration: 30,
  goalMinutes: 120,
  theme: DEFAULT_THEME,
  alarmSound: DEFAULT_ALARM,
  sphereEnabled: true,
  migrations: [],
  db: {
    version: DB_VERSION,
    daily: {},
    sessions: []
  }
};

let state = loadState();
clearDateDataOnce(CLEAR_TODAY_DATA_DATE, CLEAR_TODAY_DATA_MIGRATION);
applyTheme(state.theme);

let timer = {
  intervalId: null,
  running: false,
  totalSeconds: state.duration * 60,
  remainingSeconds: state.duration * 60,
  sessionId: null,
  sessionDate: null
};

let sphereState = {
  ctx: null,
  frameId: null,
  particles: [],
  targetProgress: 1,
  renderedProgress: 1,
  spin: 0,
  lastTimestamp: 0,
  width: 0,
  height: 0,
  dpr: 1
};

let settingsShortcutStreak = 0;
let durationTypingActive = false;
let previewAlarm = null;
let completionAlarm = null;

function setStartReady(isReady) {
  if (!hasTimerView) {
    return;
  }

  elements.startButton.classList.toggle("is-ready", isReady);
}

function initSessionSphere() {
  if (!hasTimerView || !elements.sessionSphere) {
    return;
  }

  sphereState.ctx = elements.sessionSphere.getContext("2d");
  sphereState.particles = createSphereParticles(SPHERE_PARTICLE_COUNT);
}

function createSphereParticles(count) {
  const particles = [];
  const offset = 2 / count;
  const increment = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < count; index += 1) {
    const y = index * offset - 1 + offset / 2;
    const radius = Math.sqrt(1 - y * y);
    const angle = index * increment;
    const radiusOffset = (seededNoise(index, 1) - 0.5) * 0.62;

    particles.push({
      x: Math.cos(angle) * radius,
      y,
      z: Math.sin(angle) * radius,
      phase: index * 0.37,
      radiusOffset,
      behaviorType: seededNoise(index, 3) > 0.52 ? "orbital" : "radial",
      size: 0.4 + seededNoise(index, 2) * 0.56
    });
  }

  return particles;
}

function seededNoise(index, salt) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function resizeSessionSphere() {
  if (!hasTimerView || !elements.sessionSphere) {
    return false;
  }

  const rect = elements.sessionSphere.getBoundingClientRect();

  if (!rect.width || !rect.height) {
    return false;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);

  if (elements.sessionSphere.width !== width || elements.sessionSphere.height !== height) {
    elements.sessionSphere.width = width;
    elements.sessionSphere.height = height;
  }

  sphereState.width = width;
  sphereState.height = height;
  sphereState.dpr = dpr;
  return true;
}

function setSessionSphereProgress(progress, snap = false) {
  sphereState.targetProgress = clamp(progress, 0, 1);

  if (snap) {
    sphereState.renderedProgress = sphereState.targetProgress;
    sphereState.lastTimestamp = 0;
  }

  if (!state.sphereEnabled) {
    return;
  }

  renderSessionSphere(performance.now());
}

function startSessionSphere() {
  if (!state.sphereEnabled || !hasTimerView || !elements.sessionSphere) {
    return;
  }

  resizeSessionSphere();

  if (sphereState.frameId) {
    return;
  }

  sphereState.frameId = requestAnimationFrame(drawSessionSphere);
}

function stopSessionSphere() {
  if (sphereState.frameId) {
    cancelAnimationFrame(sphereState.frameId);
    sphereState.frameId = null;
  }

  setSessionSphereProgress(0, true);
}

function updateSphereVisibility() {
  if (!hasTimerView || !elements.sessionSphere) {
    return;
  }

  const shouldShow = state.sphereEnabled && elements.sessionPanel.hidden === false;
  elements.sessionSphere.hidden = !shouldShow;

  if (!state.sphereEnabled) {
    stopSessionSphere();
    return;
  }

  if (shouldShow) {
    startSessionSphere();
  }
}

function drawSessionSphere(timestamp) {
  sphereState.frameId = null;
  renderSessionSphere(timestamp);

  if (!hasTimerView || elements.sessionPanel.hidden) {
    return;
  }

  sphereState.frameId = requestAnimationFrame(drawSessionSphere);
}

function renderSessionSphere(timestamp = 0) {
  if (!sphereState.ctx || !resizeSessionSphere()) {
    return;
  }

  const { ctx, width, height, dpr, particles } = sphereState;
  ctx.clearRect(0, 0, width, height);

  const progressDelta = sphereState.targetProgress - sphereState.renderedProgress;
  sphereState.renderedProgress = Math.abs(progressDelta) < 0.001
    ? sphereState.targetProgress
    : sphereState.renderedProgress + progressDelta * 0.12;

  const progress = clamp(sphereState.renderedProgress, 0, 1);

  if (progress <= 0.001) {
    return;
  }

  const time = timestamp * 0.001;
  const deltaTime = sphereState.lastTimestamp
    ? Math.min((timestamp - sphereState.lastTimestamp) / 1000, 0.05)
    : 0;
  sphereState.lastTimestamp = timestamp;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) * 0.33;
  const radius = maxRadius * Math.pow(progress, 0.92);
  const energy = 1 - progress;
  const energyCurve = energy * energy;
  const colors = getSessionSphereColors();
  const glowRadius = radius * (1.16 + energy * 0.28);
  const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius);

  glow.addColorStop(0, colorWithAlpha(colors.accent, (0.08 + energy * 0.22) * progress));
  glow.addColorStop(0.55, colorWithAlpha(colors.strong, (0.04 + energy * 0.18) * progress));
  glow.addColorStop(1, colorWithAlpha(colors.strong, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  sphereState.spin += deltaTime * (0.32 + energyCurve * 6.8 * energy);
  const rotationY = sphereState.spin;
  const rotationX = 0.22 + Math.sin(time * (0.1 + energy * 4.2)) * 0.46 * energy;
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);

  const projected = particles.map((particle, index) => {
    const rotatedX = particle.x * cosY - particle.z * sinY;
    const rotatedZ = particle.x * sinY + particle.z * cosY;
    const rotatedY = particle.y * cosX - rotatedZ * sinX;
    const depthZ = particle.y * sinX + rotatedZ * cosX;
    const particleEnergy = energy * (0.9 + particle.size * 0.45);
    const chaos = energyCurve * energy;
    const pulse = Math.sin(time * (0.9 + energyCurve * 18) + particle.phase) * (0.01 + chaos * 0.9);
    const tremor = Math.sin(time * (2.4 + energy * 32) + particle.phase * 1.7) * chaos;
    const crossTremor = Math.cos(time * (1.8 + energy * 27) + particle.phase * 2.3) * chaos;
    const isOrbital = particle.behaviorType === "orbital";
    const radialBurst = isOrbital ? pulse * 0.42 : pulse * 1.25;
    const orbitalDrift = isOrbital
      ? Math.sin(time * (0.6 + energy * 9.5) + particle.phase * 2.8) * chaos
      : 0;
    const shellRadius = radius * (1 + particle.radiusOffset + radialBurst * particleEnergy);
    const depth = (depthZ + 1) / 2;
    const perspective = 0.74 + depth * 0.34;
    const jitter = radius * (isOrbital ? 0.14 : 0.42) * tremor * particleEnergy;
    const swirl = radius * (isOrbital ? 0.58 : 0.16) * (crossTremor + orbitalDrift) * particleEnergy;

    return {
      x: centerX + (rotatedX * shellRadius + particle.y * jitter - rotatedY * swirl) * perspective,
      y: centerY + (rotatedY * shellRadius + rotatedX * jitter + rotatedX * swirl) * perspective,
      depth,
      index,
      type: particle.behaviorType,
      radius: (1.2 + depth * 2.6 + particle.size + energy * (isOrbital ? 2.1 : 3.8)) * dpr * Math.pow(progress, 0.45) * SPHERE_PARTICLE_SIZE_SCALE
    };
  });

  projected
    .sort((a, b) => a.depth - b.depth)
    .forEach((particle) => {
      const alpha = (0.18 + particle.depth * 0.68) * Math.min(1, progress * (1.7 + energy * 7.5));
      const color = getEnergyParticleColor(colors, particle, energy);

      ctx.fillStyle = colorWithAlpha(color, alpha);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      ctx.fill();
    });
}

function getSessionSphereColors() {
  const styles = getComputedStyle(document.documentElement);
  const isVibrant = !hasTimerView || timer.running || elements.sessionPanel.hidden;
  const colorMode = isVibrant
    ? { saturation: 1.35, brightness: 1.22 }
    : { saturation: 0.42, brightness: 0.72 };

  return {
    accent: tuneHexColor(styles.getPropertyValue("--accent").trim() || "#71b9ee", colorMode),
    strong: tuneHexColor(styles.getPropertyValue("--accent-strong").trim() || "#24d0b0", colorMode),
    blue: tuneHexColor(styles.getPropertyValue("--accent-blue").trim() || "#4aa6f6", colorMode),
    hot: tuneHexColor("#ff2a1f", colorMode)
  };
}

function getEnergyParticleColor(colors, particle, energy) {
  const baseColor = particle.index % 3 === 0
    ? colors.blue
    : particle.type === "orbital"
      ? colors.accent
      : particle.depth > 0.62
      ? colors.strong
      : colors.accent;

  if (energy < 0.18) {
    return mixColors(baseColor, particle.type === "orbital" ? colors.accent : colors.blue, 0.24);
  }

  if (energy < 0.62) {
    const targetColor = particle.type === "orbital" ? colors.blue : colors.strong;
    return mixColors(baseColor, targetColor, (energy - 0.18) / 0.44);
  }

  const highEnergyBase = particle.type === "orbital" ? colors.blue : colors.strong;
  return mixColors(highEnergyBase, colors.hot, (energy - 0.62) / 0.38);
}

function mixColors(from, to, amount) {
  const mix = clamp(amount, 0, 1);

  return {
    r: Math.round(from.r + (to.r - from.r) * mix),
    g: Math.round(from.g + (to.g - from.g) * mix),
    b: Math.round(from.b + (to.b - from.b) * mix)
  };
}

function tuneHexColor(color, { saturation, brightness }) {
  const rgb = parseHexColor(color);

  if (!rgb) {
    return color;
  }

  const gray = rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114;

  return {
    r: clamp(Math.round((gray + (rgb.r - gray) * saturation) * brightness), 0, 255),
    g: clamp(Math.round((gray + (rgb.g - gray) * saturation) * brightness), 0, 255),
    b: clamp(Math.round((gray + (rgb.b - gray) * saturation) * brightness), 0, 255)
  };
}

function colorWithAlpha(color, alpha) {
  const rgb = typeof color === "string" ? parseHexColor(color) : color;

  if (!rgb) {
    return color;
  }

  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function parseHexColor(color) {
  const match = color.trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);

  if (!match) {
    return null;
  }

  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16)
  };
}

function todayKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createDayStats() {
  return {
    focusSeconds: 0,
    starts: 0,
    pauses: 0,
    stops: 0,
    completed: 0
  };
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));

    if (!stored || typeof stored !== "object") {
      return structuredClone(defaultState);
    }

    const loadedState = {
      duration: clamp(Number(stored.duration) || defaultState.duration, MIN_DURATION, MAX_DURATION),
      goalMinutes: clamp(Number(stored.goalMinutes) || defaultState.goalMinutes, 15, 720),
      theme: THEME_NAMES.includes(stored.theme) ? stored.theme : DEFAULT_THEME,
      alarmSound: ALARM_SOUNDS[stored.alarmSound] ? stored.alarmSound : DEFAULT_ALARM,
      sphereEnabled: stored.sphereEnabled !== false,
      migrations: Array.isArray(stored.migrations) ? stored.migrations : [],
      db: normalizeDb(stored)
    };

    return loadedState;
  } catch {
    return structuredClone(defaultState);
  }
}

function normalizeDb(stored) {
  const db = stored.db && typeof stored.db === "object"
    ? {
        version: DB_VERSION,
        daily: stored.db.daily || {},
        sessions: Array.isArray(stored.db.sessions) ? stored.db.sessions : []
      }
    : structuredClone(defaultState.db);

  if (stored.completedByDate && typeof stored.completedByDate === "object") {
    Object.entries(stored.completedByDate).forEach(([date, minutes]) => {
      const day = db.daily[date] || createDayStats();
      day.focusSeconds = Math.max(Number(day.focusSeconds) || 0, (Number(minutes) || 0) * 60);
      db.daily[date] = day;
    });
  }

  Object.keys(db.daily).forEach((date) => {
    db.daily[date] = {
      ...createDayStats(),
      ...db.daily[date],
      focusSeconds: Number(db.daily[date].focusSeconds) || 0,
      starts: Number(db.daily[date].starts) || 0,
      pauses: Number(db.daily[date].pauses) || 0,
      stops: Number(db.daily[date].stops) || 0,
      completed: Number(db.daily[date].completed) || 0
    };
  });

  return db;
}

function clearDateDataOnce(date, migrationName) {
  if (state.migrations.includes(migrationName)) {
    return;
  }

  delete state.db.daily[date];
  state.db.sessions = state.db.sessions.filter((session) => session.date !== date);
  state.migrations.push(migrationName);
  saveState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function applyTheme(theme) {
  const nextTheme = THEME_NAMES.includes(theme) ? theme : DEFAULT_THEME;
  document.documentElement.dataset.theme = nextTheme;
}

function setTheme(theme) {
  if (!THEME_NAMES.includes(theme)) {
    return;
  }

  state.theme = theme;
  applyTheme(theme);
  saveState();
  updateSettingsPage();
}

function setAlarmSound(alarmSound) {
  if (!ALARM_SOUNDS[alarmSound]) {
    return;
  }

  state.alarmSound = alarmSound;
  saveState();
  updateSettingsPage();
  playAlarmPreview(alarmSound);
}

function setSphereEnabled(isEnabled) {
  state.sphereEnabled = isEnabled;
  saveState();
  updateSphereVisibility();
  updateSettingsPage();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTimer(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatMinutes(minutes) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;

  if (hours && mins) {
    return `${hours} hour${hours === 1 ? "" : "s"}, ${mins} minute${mins === 1 ? "" : "s"}`;
  }

  if (hours) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

function formatCompactDuration(seconds) {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours && minutes) {
    return `${hours}h ${minutes}m`;
  }

  if (hours) {
    return `${hours}h`;
  }

  return `${minutes}m`;
}

function formatShortDate(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

function getDay(date = todayKey()) {
  if (!state.db.daily[date]) {
    state.db.daily[date] = createDayStats();
  }

  return state.db.daily[date];
}

function createSessionRecord() {
  const date = todayKey();
  const session = {
    id: window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now()),
    date,
    plannedMinutes: state.duration,
    startedAt: new Date().toISOString(),
    endedAt: null,
    focusSeconds: 0,
    pauses: 0,
    status: "running"
  };

  state.db.sessions.push(session);
  getDay(date).starts += 1;
  saveState();
  return session;
}

function getCurrentSession() {
  return state.db.sessions.find((session) => session.id === timer.sessionId);
}

function finishSession(status, focusSeconds) {
  const session = getCurrentSession();
  const day = getDay(timer.sessionDate || todayKey());
  const seconds = Math.max(0, Math.round(focusSeconds));

  day.focusSeconds += seconds;

  if (status === "completed") {
    day.completed += 1;
  }

  if (status === "stopped") {
    day.stops += 1;
  }

  if (session) {
    session.endedAt = new Date().toISOString();
    session.focusSeconds = seconds;
    session.status = status;
  }

  saveState();
}

function logPause() {
  const session = getCurrentSession();
  const day = getDay(timer.sessionDate || todayKey());

  day.pauses += 1;

  if (session) {
    session.pauses += 1;
    session.status = "paused";
  }

  saveState();
}

function updateSettingsView() {
  if (!hasTimerView) {
    return;
  }

  const sessionActive = elements.sessionPanel.hidden === false;
  elements.durationPicker.classList.toggle("is-timing", sessionActive);

  if (!sessionActive) {
    elements.durationMinutes.type = "number";
    elements.durationMinutes.value = state.duration;
    elements.durationMinutes.readOnly = false;
    durationTypingActive = false;
  }

  const controlsDisabled = timer.running || sessionActive;
  elements.durationMinutes.disabled = sessionActive;
}

function updateTimerView() {
  if (!hasTimerView) {
    return;
  }

  const remainingRatio = timer.totalSeconds > 0
    ? clamp(timer.remainingSeconds / timer.totalSeconds, 0, 1)
    : 0;
  const label = "focus";

  if (elements.sessionPanel.hidden) {
    return;
  }

  elements.durationMinutes.type = "text";
  elements.durationMinutes.value = formatTimer(timer.remainingSeconds);
  elements.durationMinutes.readOnly = true;
  setSessionSphereProgress(remainingRatio);
  updateSphereVisibility();
  if (elements.pauseButton) {
    elements.pauseButton.textContent = timer.running ? "Pause" : "Resume";
  }

  if (!elements.sessionPanel.hidden) {
    document.title = `${formatTimer(timer.remainingSeconds)} - ${label}`;
  }
}

function setDuration(nextDuration) {
  state.duration = clamp(nextDuration, MIN_DURATION, MAX_DURATION);
  saveState();
  resetTimerModel();
  updateSettingsView();
}

function resetTimerModel() {
  timer.totalSeconds = state.duration * 60;
  timer.remainingSeconds = state.duration * 60;
  timer.sessionId = null;
  timer.sessionDate = null;
}

function startSession() {
  setStartReady(false);
  resetTimerModel();
  const session = createSessionRecord();
  timer.sessionId = session.id;
  timer.sessionDate = session.date;
  elements.sessionPanel.hidden = false;
  elements.startButton.hidden = true;
  setSessionSphereProgress(1, true);
  updateSphereVisibility();
  tickStart();
  updateSettingsView();
  updateTimerView();
  updateProgressView();
}

function tickStart() {
  clearInterval(timer.intervalId);
  timer.running = true;
  timer.intervalId = setInterval(tick, 1000);

  const session = getCurrentSession();
  if (session) {
    session.status = "running";
    saveState();
  }
}

function tick() {
  timer.remainingSeconds -= 1;

  if (timer.remainingSeconds <= 0) {
    completeSession();
    return;
  }

  updateTimerView();
}

function completeSession() {
  clearInterval(timer.intervalId);
  timer.intervalId = null;
  timer.remainingSeconds = 0;
  updateTimerView();
  finishSession("completed", timer.totalSeconds);
  playAlarm();
  endSession();
}

function playAlarm() {
  const alarmPath = ALARM_SOUNDS[state.alarmSound] || ALARM_SOUNDS[DEFAULT_ALARM];
  let playCount = 1;

  if (completionAlarm) {
    completionAlarm.pause();
    completionAlarm.currentTime = 0;
  }

  completionAlarm = new Audio(alarmPath);
  completionAlarm.addEventListener("ended", () => {
    if (playCount >= ALARM_REPEAT_COUNT) {
      completionAlarm = null;
      return;
    }

    playCount += 1;
    completionAlarm.currentTime = 0;
    completionAlarm.play().catch(() => {});
  });
  completionAlarm.play().catch(() => {});
}

function playAlarmPreview(alarmSound) {
  const alarmPath = ALARM_SOUNDS[alarmSound];

  if (!alarmPath) {
    return;
  }

  if (previewAlarm) {
    previewAlarm.pause();
    previewAlarm.currentTime = 0;
  }

  previewAlarm = new Audio(alarmPath);
  previewAlarm.play().catch(() => {});
}

function pauseOrResume() {
  if (timer.running) {
    clearInterval(timer.intervalId);
    timer.intervalId = null;
    timer.running = false;
    logPause();
  } else {
    tickStart();
  }

  updateTimerView();
  updateProgressView();
}

function resetSession() {
  const elapsedSeconds = timer.totalSeconds - timer.remainingSeconds;
  clearInterval(timer.intervalId);
  timer.intervalId = null;
  timer.running = false;
  finishSession("stopped", elapsedSeconds);
  endSession();
}

function endSession() {
  clearInterval(timer.intervalId);
  timer.intervalId = null;
  timer.running = false;
  stopSessionSphere();
  elements.sessionPanel.hidden = true;
  elements.startButton.hidden = false;
  setStartReady(false);
  resetTimerModel();
  updateSphereVisibility();
  document.title = "focus";
  updateSettingsView();
  updateTimerView();
  updateProgressView();
}

function getDailyFocusMinutes(date = todayKey()) {
  const day = state.db.daily[date] || createDayStats();
  return Math.round((Number(day.focusSeconds) || 0) / 60);
}

function updateProgressView() {
  if (!hasProgressView) {
    updateStatsView();
    return;
  }

  const today = getDailyFocusMinutes(todayKey());
  const yesterday = getDailyFocusMinutes(todayKey(-1));
  const progress = clamp((today / state.goalMinutes) * 100, 0, 100);
  const displayGoalHours = state.goalMinutes / 60;
  const goalIsWholeHours = Number.isInteger(displayGoalHours);

  elements.yesterdayMinutes.textContent = yesterday;
  elements.streakDays.textContent = calculateStreak();
  elements.completedText.textContent = `Completed: ${formatMinutes(today)}`;
  elements.ringGraphic.style.setProperty("--progress", `${progress}%`);
  elements.progressRing.setAttribute(
    "aria-label",
    `Daily goal is ${formatMinutes(state.goalMinutes)}, ${formatMinutes(today)} completed`
  );

  if (goalIsWholeHours) {
    elements.goalAmount.textContent = displayGoalHours;
    elements.goalUnit.textContent = displayGoalHours === 1 ? "hour" : "hours";
  } else {
    elements.goalAmount.textContent = state.goalMinutes;
    elements.goalUnit.textContent = "minutes";
  }

  updateStatsView();
}

function calculateStreak() {
  let streak = 0;

  for (let offset = 0; offset > -366; offset -= 1) {
    const completed = getDailyFocusMinutes(todayKey(offset));

    if (completed < state.goalMinutes) {
      break;
    }

    streak += 1;
  }

  return streak;
}

function getTotals() {
  return Object.values(state.db.daily).reduce((totals, day) => ({
    focusSeconds: totals.focusSeconds + (Number(day.focusSeconds) || 0),
    starts: totals.starts + (Number(day.starts) || 0),
    pauses: totals.pauses + (Number(day.pauses) || 0),
    stops: totals.stops + (Number(day.stops) || 0),
    completed: totals.completed + (Number(day.completed) || 0)
  }), {
    focusSeconds: 0,
    starts: 0,
    pauses: 0,
    stops: 0,
    completed: 0
  });
}

function updateStatsView() {
  if (!hasStatsView) {
    return;
  }

  const totals = getTotals();

  elements.totalHours.textContent = formatCompactDuration(totals.focusSeconds);
  elements.totalStarts.textContent = totals.starts;
  elements.totalPauses.textContent = totals.pauses;
  elements.totalStops.textContent = totals.stops;
  elements.totalCompleted.textContent = totals.completed;
  renderChart();
}

function renderChart() {
  const days = Array.from({ length: CHART_DAYS }, (_, index) => {
    const offset = index - (CHART_DAYS - 1);
    const date = todayKey(offset);
    return {
      date,
      minutes: getDailyFocusMinutes(date)
    };
  });
  const maxMinutes = Math.max(state.goalMinutes, ...days.map((day) => day.minutes), 1);

  elements.chartRange.textContent = `${formatShortDate(days[0].date)} - ${formatShortDate(days[days.length - 1].date)}`;
  elements.chartBars.innerHTML = "";

  days.forEach((day) => {
    const item = document.createElement("div");
    const bar = document.createElement("span");
    const value = document.createElement("strong");
    const label = document.createElement("small");
    const height = clamp((day.minutes / maxMinutes) * 100, 0, 100);

    item.className = "chart-day";
    bar.className = "chart-bar";
    bar.style.height = `${height}%`;
    value.textContent = day.minutes ? `${day.minutes}m` : "0";
    label.textContent = formatShortDate(day.date);
    item.title = `${formatShortDate(day.date)}: ${formatMinutes(day.minutes)}`;
    item.append(value, bar, label);
    elements.chartBars.append(item);
  });
}

function bindEvents() {
  document.addEventListener("keydown", handleAppShortcut);

  if (hasSettingsView) {
    elements.themeOptions.addEventListener("change", (event) => {
      if (event.target.name === "theme") {
        setTheme(event.target.value);
      }
    });

    elements.alarmOptions.addEventListener("change", (event) => {
      if (event.target.name === "alarmSound") {
        setAlarmSound(event.target.value);
      }
    });

    elements.goalMinutesInput.addEventListener("change", updateGoalFromSettings);
    elements.sphereEnabledInput.addEventListener("change", (event) => {
      setSphereEnabled(event.target.checked);
    });
  }

  if (hasTimerView) {
    elements.durationMinutes.addEventListener("keydown", handleDurationInputKeydown);
    elements.startButton.addEventListener("click", startSession);
    if (elements.pauseButton) {
      elements.pauseButton.addEventListener("click", pauseOrResume);
    }
    window.addEventListener("resize", () => renderSessionSphere(performance.now()));
  }
}

function updateDurationFromInput() {
  const nextDuration = Number(elements.durationMinutes.value);

  if (!Number.isFinite(nextDuration)) {
    elements.durationMinutes.value = state.duration;
    setStartReady(false);
    return;
  }

  setDuration(Math.round(nextDuration));
  durationTypingActive = false;
  setStartReady(true);
}

function handleDurationInputKeydown(event) {
  if (event.key !== "Enter") {
    setStartReady(false);
    return;
  }

  event.preventDefault();
  updateDurationFromInput();
  elements.durationMinutes.blur();
}

function updateGoalFromSettings() {
  const nextGoal = Number(elements.goalMinutesInput.value);

  if (!Number.isFinite(nextGoal)) {
    elements.goalMinutesInput.value = state.goalMinutes;
    return;
  }

  state.goalMinutes = clamp(Math.round(nextGoal), 15, 720);
  elements.goalMinutesInput.value = state.goalMinutes;
  saveState();
  updateProgressView();
}

function handleAppShortcut(event) {
  const activeTag = document.activeElement?.tagName;
  const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(activeTag);

  if (handleGlobalDurationEntry(event, isTyping)) {
    return;
  }

  if (event.key === "Escape" && hasTimerView && !elements.sessionPanel.hidden) {
    event.preventDefault();
    resetSession();
    settingsShortcutStreak = 0;
    return;
  }

  if (event.code === "Space" && hasTimerView && !isTyping) {
    event.preventDefault();
    toggleTimerFromKeyboard();
    settingsShortcutStreak = 0;
    return;
  }

  if (event.repeat || isTyping) {
    return;
  }

  const shortcutKey = event.key.toLowerCase();

  if (shortcutKey === "m") {
    settingsShortcutStreak += 1;

    if (settingsShortcutStreak >= SETTINGS_SHORTCUT_COUNT) {
      settingsShortcutStreak = 0;
      window.location.href = "menu.html";
    }

    return;
  }

  settingsShortcutStreak = 0;
}

function toggleTimerFromKeyboard() {
  if (elements.sessionPanel.hidden) {
    startSession();
    return;
  }

  pauseOrResume();
}

function handleGlobalDurationEntry(event, isTyping) {
  if (!hasTimerView || isTyping || !elements.sessionPanel.hidden || event.repeat) {
    return false;
  }

  if (event.key === "Enter" && durationTypingActive) {
    event.preventDefault();
    updateDurationFromInput();
    elements.durationMinutes.blur();
    return true;
  }

  if (!/^\d$/.test(event.key)) {
    if (event.key !== "Enter") {
      durationTypingActive = false;
    }

    return false;
  }

  event.preventDefault();
  const nextValue = durationTypingActive
    ? `${elements.durationMinutes.value}${event.key}`
    : event.key;

  elements.durationMinutes.value = nextValue.replace(/^0+(?=\d)/, "");
  durationTypingActive = true;
  setStartReady(false);
  settingsShortcutStreak = 0;
  return true;
}

function updateSettingsPage() {
  if (!hasSettingsView) {
    return;
  }

  const selected = elements.themeOptions.querySelector(`input[value="${state.theme}"]`);

  if (selected) {
    selected.checked = true;
  }

  const selectedAlarm = elements.alarmOptions.querySelector(`input[value="${state.alarmSound}"]`);

  if (selectedAlarm) {
    selectedAlarm.checked = true;
  }

  elements.goalMinutesInput.value = state.goalMinutes;
  elements.sphereEnabledInput.checked = state.sphereEnabled;
}

bindEvents();
initSessionSphere();
resetTimerModel();
updateSettingsView();
updateTimerView();
updateSphereVisibility();
updateProgressView();
updateSettingsPage();
