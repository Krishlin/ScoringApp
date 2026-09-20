const STORAGE_KEY = "cricket-scoring-state-v1";
// House rule: a wide or no ball is worth 2, before any runs actually run.
const EXTRA_PENALTY_RUNS = 2;
const BALLS_PER_OVER = 6;
const DEFAULT_MAX_OVERS = 5;
const DEFAULT_MAX_WICKETS = 8;
const TEAM_KEYS = ["home", "away"];

const state = {
  maxOvers: DEFAULT_MAX_OVERS,
  maxWickets: DEFAULT_MAX_WICKETS,
  activeTeam: "home",
  // Whoever is scored first bats first, which is what makes the second innings a chase.
  firstInnings: null,
  pendingExtra: null,
  teams: {
    home: {
      name: "Home",
      runs: 0,
      wickets: 0,
      balls: 0,
      deliveries: [],
      history: []
    },
    away: {
      name: "Opponent",
      runs: 0,
      wickets: 0,
      balls: 0,
      deliveries: [],
      history: []
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

function isScoringClosed(teamKey) {
  return Boolean(matchResult()) || isInningsComplete(teamKey);
}

function matchStatus() {
  const result = matchResult();
  if (result) return { kind: "result", text: result };

  const firstKey = state.firstInnings;

  if (firstKey && isInningsComplete(firstKey)) {
    const chaseKey = otherTeamKey(firstKey);
    const chase = getTeam(chaseKey);
    const needed = getTeam(firstKey).runs + 1 - chase.runs;

    if (state.activeTeam === chaseKey) {
      return {
        kind: "target",
        text: `${chase.name} need ${plural(needed, "run")} from ${plural(ballsRemaining(chaseKey), "ball")}.`
      };
    }

    return {
      kind: "innings",
      text: `${inningsEndReason(firstKey)} ${chase.name} need ${plural(needed, "run")} to win, so tap them above to start the chase.`
    };
  }

  if (isInningsComplete(state.activeTeam)) {
    const other = getTeam(otherTeamKey(state.activeTeam));
    return {
      kind: "innings",
      text: `${inningsEndReason(state.activeTeam)} Tap ${other.name} above to score their innings, or undo the last ball.`
    };
  }

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
  if (!state.firstInnings) state.firstInnings = teamKey;

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
  }

  updateUI();
}

function resetMatch() {
  for (const teamKey of TEAM_KEYS) {
    const team = getTeam(teamKey);
    team.runs = 0;
    team.wickets = 0;
    team.balls = 0;
    team.deliveries = [];
    team.history = [];
  }

  state.activeTeam = "home";
  state.firstInnings = null;
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
  const status = matchStatus();

  for (const button of ui.pad.querySelectorAll("button")) {
    button.disabled = isScoringClosed(state.activeTeam);
  }

  ui.matchStatus.hidden = !status;
  ui.matchStatus.classList.toggle("match-status--result", status?.kind === "result");
  if (status) ui.matchStatus.textContent = status.text;
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

    for (const teamKey of TEAM_KEYS) {
      state.teams[teamKey] = { ...state.teams[teamKey], ...saved.teams[teamKey] };
      const team = getTeam(teamKey);
      team.deliveries = Array.isArray(team.deliveries) ? team.deliveries : [];
      team.history = Array.isArray(team.history) ? team.history : [];
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

let resetConfirmTimer = null;

function clearResetConfirm() {
  if (resetConfirmTimer) clearTimeout(resetConfirmTimer);
  resetConfirmTimer = null;
  ui.resetBtn.classList.remove("confirming");
  ui.resetBtn.textContent = "Reset match";
}

function handleReset() {
  if (resetConfirmTimer) {
    clearResetConfirm();
    resetMatch();
    return;
  }

  ui.resetBtn.classList.add("confirming");
  ui.resetBtn.textContent = "Tap again to clear";
  resetConfirmTimer = setTimeout(clearResetConfirm, 4000);
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
    "reset-match": () => handleReset()
  };

  const handler = handlers[action];
  if (!handler) return;

  if (action !== "reset-match") clearResetConfirm();
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
