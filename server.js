const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const TIMELINE_MONTHS = 10;

const DEFAULT_TASK_LIBRARY = [
  { id: "req", name: "Collect Requirements", color: "#2563eb" },
  { id: "arch", name: "Architecture & Design", color: "#7c3aed" },
  { id: "ui", name: "UI/UX Prototyping", color: "#db2777" },
  { id: "backend", name: "Backend Development", color: "#059669" },
  { id: "frontend", name: "Frontend Development", color: "#ea580c" },
  { id: "qa", name: "Testing & QA", color: "#0891b2" },
  { id: "deploy", name: "Deployment", color: "#4f46e5" },
  { id: "docs", name: "Documentation & Handoff", color: "#0f766e" }
];

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_FILE)) {
    const initial = {
      users: {},
      taskLibrary: DEFAULT_TASK_LIBRARY
    };
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), "utf-8");
  }
}

function randomToken() {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

function migrateStore(store) {
  const migrated = { ...store, users: store.users || {}, taskLibrary: store.taskLibrary || DEFAULT_TASK_LIBRARY };
  Object.keys(migrated.users).forEach((username) => {
    if (!migrated.users[username].token) {
      migrated.users[username].token = randomToken();
    }
    if (migrated.users[username].board) {
      delete migrated.users[username].board.reactions;
      delete migrated.users[username].board.comments;
    }
  });
  return migrated;
}

function readStore() {
  ensureStore();
  const raw = fs.readFileSync(STORE_FILE, "utf-8");
  return migrateStore(JSON.parse(raw));
}

function writeStore(store) {
  const tmpFile = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tmpFile, STORE_FILE);
}

function normalizeUsername(input) {
  return String(input || "").trim().replace(/\s+/g, " ");
}

function createDefaultBoard(username) {
  const now = new Date().toISOString();
  return {
    username,
    token: randomToken(),
    board: {
      timeline: [],
      updatedAt: now,
      createdAt: now
    }
  };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/task-library", (req, res) => {
  const store = readStore();
  res.json(store.taskLibrary || DEFAULT_TASK_LIBRARY);
});

app.post("/api/join", (req, res) => {
  const username = normalizeUsername(req.body?.username).slice(0, 30);
  const providedToken = String(req.body?.token || "").trim().slice(0, 200);
  if (!username) {
    return res.status(400).json({ error: "Username is required." });
  }

  const store = readStore();
  if (!store.users[username]) {
    store.users[username] = createDefaultBoard(username);
    writeStore(store);
  } else if (!providedToken || store.users[username].token !== providedToken) {
    return res.status(409).json({ error: "Username already taken on this device." });
  }

  return res.json({ username, token: store.users[username].token });
});

function actorFromHeaders(req) {
  const actor = normalizeUsername(req.headers["x-actor"] || "");
  const token = String(req.headers["x-token"] || "").trim().slice(0, 200);
  return { actor, token };
}

function validateActor(req, store) {
  const { actor, token } = actorFromHeaders(req);
  if (!actor || !token) {
    return { ok: false, code: 401, error: "Missing actor identity." };
  }
  const actorUser = store.users[actor];
  if (!actorUser || actorUser.token !== token) {
    return { ok: false, code: 403, error: "Invalid actor token." };
  }
  return { ok: true, actor };
}

app.get("/api/users", (req, res) => {
  const store = readStore();
  const users = Object.keys(store.users)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ username: name }));
  res.json(users);
});

app.get("/api/board/:username", (req, res) => {
  const username = normalizeUsername(req.params.username);
  const store = readStore();
  const user = store.users[username];
  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }
  return res.json(user.board);
});

app.put("/api/board/:username/timeline", (req, res) => {
  const username = normalizeUsername(req.params.username);
  const incoming = Array.isArray(req.body?.timeline) ? req.body.timeline : null;
  if (!incoming) {
    return res.status(400).json({ error: "Timeline array is required." });
  }

  const timeline = incoming
    .map((item) => ({
      id: String(item.id || ""),
      taskId: String(item.taskId || ""),
      title: String(item.title || ""),
      color: String(item.color || "#2563eb"),
      startMonth: Number(item.startMonth || 1),
      durationMonths: Number(item.durationMonths || 1)
    }))
    .filter((item) => item.id && item.taskId && item.title)
    .map((item) => ({
      ...item,
      startMonth: Math.min(TIMELINE_MONTHS, Math.max(1, Math.round(item.startMonth))),
      durationMonths: Math.min(TIMELINE_MONTHS, Math.max(1, Math.round(item.durationMonths)))
    }))
    .map((item) => {
      const maxDuration = TIMELINE_MONTHS + 1 - item.startMonth;
      return {
        ...item,
        durationMonths: Math.min(item.durationMonths, maxDuration)
      };
    });

  const store = readStore();
  const actorCheck = validateActor(req, store);
  if (!actorCheck.ok) {
    return res.status(actorCheck.code).json({ error: actorCheck.error });
  }
  if (actorCheck.actor !== username) {
    return res.status(403).json({ error: "You can only edit your own timeline." });
  }
  if (!store.users[username]) {
    return res.status(404).json({ error: "User not found." });
  }
  store.users[username].board.timeline = timeline;
  store.users[username].board.updatedAt = new Date().toISOString();
  writeStore(store);
  return res.json({ ok: true, timeline });
});

app.listen(PORT, () => {
  ensureStore();
  console.log(`Workshop planner running at http://localhost:${PORT}`);
});
