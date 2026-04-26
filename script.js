const STORAGE_KEY = "clockFocusApp";
const DB_VERSION = 1;
const MIN_DURATION = 1;
const MAX_DURATION = 180;
const CHART_DAYS = 7;
const DEFAULT_THEME = "graphite";
const THEME_NAMES = ["graphite", "ocean", "forest", "ember"];
const SETTINGS_SHORTCUT_COUNT = 5;
const DEFAULT_ALARM = "alarm-1";
const ALARM_REPEAT_COUNT = 3;
const ALARM_SOUNDS = {
  "alarm-1": "audio/alarm-1.ogg",
  "alarm-2": "audio/alarm-2.ogg"
};

const elements = {
  durationMinutes: document.querySelector("#durationMinutes"),
  durationPicker: document.querySelector(".duration-picker"),
  startButton: document.querySelector("#startButton"),
  sessionPanel: document.querySelector("#sessionPanel"),
  sessionLabel: document.querySelector("#sessionLabel"),
  sessionMeter: document.querySelector("#sessionMeter"),
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
  db: {
    version: DB_VERSION,
    daily: {},
    sessions: []
  }
};

let state = loadState();
applyTheme(state.theme);

let timer = {
  intervalId: null,
  running: false,
  totalSeconds: state.duration * 60,
  remainingSeconds: state.duration * 60,
  sessionId: null,
  sessionDate: null
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

  const elapsed = timer.totalSeconds - timer.remainingSeconds;
  const percent = timer.totalSeconds > 0 ? clamp((elapsed / timer.totalSeconds) * 100, 0, 100) : 0;
  const label = "Focus session";

  if (elements.sessionPanel.hidden) {
    return;
  }

  elements.sessionLabel.textContent = timer.running ? label : `${label} paused`;
  elements.durationMinutes.type = "text";
  elements.durationMinutes.value = formatTimer(timer.remainingSeconds);
  elements.durationMinutes.readOnly = true;
  elements.sessionMeter.style.width = `${percent}%`;
  elements.pauseButton.textContent = timer.running ? "Pause" : "Resume";

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
  elements.sessionPanel.hidden = true;
  elements.startButton.hidden = false;
  setStartReady(false);
  resetTimerModel();
  document.title = "Clock Focus Session";
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
  document.addEventListener("keydown", handleSettingsShortcut);

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
  }

  if (hasTimerView) {
    elements.durationMinutes.addEventListener("keydown", handleDurationInputKeydown);
    elements.startButton.addEventListener("click", startSession);
    elements.pauseButton.addEventListener("click", pauseOrResume);
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

function handleSettingsShortcut(event) {
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

  if (event.key.toLowerCase() !== "s") {
    settingsShortcutStreak = 0;
    return;
  }

  settingsShortcutStreak += 1;

  if (settingsShortcutStreak >= SETTINGS_SHORTCUT_COUNT) {
    settingsShortcutStreak = 0;
    window.location.href = "settings.html";
  }
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
}

bindEvents();
resetTimerModel();
updateSettingsView();
updateTimerView();
updateProgressView();
updateSettingsPage();
