const STORAGE_KEY = "cricket-scoring-state-v1";
const TEAM_KEYS = ["home", "away"];

const state = {
  maxOvers: 20,
  pendingExtras: {
    home: null,
    away: null
  },
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
  saveTeamsBtn: document.getElementById("saveTeamsBtn"),
  resetMatchBtn: document.getElementById("resetMatchBtn"),
  homeTitle: document.getElementById("homeTitle"),
  awayTitle: document.getElementById("awayTitle"),
  homeRuns: document.getElementById("homeRuns"),
  homeWickets: document.getElementById("homeWickets"),
  homeOvers: document.getElementById("homeOvers"),
  homeOverSummary: document.getElementById("homeOverSummary"),
  homeExtraPanel: document.getElementById("homeExtraPanel"),
  homeExtraLabel: document.getElementById("homeExtraLabel"),
  awayRuns: document.getElementById("awayRuns"),
  awayWickets: document.getElementById("awayWickets"),
  awayOvers: document.getElementById("awayOvers"),
  awayOverSummary: document.getElementById("awayOverSummary"),
  awayExtraPanel: document.getElementById("awayExtraPanel"),
  awayExtraLabel: document.getElementById("awayExtraLabel"),
  summaryText: document.getElementById("summaryText")
};

function toOvers(balls) {
  const over = Math.floor(balls / 6);
  const ball = balls % 6;
  return `${over}.${ball}`;
}

function getTeam(teamKey) {
  return state.teams[teamKey];
}

function isInningsComplete(teamKey) {
  const team = getTeam(teamKey);
  return team.wickets >= 10 || team.balls >= state.maxOvers * 6;
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

function recordDelivery(teamKey, event, runs, isLegalBall, isWicket = false, offBatRuns = null) {
  const team = getTeam(teamKey);
  team.deliveries.push({
    event,
    runs,
    isLegalBall,
    isWicket,
    offBatRuns
  });
}

function applyScoringEvent(teamKey, eventData) {
  if (isInningsComplete(teamKey)) return;

  const team = getTeam(teamKey);
  const {
    event,
    runs = 0,
    isLegalBall = false,
    isWicket = false,
    offBatRuns = null,
    statusText = ""
  } = eventData;

  pushHistory(teamKey);
  team.runs += runs;
  if (isWicket) team.wickets += 1;
  if (isLegalBall) team.balls += 1;

  recordDelivery(teamKey, event, runs, isLegalBall, isWicket, offBatRuns);
  updateUI(statusText || `${team.name}: ${event.toUpperCase()} +${runs}`);
}

function setPendingExtra(teamKey, mode) {
  state.pendingExtras[teamKey] = mode;
  renderPendingExtraPanels();
}

function clearPendingExtra(teamKey) {
  state.pendingExtras[teamKey] = null;
  renderPendingExtraPanels();
}

function clearPendingExtras() {
  for (const teamKey of TEAM_KEYS) {
    state.pendingExtras[teamKey] = null;
  }
  renderPendingExtraPanels();
}

function pendingLabel(mode) {
  if (mode === "runout") return "Run-out+: select completed runs";
  if (mode === "noball+") return "No Ball+: select runs off bat";
  return "Select runs";
}

function renderPendingExtraPanels() {
  const bindings = {
    home: { panel: ui.homeExtraPanel, label: ui.homeExtraLabel },
    away: { panel: ui.awayExtraPanel, label: ui.awayExtraLabel }
  };

  for (const teamKey of TEAM_KEYS) {
    const mode = state.pendingExtras[teamKey];
    const target = bindings[teamKey];
    if (!target) continue;

    target.panel.classList.toggle("hidden", !mode);
    target.label.textContent = pendingLabel(mode);
  }
}

function overSummaryLines(teamKey) {
  const deliveries = getTeam(teamKey).deliveries;
  if (!Array.isArray(deliveries) || deliveries.length === 0) {
    return ["No overs yet."];
  }

  const overs = [];
  let current = {
    legalBalls: 0,
    runs: 0,
    wickets: 0,
    ballsView: []
  };

  for (const ball of deliveries) {
    current.runs += Number(ball.runs) || 0;
    if (ball.isWicket) current.wickets += 1;

    current.ballsView.push(formatDeliveryToken(ball));

    if (ball.isLegalBall) {
      current.legalBalls += 1;
    }

    if (current.legalBalls === 6) {
      overs.push(current);
      current = {
        legalBalls: 0,
        runs: 0,
        wickets: 0,
        ballsView: []
      };
    }
  }

  if (current.ballsView.length > 0) {
    overs.push(current);
  }

  return overs.map((over, index) => {
    const wicketText = over.wickets > 0 ? `, ${over.wickets} wicket${over.wickets > 1 ? "s" : ""}` : "";
    const ballCountText = `${over.legalBalls}/6 balls`;
    return `Over ${index + 1} (${ballCountText}): ${over.runs} run${over.runs === 1 ? "" : "s"}${wicketText} (${over.ballsView.join(" ")})`;
  });
}

function formatDeliveryToken(ball) {
  switch (ball.event) {
    case "wicket":
      return "W";
    case "runout":
      return ball.runs > 0 ? `W+${ball.runs}` : "W";
    case "wide":
      return "Wd";
    case "noball":
    case "no-ball":
      return "Nb";
    case "noball+": {
      const offBat = Number(ball.offBatRuns);
      return Number.isFinite(offBat) && offBat > 0 ? `Nb+${offBat}` : "Nb";
    }
    default:
      return String(ball.runs);
  }
}

function renderOverSummary(teamKey) {
  const listElement = teamKey === "home" ? ui.homeOverSummary : ui.awayOverSummary;
  const lines = overSummaryLines(teamKey);

  listElement.innerHTML = "";
  for (const line of lines) {
    const li = document.createElement("li");
    li.textContent = line;
    listElement.appendChild(li);
  }
}

function addRun(teamKey, runs, countBall = true, event = "run") {
  const team = getTeam(teamKey);
  applyScoringEvent(teamKey, {
    event,
    runs,
    isLegalBall: countBall,
    isWicket: false,
    statusText: `${team.name}: ${event.toUpperCase()} +${runs}`
  });
}

function addWicket(teamKey) {
  const team = getTeam(teamKey);
  applyScoringEvent(teamKey, {
    event: "wicket",
    runs: 0,
    isLegalBall: true,
    isWicket: true,
    statusText: `${team.name}: WICKET`
  });
}

function addRunOut(teamKey, runs) {
  const safeRuns = Number.isFinite(runs) && runs >= 0 ? Math.floor(runs) : 0;
  const team = getTeam(teamKey);
  applyScoringEvent(teamKey, {
    event: "runout",
    runs: safeRuns,
    isLegalBall: true,
    isWicket: true,
    statusText: `${team.name}: RUN-OUT +${safeRuns}`
  });
}

function addLegalBall(teamKey) {
  const team = getTeam(teamKey);
  applyScoringEvent(teamKey, {
    event: "dot",
    runs: 0,
    isLegalBall: true,
    isWicket: false,
    statusText: `${team.name}: dot ball`
  });
}

function addNoBallPlus(teamKey, runsOffBat) {
  const safeRuns = Number.isFinite(runsOffBat) && runsOffBat >= 0 ? Math.floor(runsOffBat) : 0;
  const team = getTeam(teamKey);
  const totalRuns = 1 + safeRuns;
  applyScoringEvent(teamKey, {
    event: "noball+",
    runs: totalRuns,
    isLegalBall: false,
    isWicket: false,
    offBatRuns: safeRuns,
    statusText: `${team.name}: NO-BALL +${safeRuns} (total +${totalRuns})`
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

  updateUI(`${team.name}: undo successful`);
}

function saveTeamDetails() {
  const homeName = ui.homeTeamInput.value.trim();
  const awayName = ui.awayTeamInput.value.trim();
  const maxOvers = Number(ui.maxOversInput.value);

  if (homeName) state.teams.home.name = homeName;
  if (awayName) state.teams.away.name = awayName;
  if (Number.isFinite(maxOvers) && maxOvers > 0) state.maxOvers = maxOvers;

  updateUI("Team details saved");
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

  updateUI("Match reset");
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const saved = JSON.parse(raw);

    if (saved?.teams?.home && saved?.teams?.away) {
      state.maxOvers = Number(saved.maxOvers) || 20;
      state.teams.home = { ...state.teams.home, ...saved.teams.home };
      state.teams.away = { ...state.teams.away, ...saved.teams.away };
      for (const teamKey of TEAM_KEYS) {
        const team = getTeam(teamKey);
        team.deliveries = Array.isArray(team.deliveries) ? team.deliveries : [];
        team.history = Array.isArray(team.history) ? team.history : [];
      }
    }
  } catch {
    // ignore invalid local storage data
  }
}

function render() {
  ui.homeTitle.textContent = state.teams.home.name;
  ui.awayTitle.textContent = state.teams.away.name;

  ui.homeRuns.textContent = state.teams.home.runs;
  ui.homeWickets.textContent = state.teams.home.wickets;
  ui.homeOvers.textContent = toOvers(state.teams.home.balls);

  ui.awayRuns.textContent = state.teams.away.runs;
  ui.awayWickets.textContent = state.teams.away.wickets;
  ui.awayOvers.textContent = toOvers(state.teams.away.balls);

  ui.homeTeamInput.value = state.teams.home.name;
  ui.awayTeamInput.value = state.teams.away.name;
  ui.maxOversInput.value = state.maxOvers;
  renderOverSummary("home");
  renderOverSummary("away");

  const homeRate = state.teams.home.balls > 0
    ? (state.teams.home.runs * 6) / state.teams.home.balls
    : 0;

  const awayRate = state.teams.away.balls > 0
    ? (state.teams.away.runs * 6) / state.teams.away.balls
    : 0;

  ui.summaryText.textContent = `${state.teams.home.name}: ${state.teams.home.runs}/${state.teams.home.wickets} (${toOvers(state.teams.home.balls)} overs, RR ${homeRate.toFixed(2)}) | ${state.teams.away.name}: ${state.teams.away.runs}/${state.teams.away.wickets} (${toOvers(state.teams.away.balls)} overs, RR ${awayRate.toFixed(2)})`;
}

function updateUI(statusText) {
  render();
  if (statusText) {
    ui.summaryText.textContent = `${ui.summaryText.textContent} — ${statusText}`;
  }
  saveState();
}

function applyPendingExtraRuns(teamKey, runs) {
  const mode = state.pendingExtras[teamKey];
  if (!mode) return;

  const safeRuns = Number.isFinite(runs) && runs >= 0 ? Math.floor(runs) : 0;

  if (mode === "runout") {
    addRunOut(teamKey, safeRuns);
  } else if (mode === "noball+") {
    addNoBallPlus(teamKey, safeRuns);
  }

  clearPendingExtra(teamKey);
}

function handleScoreAction(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const action = target.dataset.action;
  const team = target.dataset.team;

  if (!action || !team) return;

  const selectionActions = new Set(["runout", "noball+", "extra-run", "extra-cancel"]);
  if (state.pendingExtras[team] && !selectionActions.has(action)) {
    clearPendingExtra(team);
  }

  const handlers = {
    run: () => {
      const value = Number(target.dataset.value);
      addRun(team, value, true, "run");
    },
    wicket: () => addWicket(team),
    runout: () => setPendingExtra(team, "runout"),
    ball: () => addLegalBall(team),
    wide: () => addRun(team, 1, false, "wide"),
    noball: () => addRun(team, 1, false, "noball"),
    "noball+": () => setPendingExtra(team, "noball+"),
    "extra-run": () => applyPendingExtraRuns(team, Number(target.dataset.value)),
    "extra-cancel": () => clearPendingExtra(team),
    undo: () => undo(team)
  };

  const handler = handlers[action];
  if (handler) {
    handler();
  }
}

function init() {
  loadState();
  clearPendingExtras();
  render();

  document.querySelector(".scoreboard-grid").addEventListener("click", handleScoreAction);
  ui.saveTeamsBtn.addEventListener("click", saveTeamDetails);
  ui.resetMatchBtn.addEventListener("click", resetMatch);
}

init();
