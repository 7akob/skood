// -------------------- SERVICE WORKER --------------------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// -------------------- STATE --------------------
let player;
let suppressEvents = false;
let lastState = null;
let pendingSync = null;
let currentVideoId = null;
let currentVideoTitle = null;
let currentRoomId = null;

// -------------------- USERNAME --------------------
let username = localStorage.getItem("yt_username");
if (!username) {
  let entered = "";
  while (!entered) {
    entered = (prompt("Välkommen! Vad heter du?") || "").trim().slice(0, 20);
  }
  username = entered;
  localStorage.setItem("yt_username", username);
}

function editUsername() {
  const newName = prompt("Ange ditt namn:", username);
  if (newName === null) return;
  const trimmed = newName.trim().slice(0, 20);
  if (!trimmed) return;
  username = trimmed;
  localStorage.setItem("yt_username", username);
  document.getElementById("usernameDisplay").textContent = username;
}

// -------------------- SOCKET --------------------
// Must be created before ROOM LOBBY below: the auto-join-from-URL check
// calls enterRoom(), which reads `socket` — if `socket` were declared
// after that point, joining via a shared room link (?room=CODE) would
// throw "Cannot access 'socket' before initialization" and abort the
// rest of this script, leaving the page with no connection at all.
const socket = io({ transports: ["websocket"] });

function setConnected(connected) {
  const dot = document.getElementById("connDot");
  dot.title = connected ? "Ansluten" : "Återansluter...";
  dot.classList.toggle("disconnected", !connected);
}

socket.on("disconnect", () => setConnected(false));

socket.on("connect", () => {
  setConnected(true);
  // Re-join room on every connect/reconnect — server sends fresh sync_state in response
  if (currentRoomId) socket.emit("join_room", currentRoomId);
});

socket.on("sync_state", (s) => {
  renderQueue(s.queue || []);
  if (!player) {
    pendingSync = s;
  } else {
    applySync(s);
  }
});

socket.on("queue_update", (q) => renderQueue(q));

socket.on("change_video", (id) => {
  suppressEvents = true;
  player.loadVideoById(id);
  player.seekTo(0, true);
  resetSuppress();
  setNowPlaying(id);
});

socket.on("play", (t) => {
  suppressEvents = true;
  player.seekTo(t, true);
  player.playVideo();
  lastState = YT.PlayerState.PLAYING;
  resetSuppress();
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
});

socket.on("pause", (t) => {
  suppressEvents = true;
  player.seekTo(t, true);
  player.pauseVideo();
  lastState = YT.PlayerState.PAUSED;
  resetSuppress();
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
});

socket.on("seek", (t) => {
  suppressEvents = true;
  player.seekTo(t, true);
  resetSuppress();
});

socket.on("system_message", (msg) => appendSystemMessage(msg));
socket.on("chat_message", (data) => renderChatMessage(data));

// -------------------- ROOM LOBBY --------------------
function generateRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function createRoom() {
  enterRoom(generateRoomId());
}

function joinRoomFromInput() {
  const val = document.getElementById("roomJoinInput").value.trim().toUpperCase();
  if (!val) return;
  enterRoom(val);
}

function enterRoom(roomId) {
  currentRoomId = roomId;
  history.replaceState({}, "", "?room=" + roomId);
  document.getElementById("roomCodeDisplay").textContent = roomId;
  document.getElementById("usernameDisplay").textContent = username;
  document.getElementById("lobby").style.display = "none";
  document.getElementById("app").style.display = "block";
  renderFavorites();
  if (socket.connected) {
    socket.emit("join_room", currentRoomId);
  }
}

function leaveRoom() {
  history.replaceState({}, "", "/");
  currentRoomId = null;
  pendingSync = null;
  currentVideoId = null;
  currentVideoTitle = null;
  document.getElementById("app").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("roomJoinInput").value = "";
}

function copyRoomLink() {
  const url = location.origin + "?room=" + currentRoomId;
  navigator.clipboard.writeText(url).then(() => {
    appendSystemMessage("Länk kopierad: " + url);
  }).catch(() => {
    prompt("Kopiera länken:", url);
  });
}

// Check URL on load — skip lobby if room param present
(function () {
  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  if (room) enterRoom(room.toUpperCase());
})();

// -------------------- PAGE VISIBILITY --------------------
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && socket.connected && currentRoomId) {
    socket.emit("request_sync");
  }
});

// -------------------- YOUTUBE --------------------
function onYouTubeIframeAPIReady() {
  player = new YT.Player("player", {
    height: "100%",
    width: "100%",
    videoId: "",
    playerVars: {
      autoplay: 0,
      controls: 1,
      origin: window.location.origin,
      enablejsapi: 1,
      modestbranding: 1
    },
    events: { onStateChange, onError: onPlayerError }
  });

  if (pendingSync) {
    applySync(pendingSync);
    pendingSync = null;
  }
}

function applySync(s) {
  if (!player || !s.videoId) return;
  suppressEvents = true;
  // Pass the start time directly into load/cueVideoById instead of calling
  // seekTo() right after loadVideoById(). seekTo() issued immediately after
  // loadVideoById() races the player's async video load and is frequently
  // dropped, silently landing a joining viewer at 0:00 instead of the
  // host's actual position — this was the "not synced on join" bug.
  if (s.isPlaying) {
    player.loadVideoById(s.videoId, s.time);
    lastState = YT.PlayerState.PLAYING;
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  } else {
    // cueVideoById loads+seeks without autoplaying, avoiding a play/pause
    // flash for viewers who should stay paused.
    player.cueVideoById(s.videoId, s.time);
    lastState = YT.PlayerState.PAUSED;
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  }
  resetSuppress();
  setNowPlaying(s.videoId);
}

function loadVideo() {
  const input = document.getElementById("videoInput");
  const val = input.value.trim();
  if (!val) return;
  const id = extractId(val);
  socket.emit("change_video", id);
  suppressEvents = true;
  player.loadVideoById(id);
  player.seekTo(0);
  lastState = null;
  resetSuppress();
  input.value = "";
  setNowPlaying(id, { announce: true });
}

async function addToQueue() {
  const input = document.getElementById("videoInput");
  const val = input.value.trim();
  if (!val) return;
  const id = extractId(val);
  const title = await fetchTitle(id);
  socket.emit("add_to_queue", { id, title, addedBy: username });
  input.value = "";
}

function removeFromQueue(qid) { socket.emit("remove_from_queue", qid); }

function playFromQueue(qid, id) {
  socket.emit("remove_from_queue", qid);
  socket.emit("change_video", id);
  suppressEvents = true;
  player.loadVideoById(id);
  player.seekTo(0);
  lastState = null;
  resetSuppress();
  setNowPlaying(id, { announce: true });
}

function skipVideo() { socket.emit("skip_video", username); }
function clearQueue() { socket.emit("clear_queue", username); }

function extractId(str) {
  const m1 = str.match(/[?&]v=([^&]+)/);
  if (m1) return m1[1];
  const m2 = str.match(/youtu\.be\/([^?&]+)/);
  if (m2) return m2[1];
  // Shorts / live / embed links don't carry a v= param — without this,
  // the whole URL was passed to loadVideoById() as an "ID", which
  // YouTube's player rejects with its own generic error screen.
  const m3 = str.match(/\/(?:shorts|live|embed)\/([^?&]+)/);
  if (m3) return m3[1];
  return str;
}

function onStateChange(event) {
  if (suppressEvents) return;
  const s = event.data;

  if (s === YT.PlayerState.ENDED) {
    socket.emit("video_ended", currentVideoId);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
    return;
  }

  if (s !== YT.PlayerState.PLAYING && s !== YT.PlayerState.PAUSED) return;
  if (s === lastState) return;
  lastState = s;

  const t = player.getCurrentTime();
  if (s === YT.PlayerState.PLAYING) {
    socket.emit("play", t);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  }
  if (s === YT.PlayerState.PAUSED) {
    socket.emit("pause", t);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  }
}

function resetSuppress() { setTimeout(() => suppressEvents = false, 300); }

// Surfaces YouTube's player errors in chat instead of leaving a silent
// dead embed — e.g. removed/private videos or embedding disabled by the
// uploader (error codes per the IFrame API docs).
function onPlayerError(event) {
  const messages = {
    2: "Ogiltig video-länk.",
    5: "Videon kan inte spelas upp i den här spelaren.",
    100: "Videon hittades inte (borttagen eller privat).",
    101: "Ägaren tillåter inte att videon spelas på andra sidor.",
    150: "Ägaren tillåter inte att videon spelas på andra sidor."
  };
  appendSystemMessage("⚠ " + (messages[event.data] || "Videon kunde inte laddas."));
}

// -------------------- NOW PLAYING + FAVORITES --------------------
async function setNowPlaying(id, { announce = false } = {}) {
  currentVideoId = id;
  currentVideoTitle = null;
  document.getElementById("nowTitle").textContent = "Laddar...";
  updateStarBtn();
  const title = await fetchTitle(id);
  if (currentVideoId !== id) return;
  currentVideoTitle = title;
  document.getElementById("nowTitle").textContent = title;
  updateStarBtn();
  updateMediaSession(title, id);
  if (announce) socket.emit("system_message", `${username} laddade "${title}"`);
}

function updateMediaSession(title, id) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: title,
    artist: "Skåda på tv",
    artwork: [{ src: `https://img.youtube.com/vi/${id}/hqdefault.jpg`, sizes: "480x360", type: "image/jpeg" }]
  });
  navigator.mediaSession.setActionHandler("play", () => {
    const t = player.getCurrentTime();
    player.playVideo();
    socket.emit("play", t);
  });
  navigator.mediaSession.setActionHandler("pause", () => {
    const t = player.getCurrentTime();
    player.pauseVideo();
    socket.emit("pause", t);
  });
  navigator.mediaSession.setActionHandler("nexttrack", () => skipVideo());
  navigator.mediaSession.setActionHandler("previoustrack", () => {
    suppressEvents = true;
    player.seekTo(0, true);
    socket.emit("seek", 0);
    resetSuppress();
  });
}

async function fetchTitle(id) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
    if (!res.ok) return id;
    const data = await res.json();
    return data.title || id;
  } catch { return id; }
}

function getFavorites() { return JSON.parse(localStorage.getItem("yt_favorites") || "[]"); }
function saveFavorites(favs) { localStorage.setItem("yt_favorites", JSON.stringify(favs)); }

function toggleFavorite() {
  if (!currentVideoId) return;
  const favs = getFavorites();
  const idx = favs.findIndex(f => f.id === currentVideoId);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.unshift({ id: currentVideoId, title: currentVideoTitle || currentVideoId });
  saveFavorites(favs);
  renderFavorites();
  updateStarBtn();
}

function updateStarBtn() {
  const isFav = currentVideoId && getFavorites().some(f => f.id === currentVideoId);
  document.getElementById("starBtn").textContent = isFav ? "★" : "☆";
}

function removeFavorite(index) {
  const favs = getFavorites();
  favs.splice(index, 1);
  saveFavorites(favs);
  renderFavorites();
  updateStarBtn();
}

function loadFavorite(id) {
  socket.emit("change_video", id);
  suppressEvents = true;
  player.loadVideoById(id);
  player.seekTo(0);
  lastState = null;
  resetSuppress();
  setNowPlaying(id, { announce: true });
}

function queueFavorite(id, title) {
  socket.emit("add_to_queue", { id, title, addedBy: username });
}

function renderQueue(q) {
  const list = document.getElementById("queueList");
  if (q.length === 0) {
    list.innerHTML = '<span class="panel-empty">Kön är tom</span>';
    return;
  }
  list.innerHTML = "";
  q.forEach((item) => {
    const div = document.createElement("div");
    div.className = "queue-item";

    const thumb = document.createElement("img");
    thumb.src = `https://img.youtube.com/vi/${item.id}/default.jpg`;
    thumb.alt = "";

    const meta = document.createElement("div");
    meta.className = "item-meta";

    const titleEl = document.createElement("span");
    titleEl.className = "item-title";
    titleEl.textContent = item.title;
    titleEl.title = item.title;

    const byEl = document.createElement("span");
    byEl.className = "item-by";
    byEl.textContent = "tillagd av " + item.addedBy;

    meta.append(titleEl, byEl);

    const btnPlay = document.createElement("button");
    btnPlay.className = "btn-small";
    btnPlay.textContent = "▶";
    btnPlay.title = "Spela nu";
    btnPlay.onclick = () => playFromQueue(item.qid, item.id);

    const btnRemove = document.createElement("button");
    btnRemove.className = "btn-small";
    btnRemove.textContent = "✕";
    btnRemove.title = "Ta bort";
    btnRemove.onclick = () => removeFromQueue(item.qid);

    div.append(thumb, meta, btnPlay, btnRemove);
    list.appendChild(div);
  });
}

function renderFavorites() {
  const favs = getFavorites();
  const list = document.getElementById("favoritesList");
  if (favs.length === 0) {
    list.innerHTML = '<span class="panel-empty">Inga favoriter än — stjärnmärk en video!</span>';
    return;
  }
  list.innerHTML = "";
  favs.forEach((fav, i) => {
    const div = document.createElement("div");
    div.className = "fav-item";

    const thumb = document.createElement("img");
    thumb.src = `https://img.youtube.com/vi/${fav.id}/default.jpg`;
    thumb.alt = "";

    const meta = document.createElement("div");
    meta.className = "item-meta";

    const titleEl = document.createElement("span");
    titleEl.className = "item-title";
    titleEl.textContent = fav.title;
    titleEl.title = fav.title;

    meta.append(titleEl);

    const btnLoad = document.createElement("button");
    btnLoad.className = "btn-small";
    btnLoad.textContent = "▶";
    btnLoad.title = "Spela nu";
    btnLoad.onclick = () => loadFavorite(fav.id);

    const btnQueue = document.createElement("button");
    btnQueue.className = "btn-small";
    btnQueue.textContent = "+Kö";
    btnQueue.title = "Lägg till i kö";
    btnQueue.onclick = () => queueFavorite(fav.id, fav.title);

    const btnRemove = document.createElement("button");
    btnRemove.className = "btn-small";
    btnRemove.textContent = "✕";
    btnRemove.title = "Ta bort från favoriter";
    btnRemove.onclick = () => removeFavorite(i);

    div.append(thumb, meta, btnLoad, btnQueue, btnRemove);
    list.appendChild(div);
  });
}

// -------------------- CHAT --------------------
function sendMessage() {
  const input = document.getElementById("chatInput");
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit("chat_message", { user: username, text: msg });
  input.value = "";
}

function renderChatMessage(data) {
  const { user, text } = data;
  const box = document.getElementById("chatBox");
  const time = new Date().toLocaleTimeString();
  const el = document.createElement("div");
  el.className = "message";
  const safeText = escHtml(text);
  const safeUser = escHtml(user);
  if (user === username) {
    el.innerHTML = `<span style="color:#FFFF00;">[${time}]</span> <span style="color:#00FF00;"><b>Du:</b></span> <span style="color:#FFFFFF;">${safeText}</span>`;
  } else {
    el.innerHTML = `<span style="color:#FFFF00;">[${time}]</span> <span style="color:#00FFEA;"><b>${safeUser}:</b></span> <span style="color:#FFFFFF;">${safeText}</span>`;
  }
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function appendSystemMessage(msg) {
  const box = document.getElementById("chatBox");
  const el = document.createElement("div");
  el.className = "sys-message";
  el.textContent = "⚡ " + msg;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}