const STORAGE_KEY = "cricket-scoring-state-v1";

// Apps Script web app URL that finished matches get posted to. Setup steps are in
// google-apps-script.gs. Left empty, the app never touches the network.
const SHEET_ENDPOINT = "https://script.google.com/macros/s/AKfycbyV5CzT-b9z1V7O9ArR9f1Gxam7s_Up25SY240wox5tb8Ibmnt1FeQd9gEMUdLm2uVN/exec";
const UPLOAD_TIMEOUT_MS = 10000;
// House rule: a wide or no ball is worth 2, before any runs actually run.
const EXTRA_PENALTY_RUNS = 2;
const BALLS_PER_OVER = 6;
const DEFAULT_MAX_OVERS = 5;
const DEFAULT_MAX_WICKETS = 7;
const TEAM_KEYS = ["home", "away"];

const state = {
  maxOvers: DEFAULT_MAX_OVERS,
  maxWickets: DEFAULT_MAX_WICKETS,
  activeTeam: "home",
  // Whoever is scored first bats first, which is what makes the second innings a chase.
  firstInnings: null,
  // Set by "End match": freezes both innings until the match is reset.
  matchEnded: false,
  matchId: null,
  upload: { status: "idle", error: null },
  pendingExtra: null,
  teams: {
    home: {
      name: "Home",
      runs: 0,
      wickets: 0,
      balls: 0,
      deliveries: [],
      history: [],
      inningsEnded: false
    },
    away: {
      name: "Opponent",
      runs: 0,
      wickets: 0,
      balls: 0,
      deliveries: [],
      history: [],
      inningsEnded: false
    }
  }
};

const ui = {
  homeTeamInput: document.getElementById("homeTeam"),
  awayTeamInput: document.getElementById("awayTeam"),
  maxOversInput: document.getElementById("maxOvers"),
  maxWicketsInput: document.getElementById("maxWickets"),
  setupPanel: document.getElementById("setupPanel"),
  setupToggle: document.getElementById("setupToggle"),
  resetBtn: document.getElementById("resetBtn"),
  homeName: document.getElementById("homeName"),
  awayName: document.getElementById("awayName"),
  homeScore: document.getElementById("homeScore"),
  awayScore: document.getElementById("awayScore"),
  runs: document.getElementById("runs"),
  wickets: document.getElementById("wickets"),
  oversText: document.getElementById("oversText"),
  rateText: document.getElementById("rateText"),
  overStrip: document.getElementById("overStrip"),
  pad: document.getElementById("pad"),
  matchStatus: document.getElementById("matchStatus"),
  matchStatusText: document.getElementById("matchStatusText"),
  matchStatusAction: document.getElementById("matchStatusAction"),
  matchStatusNote: document.getElementById("matchStatusNote"),
  undoBtn: document.getElementById("undoBtn"),
  lastBall: document.getElementById("lastBall"),
  overList: document.getElementById("overList"),
  backdrop: document.getElementById("backdrop"),
  sheet: document.getElementById("sheet"),
  sheetTitle: document.getElementById("sheetTitle"),
  sheetHint: document.getElementById("sheetHint")
};

const SHEET_COPY = {
  runout: {
    title: "Run out",
    hint: "How many runs were completed before the wicket?"
  },
  "wide+": {
    title: "Wide",
    hint: "2 runs added. How many more were run?"
  },
  "noball+": {
    title: "No ball",
    hint: "2 runs added. How many came off the bat?"
  }
};

/* --- scoring ----------------------------------------------------------- */

function toOvers(balls) {
  const over = Math.floor(balls / BALLS_PER_OVER);
  const ball = balls % BALLS_PER_OVER;
  return `${over}.${ball}`;
}

function getTeam(teamKey) {
  return state.teams[teamKey];
}

function plural(count, word) {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

function otherTeamKey(teamKey) {
  return teamKey === "home" ? "away" : "home";
}

function activeTeam() {
  return getTeam(state.activeTeam);
}

function isInningsComplete(teamKey) {
  const team = getTeam(teamKey);
  return team.wickets >= state.maxWickets || team.balls >= state.maxOvers * BALLS_PER_OVER;
}

function ballsRemaining(teamKey) {
  return Math.max(0, state.maxOvers * BALLS_PER_OVER - getTeam(teamKey).balls);
}

function inningsEndReason(teamKey) {
  const team = getTeam(teamKey);
  return team.wickets >= state.maxWickets
    ? `${team.name} are all out for ${team.runs}.`
    : `${team.name} finished on ${team.runs} from ${plural(state.maxOvers, "over")}.`;
}

// A result exists only once the side batting first has finished: until then there is
// nothing to chase. Returns null while the match is still live.
function matchResult() {
  const firstKey = state.firstInnings;
  if (!firstKey || !isInningsComplete(firstKey)) return null;

  const secondKey = otherTeamKey(firstKey);
  const first = getTeam(firstKey);
  const second = getTeam(secondKey);

  if (second.runs > first.runs) {
    const inHand = state.maxWickets - second.wickets;
    const margin = inHand > 0 ? ` by ${plural(inHand, "wicket")}` : "";
    return `${second.name} won${margin}`;
  }

  if (!isInningsComplete(secondKey)) return null;

  return second.runs === first.runs
    ? "Match tied"
    : `${first.name} won by ${plural(first.runs - second.runs, "run")}`;
}

// Frozen means the scorer has deliberately closed this innings, or the whole match:
// nothing more goes in and nothing comes back out, short of reopening it.
function isFrozen(teamKey) {
  return state.matchEnded || getTeam(teamKey).inningsEnded;
}

function isScoringClosed(teamKey) {
  return isFrozen(teamKey) || Boolean(matchResult()) || isInningsComplete(teamKey);
}

function matchStatusText() {
  const result = matchResult();
  if (result) return result;
  if (state.matchEnded) return "Match over.";

  const team = activeTeam();
  if (team.inningsEnded) {
    return `${team.name} scored ${team.runs}/${team.wickets}. This innings is closed.`;
  }

  const firstKey = state.firstInnings;

  if (firstKey && isInningsComplete(firstKey)) {
    const chaseKey = otherTeamKey(firstKey);
    const chase = getTeam(chaseKey);
    const needed = getTeam(firstKey).runs + 1 - chase.runs;

    if (state.activeTeam === chaseKey) {
      return `${chase.name} need ${plural(needed, "run")} from ${plural(ballsRemaining(chaseKey), "ball")}.`;
    }

    return `${inningsEndReason(firstKey)} ${chase.name} need ${plural(needed, "run")} to win.`;
  }

  if (isInningsComplete(state.activeTeam)) {
    return inningsEndReason(state.activeTeam);
  }

  return null;
}

function uploadNote() {
  const resetHint = "Reset the match in setup to score a new one.";
  if (!SHEET_ENDPOINT) return resetHint;

  switch (state.upload.status) {
    case "sending":
      return "Saving this match to the sheet.";
    case "sent":
      return `Saved to the match sheet. ${resetHint}`;
    case "failed":
      return `Could not save to the match sheet, ${state.upload.error}. The match is still on this phone.`;
    default:
      return resetHint;
  }
}

// At most one action is offered at a time, and only once it is the obvious next step.
function statusAction() {
  if (state.matchEnded) {
    return state.upload.status === "failed"
      ? { action: "retry-upload", label: "Retry upload", tone: "quiet" }
      : null;
  }
  if (matchResult()) return { action: "end-match", label: "End match", tone: "primary" };
  if (activeTeam().inningsEnded) return { action: "reopen-innings", label: "Reopen innings", tone: "quiet" };
  if (isInningsComplete(state.activeTeam)) return { action: "end-innings", label: "End innings", tone: "primary" };
  return null;
}

function createTeamSnapshot(team) {
  return {
    runs: team.runs,
    wickets: team.wickets,
    balls: team.balls,
    deliveries: [...team.deliveries]
  };
}

function pushHistory(teamKey) {
  const team = getTeam(teamKey);
  team.history.push(createTeamSnapshot(team));
}

function recordDelivery(teamKey, event, runs, isLegalBall, isWicket = false, extraRuns = null) {
  const team = getTeam(teamKey);
  team.deliveries.push({
    event,
    runs,
    isLegalBall,
    isWicket,
    extraRuns
  });
}

function applyScoringEvent(teamKey, eventData) {
  if (isScoringClosed(teamKey)) return;
  if (!state.firstInnings) {
    state.firstInnings = teamKey;
    state.matchId = createMatchId();
  }

  const team = getTeam(teamKey);
  const {
    event,
    runs = 0,
    isLegalBall = false,
    isWicket = false,
    extraRuns = null
  } = eventData;

  pushHistory(teamKey);
  team.runs += runs;
  if (isWicket) team.wickets += 1;
  if (isLegalBall) team.balls += 1;

  recordDelivery(teamKey, event, runs, isLegalBall, isWicket, extraRuns);
  updateUI();
}

function addRun(teamKey, runs) {
  applyScoringEvent(teamKey, {
    event: "run",
    runs,
    isLegalBall: true,
    isWicket: false
  });
}

function addWicket(teamKey) {
  applyScoringEvent(teamKey, {
    event: "wicket",
    runs: 0,
    isLegalBall: true,
    isWicket: true
  });
}

function addRunOut(teamKey, runs) {
  const safeRuns = Number.isFinite(runs) && runs >= 0 ? Math.floor(runs) : 0;
  applyScoringEvent(teamKey, {
    event: "runout",
    runs: safeRuns,
    isLegalBall: true,
    isWicket: true
  });
}

function addExtraPlus(teamKey, mode, additionalRuns) {
  const safeRuns = Number.isFinite(additionalRuns) && additionalRuns >= 0 ? Math.floor(additionalRuns) : 0;
  applyScoringEvent(teamKey, {
    event: mode,
    runs: EXTRA_PENALTY_RUNS + safeRuns,
    isLegalBall: false,
    isWicket: false,
    extraRuns: safeRuns
  });
}

function undo(teamKey) {
  if (isFrozen(teamKey)) return;

  const team = getTeam(teamKey);
  const last = team.history.pop();
  if (!last) return;

  team.runs = last.runs;
  team.wickets = last.wickets;
  team.balls = last.balls;
  team.deliveries = Array.isArray(last.deliveries) ? [...last.deliveries] : [];

  // Undoing back to an empty match forgets who batted first, so the next ball decides again.
  if (TEAM_KEYS.every(key => getTeam(key).deliveries.length === 0)) {
    state.firstInnings = null;
    state.matchId = null;
  }

  updateUI();
}

function endInnings() {
  const team = activeTeam();
  if (team.inningsEnded) return;

  team.inningsEnded = true;
  state.activeTeam = otherTeamKey(state.activeTeam);
  state.pendingExtra = null;
  updateUI();
}

function reopenInnings() {
  activeTeam().inningsEnded = false;
  updateUI();
}

function createMatchId() {
  // randomUUID needs a secure context, which a phone on a plain http LAN address is not.
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `m-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function buildMatchRecord() {
  const firstKey = state.firstInnings ?? "home";
  const innings = teamKey => {
    const team = getTeam(teamKey);
    return {
      team: team.name,
      runs: team.runs,
      wickets: team.wickets,
      overs: toOvers(team.balls)
    };
  };

  return {
    matchId: state.matchId,
    playedAt: new Date().toISOString(),
    oversEach: state.maxOvers,
    wicketsEach: state.maxWickets,
    first: innings(firstKey),
    second: innings(otherTeamKey(firstKey)),
    result: matchResult() ?? "No result"
  };
}

function uploadFailureReason(error) {
  if (error.name === "AbortError") return "it timed out";
  // fetch reports every network-level problem the same way: offline, DNS, blocked, CORS.
  if (error.name === "TypeError") return "the phone could not reach it";
  return error.message;
}

async function uploadMatch() {
  if (!SHEET_ENDPOINT || state.upload.status === "sending") return;

  state.upload = { status: "sending", error: null };
  updateUI();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(SHEET_ENDPOINT, {
      method: "POST",
      // text/plain keeps this a simple request, so the browser skips the CORS preflight
      // that Apps Script web apps do not answer.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(buildMatchRecord()),
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`the sheet replied ${response.status}`);

    // A deployment that is not open to "Anyone" answers with a sign-in page and a 200,
    // so nothing counts as saved without an explicit ok.
    let body = null;
    try {
      body = JSON.parse(await response.text());
    } catch {
      body = null;
    }
    if (body?.ok !== true) throw new Error("the sheet did not confirm the save");

    state.upload = { status: "sent", error: null };
  } catch (error) {
    state.upload = { status: "failed", error: uploadFailureReason(error) };
  } finally {
    clearTimeout(timer);
    updateUI();
  }
}

function endMatch() {
  state.matchEnded = true;
  state.pendingExtra = null;
  updateUI();
  // Deliberately not awaited: the match is already frozen and saved on the phone,
  // so a slow or dead sheet must not hold up the result.
  uploadMatch();
}

function resetMatch() {
  for (const teamKey of TEAM_KEYS) {
    const team = getTeam(teamKey);
    team.runs = 0;
    team.wickets = 0;
    team.balls = 0;
    team.deliveries = [];
    team.history = [];
    team.inningsEnded = false;
  }

  state.activeTeam = "home";
  state.firstInnings = null;
  state.matchEnded = false;
  state.matchId = null;
  state.upload = { status: "idle", error: null };
  closeSheet();
  syncSetupInputs();
  updateUI();
}

/* --- reading the scorebook --------------------------------------------- */

function extraRunsOf(ball) {
  // offBatRuns is the pre-Wide+ field name, still present in saved matches.
  const value = Number(ball.extraRuns ?? ball.offBatRuns);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function deliveryToken(ball) {
  switch (ball.event) {
    case "wicket":
      return { text: "W", kind: "wicket" };
    case "runout":
      return { text: ball.runs > 0 ? `W+${ball.runs}` : "W", kind: "wicket" };
    case "wide":
      return { text: "Wd", kind: "extra" };
    case "wide+": {
      const extra = extraRunsOf(ball);
      return { text: extra > 0 ? `Wd+${extra}` : "Wd", kind: "extra" };
    }
    case "noball":
    case "no-ball":
      return { text: "Nb", kind: "extra" };
    case "noball+": {
      const extra = extraRunsOf(ball);
      return { text: extra > 0 ? `Nb+${extra}` : "Nb", kind: "extra" };
    }
    default: {
      const runs = Number(ball.runs) || 0;
      if (runs === 0) return { text: "", kind: "dot" };
      return { text: String(runs), kind: runs >= 4 ? "boundary" : "run" };
    }
  }
}

function groupIntoOvers(deliveries) {
  const overs = [];
  const newOver = () => ({ legalBalls: 0, runs: 0, wickets: 0, tokens: [] });
  let current = newOver();

  if (!Array.isArray(deliveries)) return [current];

  for (const ball of deliveries) {
    current.runs += Number(ball.runs) || 0;
    if (ball.isWicket) current.wickets += 1;
    current.tokens.push(deliveryToken(ball));
    if (ball.isLegalBall) current.legalBalls += 1;

    if (current.legalBalls === BALLS_PER_OVER) {
      overs.push(current);
      current = newOver();
    }
  }

  // The trailing over is always kept, even when empty: it is the one in progress.
  overs.push(current);
  return overs;
}

/* --- rendering ---------------------------------------------------------- */

function renderOverStrip(team) {
  const overs = groupIntoOvers(team.deliveries);
  const current = overs[overs.length - 1];
  const strip = ui.overStrip;
  strip.innerHTML = "";

  for (const token of current.tokens) {
    const box = document.createElement("span");
    box.className = `ball ball--${token.kind}`;
    box.textContent = token.text;
    strip.appendChild(box);
  }

  for (let i = current.legalBalls; i < BALLS_PER_OVER; i += 1) {
    const box = document.createElement("span");
    box.className = "ball ball--empty";
    strip.appendChild(box);
  }

  strip.scrollLeft = strip.scrollWidth;
}

function renderHistory(team) {
  const list = ui.overList;
  list.innerHTML = "";

  const overs = groupIntoOvers(team.deliveries).filter(over => over.tokens.length > 0);

  if (overs.length === 0) {
    const li = document.createElement("li");
    li.className = "is-empty";
    li.textContent = "Nothing bowled yet.";
    list.appendChild(li);
    return;
  }

  overs.forEach((over, index) => {
    const li = document.createElement("li");

    const head = document.createElement("div");
    head.className = "history-head";
    const label = document.createElement("span");
    label.textContent = `Over ${index + 1}`;
    const tally = document.createElement("span");
    const wicketText = over.wickets > 0
      ? `, ${over.wickets} ${over.wickets === 1 ? "wicket" : "wickets"}`
      : "";
    tally.textContent = `${over.runs} ${over.runs === 1 ? "run" : "runs"}${wicketText}`;
    head.append(label, tally);

    const balls = document.createElement("div");
    balls.className = "history-balls";
    balls.textContent = over.tokens.map(token => token.text || "0").join("   ");

    li.append(head, balls);
    list.appendChild(li);
  });
}

function renderMatchStatus() {
  const text = matchStatusText();
  const action = statusAction();

  for (const button of ui.pad.querySelectorAll("button")) {
    button.disabled = isScoringClosed(state.activeTeam);
  }
  ui.undoBtn.disabled = isFrozen(state.activeTeam);

  ui.matchStatus.hidden = !text;
  ui.matchStatus.classList.toggle("match-status--result", Boolean(matchResult()));
  if (text) ui.matchStatusText.textContent = text;

  ui.matchStatusAction.hidden = !action;
  if (action) {
    ui.matchStatusAction.dataset.action = action.action;
    ui.matchStatusAction.classList.toggle("match-status-action--primary", action.tone === "primary");
    ui.matchStatusAction.classList.toggle("match-status-action--quiet", action.tone === "quiet");
    // An armed confirm owns the label until it resolves or times out.
    if (!isConfirmArmed(ui.matchStatusAction)) ui.matchStatusAction.textContent = action.label;
  }

  ui.matchStatusNote.hidden = !state.matchEnded;
  if (state.matchEnded) {
    ui.matchStatusNote.textContent = uploadNote();
  }
}

function renderLastBall(team) {
  const last = team.deliveries[team.deliveries.length - 1];
  ui.lastBall.textContent = last
    ? `Last ball: ${deliveryToken(last).text || "no run"}`
    : "No balls bowled yet";
}

function renderSheet() {
  const mode = state.pendingExtra;
  ui.sheet.hidden = !mode;
  ui.backdrop.hidden = !mode;

  if (!mode) return;
  const copy = SHEET_COPY[mode];
  if (!copy) return;
  ui.sheetTitle.textContent = copy.title;
  ui.sheetHint.textContent = copy.hint;
}

function render() {
  const team = activeTeam();

  ui.homeName.textContent = state.teams.home.name;
  ui.awayName.textContent = state.teams.away.name;
  ui.homeScore.textContent = `${state.teams.home.runs}/${state.teams.home.wickets}`;
  ui.awayScore.textContent = `${state.teams.away.runs}/${state.teams.away.wickets}`;

  for (const button of document.querySelectorAll("[data-action='switch-team']")) {
    button.setAttribute("aria-pressed", String(button.dataset.team === state.activeTeam));
  }

  ui.runs.textContent = team.runs;
  ui.wickets.textContent = team.wickets;
  ui.oversText.textContent = `${toOvers(team.balls)} of ${plural(state.maxOvers, "over")}`;

  const rate = team.balls > 0 ? (team.runs * BALLS_PER_OVER) / team.balls : 0;
  ui.rateText.textContent = `${rate.toFixed(2)} an over`;

  renderOverStrip(team);
  renderMatchStatus();
  renderLastBall(team);
  renderHistory(team);
  renderSheet();
}

function updateUI() {
  render();
  saveState();
}

/* --- storage ------------------------------------------------------------ */

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing and a full quota both throw here. Scoring carries on in memory.
  }
}

// Matches saved before innings order was tracked: the only side with balls bowled
// batted first, and if both have batted the app started on home, so home did.
function inferFirstInnings(teams) {
  const batted = TEAM_KEYS.filter(key => (teams?.[key]?.deliveries ?? []).length > 0);
  if (batted.length === 0) return null;
  return batted.length === 1 ? batted[0] : "home";
}

// An upload still in flight when the page closed has an unknowable outcome, so it
// comes back as failed and the scorer gets a retry rather than a false "saved".
function restoreUploadState(saved) {
  const status = saved?.status;
  if (status === "sent") return { status: "sent", error: null };
  if (status === "failed") return { status: "failed", error: saved.error ?? "it did not finish" };
  if (status === "sending") return { status: "failed", error: "the app closed mid-upload" };
  return { status: "idle", error: null };
}

function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;

  try {
    const saved = JSON.parse(raw);
    if (!saved?.teams?.home || !saved?.teams?.away) return false;

    state.maxOvers = Number(saved.maxOvers) > 0 ? Math.floor(Number(saved.maxOvers)) : DEFAULT_MAX_OVERS;
    state.maxWickets = Number(saved.maxWickets) > 0 ? Math.floor(Number(saved.maxWickets)) : DEFAULT_MAX_WICKETS;
    if (TEAM_KEYS.includes(saved.activeTeam)) state.activeTeam = saved.activeTeam;
    state.firstInnings = TEAM_KEYS.includes(saved.firstInnings)
      ? saved.firstInnings
      : inferFirstInnings(saved.teams);
    state.matchEnded = Boolean(saved.matchEnded);
    state.matchId = typeof saved.matchId === "string" ? saved.matchId : null;
    state.upload = restoreUploadState(saved.upload);

    for (const teamKey of TEAM_KEYS) {
      state.teams[teamKey] = { ...state.teams[teamKey], ...saved.teams[teamKey] };
      const team = getTeam(teamKey);
      team.deliveries = Array.isArray(team.deliveries) ? team.deliveries : [];
      team.history = Array.isArray(team.history) ? team.history : [];
      team.inningsEnded = Boolean(team.inningsEnded);
    }
    return true;
  } catch {
    return false;
  }
}

/* --- interaction --------------------------------------------------------- */

function openSheet(mode) {
  state.pendingExtra = mode;
  render();
}

function closeSheet() {
  state.pendingExtra = null;
  render();
}

function applyPendingExtraRuns(runs) {
  const mode = state.pendingExtra;
  if (!mode) return;

  const safeRuns = Number.isFinite(runs) && runs >= 0 ? Math.floor(runs) : 0;

  if (mode === "runout") {
    addRunOut(state.activeTeam, safeRuns);
  } else if (mode === "noball+" || mode === "wide+") {
    addExtraPlus(state.activeTeam, mode, safeRuns);
  }

  closeSheet();
}

function setActiveTeam(teamKey) {
  if (!TEAM_KEYS.includes(teamKey) || teamKey === state.activeTeam) return;
  state.activeTeam = teamKey;
  state.pendingExtra = null;
  updateUI();
}

function setSetupOpen(open) {
  ui.setupPanel.hidden = !open;
  ui.setupToggle.setAttribute("aria-expanded", String(open));
}

const armedConfirms = new Map();

function isConfirmArmed(button) {
  return armedConfirms.has(button);
}

function disarmConfirm(button) {
  const armed = armedConfirms.get(button);
  if (!armed) return;
  clearTimeout(armed.timer);
  armedConfirms.delete(button);
  button.classList.remove("confirming");
  button.textContent = armed.label;
}

function disarmOtherConfirms(keep) {
  for (const button of [...armedConfirms.keys()]) {
    if (button !== keep) disarmConfirm(button);
  }
}

// Returns true only on the second tap, so the caller can act on it.
function confirmTap(button, prompt) {
  if (isConfirmArmed(button)) {
    disarmConfirm(button);
    return true;
  }

  armedConfirms.set(button, {
    label: button.textContent,
    timer: setTimeout(() => disarmConfirm(button), 4000)
  });
  button.classList.add("confirming");
  button.textContent = prompt;
  return false;
}

function buzz() {
  // Android only; iOS has no vibration API. Silent when unsupported or denied.
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(8);
  } catch {
    // A blocked vibration must never interrupt scoring.
  }
}

function handleAction(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger || trigger.disabled) return;

  const action = trigger.dataset.action;
  const team = state.activeTeam;

  const handlers = {
    run: () => addRun(team, Number(trigger.dataset.value)),
    wicket: () => addWicket(team),
    runout: () => openSheet("runout"),
    "wide+": () => openSheet("wide+"),
    "noball+": () => openSheet("noball+"),
    "extra-run": () => applyPendingExtraRuns(Number(trigger.dataset.value)),
    "extra-cancel": () => closeSheet(),
    undo: () => undo(team),
    "switch-team": () => setActiveTeam(trigger.dataset.team),
    "toggle-setup": () => setSetupOpen(ui.setupPanel.hidden),
    "close-setup": () => setSetupOpen(false),
    "end-innings": () => endInnings(),
    "reopen-innings": () => reopenInnings(),
    "retry-upload": () => uploadMatch(),
    "end-match": () => {
      if (confirmTap(ui.matchStatusAction, "Tap again to end")) endMatch();
    },
    "reset-match": () => {
      if (confirmTap(ui.resetBtn, "Tap again to clear")) resetMatch();
    }
  };

  const handler = handlers[action];
  if (!handler) return;

  disarmOtherConfirms(trigger);
  buzz();
  handler();
}

function syncSetupInputs() {
  ui.homeTeamInput.value = state.teams.home.name;
  ui.awayTeamInput.value = state.teams.away.name;
  ui.maxOversInput.value = state.maxOvers;
  ui.maxWicketsInput.value = state.maxWickets;
}

function bindSetupInputs() {
  const rename = (teamKey, input, fallback) => {
    input.addEventListener("input", () => {
      getTeam(teamKey).name = input.value.trim() || fallback;
      updateUI();
    });
  };

  rename("home", ui.homeTeamInput, "Home");
  rename("away", ui.awayTeamInput, "Opponent");

  const bindWholeNumber = (input, apply) => {
    input.addEventListener("input", () => {
      const value = Number(input.value);
      // A half-typed or cleared box is left alone rather than snapped to a default.
      if (!Number.isFinite(value) || value <= 0) return;
      apply(Math.floor(value));
      updateUI();
    });
  };

  bindWholeNumber(ui.maxOversInput, value => {
    state.maxOvers = value;
  });

  bindWholeNumber(ui.maxWicketsInput, value => {
    state.maxWickets = value;
  });
}

function init() {
  const hadSavedMatch = loadState();
  syncSetupInputs();
  bindSetupInputs();

  document.body.addEventListener("click", handleAction);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.pendingExtra) closeSheet();
  });

  // A fresh phone opens on setup: name the teams before the first ball.
  setSetupOpen(!hadSavedMatch);
  render();
}

init();
