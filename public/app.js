const state = {
  currentUser: null,
  currentToken: null,
  viewedUser: null,
  users: [],
  taskLibrary: [],
  board: null
};

const monthCount = 10;

const el = {
  joinSection: document.getElementById("joinSection"),
  joinForm: document.getElementById("joinForm"),
  usernameInput: document.getElementById("usernameInput"),
  usersList: document.getElementById("usersList"),
  sessionInfo: document.getElementById("sessionInfo"),
  boardTitle: document.getElementById("boardTitle"),
  saveStatus: document.getElementById("saveStatus"),
  timelineHeader: document.getElementById("timelineHeader"),
  timelineGrid: document.getElementById("timelineGrid"),
  taskBank: document.getElementById("taskBank")
};

function setJoinSectionVisibility(isVisible) {
  el.joinSection.classList.toggle("hidden", !isVisible);
}

function setSaveStatus(message, tone = "normal") {
  el.saveStatus.textContent = message;
  el.saveStatus.dataset.tone = tone;
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function api(url, options = {}) {
  const incomingHeaders = options.headers || {};
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(state.currentUser && state.currentToken
        ? { "X-Actor": state.currentUser, "X-Token": state.currentToken }
        : {}),
      ...incomingHeaders
    },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Request failed");
  }
  return res.json();
}

function renderTimelineHeader() {
  el.timelineHeader.innerHTML = "";
  for (let i = 1; i <= monthCount; i += 1) {
    const cell = document.createElement("div");
    cell.className = "month-cell";
    cell.textContent = `Month ${i}`;
    el.timelineHeader.appendChild(cell);
  }
}

function renderTaskBank() {
  el.taskBank.innerHTML = "";
  state.taskLibrary.forEach((task) => {
    const chip = document.createElement("div");
    chip.className = "task-chip";
    chip.draggable = true;
    chip.style.background = task.color;
    chip.textContent = task.name;
    chip.dataset.taskId = task.id;
    chip.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("application/json", JSON.stringify(task));
    });
    el.taskBank.appendChild(chip);
  });
}

function computeLeft(startMonth) {
  return ((startMonth - 1) / monthCount) * 100;
}

function computeWidth(durationMonths) {
  return (durationMonths / monthCount) * 100;
}

function monthFromClientX(clientX) {
  const rect = el.timelineGrid.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
  const ratio = rect.width > 0 ? x / rect.width : 0;
  return Math.min(monthCount, Math.max(1, Math.floor(ratio * monthCount) + 1));
}

function saveBoardDebounced() {
  if (!state.viewedUser || !state.board || state.currentUser !== state.viewedUser) return;
  setSaveStatus("Saving…", "saving");
  clearTimeout(saveBoardDebounced.timer);
  saveBoardDebounced.timer = setTimeout(async () => {
    try {
      await api(`/api/board/${encodeURIComponent(state.viewedUser)}/timeline`, {
        method: "PUT",
        body: JSON.stringify({ timeline: state.board.timeline })
      });
      setSaveStatus("Saved", "saved");
    } catch (_error) {
      setSaveStatus("Save failed", "error");
    }
  }, 250);
}

function updateTimelineItem(itemId, patch) {
  const idx = state.board.timeline.findIndex((it) => it.id === itemId);
  if (idx === -1) return;

  const original = state.board.timeline[idx];
  const merged = { ...original, ...patch };
  const safeStart = Math.min(monthCount, Math.max(1, Math.round(merged.startMonth)));
  const maxDuration = monthCount + 1 - safeStart;
  const safeDuration = Math.min(maxDuration, Math.max(1, Math.round(merged.durationMonths)));
  state.board.timeline[idx] = {
    ...merged,
    startMonth: safeStart,
    durationMonths: safeDuration
  };

  renderTimeline();
  if (state.currentUser === state.viewedUser) {
    saveBoardDebounced();
  }
}

function removeTimelineItem(itemId) {
  state.board.timeline = state.board.timeline.filter((it) => it.id !== itemId);
  renderTimeline();
  if (state.currentUser === state.viewedUser) {
    saveBoardDebounced();
  }
}

function renderTimeline() {
  el.timelineGrid.innerHTML = "";

  const editable = state.currentUser && state.currentUser === state.viewedUser;
  const canDrop = editable;
  if (canDrop) {
    el.timelineGrid.addEventListener("dragover", onDragOver);
    el.timelineGrid.addEventListener("drop", onDropTask);
  } else {
    el.timelineGrid.removeEventListener("dragover", onDragOver);
    el.timelineGrid.removeEventListener("drop", onDropTask);
  }

  (state.board?.timeline || []).forEach((item, idx) => {
    const block = document.createElement("div");
    block.className = "timeline-item";
    block.style.background = item.color;
    block.style.left = `${computeLeft(item.startMonth)}%`;
    block.style.width = `${computeWidth(item.durationMonths)}%`;
    block.style.top = `${18 + idx * 52}px`;

    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = `${item.title} (${item.durationMonths}m)`;
    block.appendChild(title);

    if (editable) {
      const resizeHandle = document.createElement("span");
      resizeHandle.className = "resize-handle";
      resizeHandle.title = "Drag to resize";
      block.appendChild(resizeHandle);

      block.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if (event.target === resizeHandle) return;
        event.preventDefault();
        const pointerId = event.pointerId;
        const startItem = state.board.timeline.find((it) => it.id === item.id);
        if (!startItem) return;

        const anchorOffset = monthFromClientX(event.clientX) - startItem.startMonth;
        const onMove = (moveEvent) => {
          const pointerMonth = monthFromClientX(moveEvent.clientX);
          const nextStart = pointerMonth - anchorOffset;
          updateTimelineItem(item.id, { startMonth: nextStart });
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          block.releasePointerCapture(pointerId);
        };

        block.setPointerCapture(pointerId);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });

      resizeHandle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const pointerId = event.pointerId;
        const startItem = state.board.timeline.find((it) => it.id === item.id);
        if (!startItem) return;
        const fixedStart = startItem.startMonth;

        const onMove = (moveEvent) => {
          const pointerMonth = monthFromClientX(moveEvent.clientX);
          const nextDuration = pointerMonth - fixedStart + 1;
          updateTimelineItem(item.id, { durationMonths: nextDuration });
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          resizeHandle.releasePointerCapture(pointerId);
        };

        resizeHandle.setPointerCapture(pointerId);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });

      block.addEventListener("dblclick", () => {
        removeTimelineItem(item.id);
      });
    }

    el.timelineGrid.appendChild(block);
  });
}

function onDragOver(event) {
  event.preventDefault();
}

function onDropTask(event) {
  event.preventDefault();
  if (state.currentUser !== state.viewedUser) return;
  const payload = event.dataTransfer.getData("application/json");
  if (!payload) return;

  const task = JSON.parse(payload);
  const startMonth = monthFromClientX(event.clientX);

  state.board.timeline.push({
    id: uid("item"),
    taskId: task.id,
    title: task.name,
    color: task.color,
    startMonth,
    durationMonths: 1
  });

  renderTimeline();
  saveBoardDebounced();
}

function renderUsers() {
  el.usersList.innerHTML = "";
  const sortedUsers = [...state.users].sort((a, b) => {
    if (state.currentUser && a.username === state.currentUser) return -1;
    if (state.currentUser && b.username === state.currentUser) return 1;
    return a.username.localeCompare(b.username);
  });

  sortedUsers.forEach((user) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    const isCurrentUser = state.currentUser === user.username;
    btn.textContent = isCurrentUser ? `${user.username} (You)` : user.username;
    if (isCurrentUser) {
      btn.classList.add("user-self");
    }
    btn.addEventListener("click", () => loadBoard(user.username));
    li.appendChild(btn);
    el.usersList.appendChild(li);
  });
}

async function loadUsers() {
  state.users = await api("/api/users");
  renderUsers();
}

async function loadBoard(username) {
  state.viewedUser = username;
  state.board = await api(`/api/board/${encodeURIComponent(username)}`);
  el.boardTitle.textContent = `Timeline Board: ${username}`;

  const editable = state.currentUser === state.viewedUser;
  setSaveStatus(editable ? "Autosave ready" : "Read-only view", editable ? "normal" : "readonly");

  renderTimeline();
}

async function join(username) {
  const existingToken = localStorage.getItem(`workshop_token_${username}`) || "";
  const data = await api("/api/join", {
    method: "POST",
    body: JSON.stringify({ username, token: existingToken })
  });
  state.currentUser = data.username;
  state.currentToken = data.token;
  localStorage.setItem(`workshop_token_${state.currentUser}`, state.currentToken);
  el.sessionInfo.textContent = `You are joined as: ${state.currentUser}`;
  setJoinSectionVisibility(false);
  await loadUsers();
  await loadBoard(state.currentUser);
}

el.joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = el.usernameInput.value.trim();
  if (!username) return;
  try {
    await join(username);
    el.usernameInput.value = "";
  } catch (error) {
    alert(error.message);
  }
});

async function init() {
  setJoinSectionVisibility(true);
  renderTimelineHeader();
  state.taskLibrary = await api("/api/task-library");
  renderTaskBank();
  await loadUsers();

  if (state.users.length > 0) {
    const remembered = state.users.find((u) => localStorage.getItem(`workshop_token_${u.username}`));
    if (remembered) {
      await join(remembered.username);
    }
  }
}

init().catch((error) => {
  alert(error.message);
});
