// -------------------- SERVICE WORKER --------------------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// -------------------- THEME --------------------
// The head snippet in index.html already set data-theme before first paint;
// this re-apply exists to sync the selects and the meta theme-color.
// The theme list lives in three places (THEMES, THEME_COLORS, and the head
// snippet's VALID array); change all of them together.
const THEMES = ["yt2008", "neon90s", "midnight"];
// Per-theme meta theme-color; must match each theme's --bg-page.
const THEME_COLORS = {
  yt2008: "#FFFFFF",
  neon90s: "#000080",
  midnight: "#0B1220"
};
function getTheme() {
  try {
    const t = localStorage.getItem("yt_theme");
    return THEMES.includes(t) ? t : "yt2008";
  } catch { return "yt2008"; }
}
function saveTheme(t) {
  try { localStorage.setItem("yt_theme", t); } catch {}
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[t] || THEME_COLORS.yt2008);
  document.querySelectorAll(".theme-select").forEach((s) => { s.value = t; });
}
function changeTheme(t) {
  if (!THEMES.includes(t)) return;
  saveTheme(t);
  applyTheme(t);
}
applyTheme(getTheme());

// -------------------- STATE --------------------
let player;
let suppressEvents = false;
let lastState = null;
let pendingSync = null;
let currentVideoId = null;
let currentVideoTitle = null;
let currentRoomId = null;
let loopEnabled = false;
let currentQueueLength = 0;

// -------------------- USERNAME --------------------
let username = localStorage.getItem("yt_username");
if (!username) {
  let entered = "";
  while (!entered) {
    entered = (prompt("Welcome! What's your name?") || "").trim().slice(0, 20);
  }
  username = entered;
  localStorage.setItem("yt_username", username);
}

function editUsername() {
  const newName = prompt("Enter your name:", username);
  if (newName === null) return;
  const trimmed = newName.trim().slice(0, 20);
  if (!trimmed) return;
  username = trimmed;
  localStorage.setItem("yt_username", username);
  document.getElementById("usernameDisplay").textContent = username;
  if (socket.connected && currentRoomId) socket.emit("update_username", username);
}

// -------------------- SOCKET --------------------
// Must be created before ROOM LOBBY below: the auto-join-from-URL check
// calls enterRoom(), which reads `socket`. If `socket` were declared
// after that point, joining via a shared room link (?room=CODE) would
// throw "Cannot access 'socket' before initialization" and abort the
// rest of this script, leaving the page with no connection at all.
const socket = io({ transports: ["websocket"] });

function setConnected(connected) {
  const dot = document.getElementById("connDot");
  dot.title = connected ? "Connected" : "Reconnecting...";
  dot.classList.toggle("disconnected", !connected);
}

socket.on("disconnect", () => setConnected(false));

socket.on("connect", () => {
  setConnected(true);
  // Re-join room on every connect/reconnect; server sends fresh sync_state in response
  if (currentRoomId) socket.emit("join_room", { roomId: currentRoomId, username });
});

socket.on("sync_state", (s) => {
  renderQueue(s.queue || []);
  renderPresence(s.users || []);
  loopEnabled = !!s.loop;
  updateLoopBtn();
  if (!player) {
    pendingSync = s;
  } else {
    applySync(s);
  }
});

socket.on("queue_update", (q) => renderQueue(q));
socket.on("presence_update", (users) => renderPresence(users));

socket.on("loop_update", (loop) => {
  loopEnabled = loop;
  updateLoopBtn();
});

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
  // Class toggles rather than inline display, so each theme decides how #app
  // lays out (the Classic 2008 theme makes it a grid; inline styles would win).
  document.getElementById("lobby").classList.add("hidden");
  document.getElementById("app").classList.add("active");
  const shareUrl = document.getElementById("shareUrl");
  if (shareUrl) shareUrl.value = location.origin + "?room=" + roomId;
  renderFavorites();
  if (socket.connected) {
    socket.emit("join_room", { roomId: currentRoomId, username });
  }
}

function leaveRoom() {
  if (socket.connected && currentRoomId) socket.emit("leave_room");
  history.replaceState({}, "", "/");
  currentRoomId = null;
  pendingSync = null;
  currentVideoId = null;
  currentVideoTitle = null;
  sessionPlayed.clear();
  document.getElementById("app").classList.remove("active");
  document.getElementById("lobby").classList.remove("hidden");
  document.getElementById("roomJoinInput").value = "";
  const shareUrl = document.getElementById("shareUrl");
  if (shareUrl) shareUrl.value = "";
  renderPresence([]);
  updateLobbyStats();
}

// Aggregate-only: the server reports how many rooms are open, nothing else.
// Shown in the lobby when > 0; errors leave the line empty.
async function updateLobbyStats() {
  const el = document.getElementById("lobbyStats");
  if (!el) return;
  try {
    const res = await fetch("/stats");
    if (!res.ok) return;
    const { rooms } = await res.json();
    el.textContent = rooms > 0 ? `🟢 ${rooms} ${rooms === 1 ? "room" : "rooms"} watching right now` : "";
  } catch { /* leave empty */ }
}

function renderPresence(users) {
  const el = document.getElementById("presenceList");
  if (!el) return;
  el.textContent = users && users.length ? users.join(", ") : "just you";
}

function copyRoomLink() {
  const url = location.origin + "?room=" + currentRoomId;
  navigator.clipboard.writeText(url).then(() => {
    appendSystemMessage("Link copied: " + url);
    showCopiedTip();
  }).catch(() => {
    prompt("Copy the link:", url);
  });
}

function showCopiedTip() {
  const btn = document.getElementById("copyLinkBtn");
  if (!btn) return;
  const existing = btn.querySelector(".copied-tip");
  if (existing) existing.remove();
  const tip = document.createElement("span");
  tip.className = "copied-tip";
  tip.textContent = "Copied!";
  btn.appendChild(tip);
  setTimeout(() => tip.remove(), 1400);
}

// Check URL on load, skip lobby if room param present
(function () {
  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  if (room) enterRoom(room.toUpperCase());
  else updateLobbyStats();
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
  // host's actual position. This was the "not synced on join" bug.
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

// A video that has run to the end with nothing queued behind it leaves the
// room idle, so treat that as free rather than busy. Otherwise pasting a link
// after the last video would queue it with nothing left to advance the queue.
function roomIsWatching() {
  if (!currentVideoId) return false;
  if (!player || typeof player.getPlayerState !== "function") return true;
  return player.getPlayerState() !== YT.PlayerState.ENDED;
}

// The button people reach for most should not be the destructive one. If the
// room is watching something, a pasted link joins the queue instead of
// replacing what is on screen. Interrupting is still possible, but only
// through actions that are deliberate and announced in chat: a queue item's
// play button, or Skip.
async function loadVideo() {
  const input = document.getElementById("videoInput");
  const val = input.value.trim();
  if (!val) return;
  if (roomIsWatching()) {
    await addToQueue();
    return;
  }
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

function clearQueue() {
  if (currentQueueLength > 0 && !confirm(`Clear the queue (${currentQueueLength} videos)? This can't be undone.`)) return;
  socket.emit("clear_queue", username);
}

// Loop is shared room state (like play/pause); toggling it round-trips
// through the server so everyone's button reflects the same on/off state.
function toggleLoop() { socket.emit("toggle_loop"); }

function updateLoopBtn() {
  const btn = document.getElementById("loopBtn");
  if (!btn) return;
  btn.classList.toggle("active", loopEnabled);
  btn.title = loopEnabled ? "Loop: ON" : "Loop current video";
}

function playAgain() {
  if (!currentVideoId) return;
  socket.emit("add_to_queue", { id: currentVideoId, title: currentVideoTitle || currentVideoId, addedBy: username });
}

function extractId(str) {
  const m1 = str.match(/[?&]v=([^&]+)/);
  if (m1) return m1[1];
  const m2 = str.match(/youtu\.be\/([^?&]+)/);
  if (m2) return m2[1];
  // Shorts / live / embed links don't carry a v= param. Without this,
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
// dead embed, e.g. removed/private videos or embedding disabled by the
// uploader (error codes per the IFrame API docs).
function onPlayerError(event) {
  const messages = {
    2: "Invalid video link.",
    5: "This video can't be played in this player.",
    100: "Video not found (removed or private).",
    101: "The owner doesn't allow this video to be played on other sites.",
    150: "The owner doesn't allow this video to be played on other sites."
  };
  appendSystemMessage("⚠ " + (messages[event.data] || "The video couldn't be loaded."));
}

// -------------------- NOW PLAYING + FAVORITES --------------------
async function setNowPlaying(id, { announce = false } = {}) {
  currentVideoId = id;
  currentVideoTitle = null;
  sessionPlayed.add(id);
  document.getElementById("nowTitle").textContent = "Loading...";
  updateStarBtn();
  bumpFavoritePlayCount(id);
  const title = await fetchTitle(id);
  if (currentVideoId !== id) return;
  currentVideoTitle = title;
  document.getElementById("nowTitle").textContent = title;
  updateStarBtn();
  updateMediaSession(title, id);
  if (announce) socket.emit("system_message", `${username} loaded "${title}"`);
}

function updateMediaSession(title, id) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: title,
    artist: "Skood",
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

// Everything this browser has seen play since joining, so "I'm Feeling Lucky"
// can avoid repeating a video the room already watched tonight.
const sessionPlayed = new Set();

// Picks a random favorite of yours, preferring ones the room hasn't played
// yet. Your favorites never leave the browser: only the chosen video is
// shared, exactly as if you had pressed play on it yourself. A random pick
// should never yank away what people are watching, so it queues instead
// whenever something is already loaded.
function feelingLucky() {
  const favs = getFavorites();
  if (!favs.length) {
    appendSystemMessage("Star a few videos first and this button will pick one for you.");
    return;
  }
  const unplayed = favs.filter((f) => !sessionPlayed.has(f.id));
  const pool = unplayed.length ? unplayed : favs;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (currentVideoId) {
    socket.emit("add_to_queue", { id: pick.id, title: pick.title, addedBy: username });
  } else {
    loadFavorite(pick.id);
  }
}

function getFavorites() { return JSON.parse(localStorage.getItem("yt_favorites") || "[]"); }
function saveFavorites(favs) { localStorage.setItem("yt_favorites", JSON.stringify(favs)); }

function toggleFavorite() {
  if (!currentVideoId) return;
  const favs = getFavorites();
  const idx = favs.findIndex(f => f.id === currentVideoId);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    // Seed with 1 play since you're favoriting it while it's already
    // playing; bumpFavoritePlayCount() only fires on future plays.
    favs.unshift({ id: currentVideoId, title: currentVideoTitle || currentVideoId, plays: 1 });
  }
  saveFavorites(favs);
  renderFavorites();
  updateStarBtn();
}

// Also toggles the replay button's disabled state; both need a
// currentVideoId to do anything, so they share this update point.
function updateStarBtn() {
  const hasVideo = !!currentVideoId;
  const isFav = hasVideo && getFavorites().some(f => f.id === currentVideoId);
  const starBtn = document.getElementById("starBtn");
  const replayBtn = document.getElementById("replayBtn");
  starBtn.textContent = isFav ? "★" : "☆";
  starBtn.disabled = !hasVideo;
  replayBtn.disabled = !hasVideo;
}

// Personal per-browser watch counter: bumps a favorited video's play
// count every time it becomes the now-playing video for you, regardless
// of who in the room loaded it. Non-favorites aren't tracked.
function bumpFavoritePlayCount(id) {
  const favs = getFavorites();
  const fav = favs.find(f => f.id === id);
  if (!fav) return;
  fav.plays = (fav.plays || 0) + 1;
  saveFavorites(favs);
  renderFavorites();
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
  currentQueueLength = q.length;
  const list = document.getElementById("queueList");
  if (q.length === 0) {
    list.innerHTML = '<span class="panel-empty">Queue is empty</span>';
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
    byEl.textContent = "added by " + item.addedBy;

    meta.append(titleEl, byEl);

    const btnPlay = document.createElement("button");
    btnPlay.className = "btn-small";
    btnPlay.textContent = "▶";
    btnPlay.title = "Play now";
    btnPlay.onclick = () => playFromQueue(item.qid, item.id);

    const btnRemove = document.createElement("button");
    btnRemove.className = "btn-small";
    btnRemove.textContent = "✕";
    btnRemove.title = "Remove";
    btnRemove.onclick = () => removeFromQueue(item.qid);

    div.append(thumb, meta, btnPlay, btnRemove);
    list.appendChild(div);
  });
}

function renderFavorites() {
  const favs = getFavorites();
  const list = document.getElementById("favoritesList");
  if (favs.length === 0) {
    list.innerHTML = '<span class="panel-empty">No favorites yet, star a video!</span>';
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

    const playsEl = document.createElement("span");
    playsEl.className = "item-by";
    const plays = fav.plays || 0;
    playsEl.textContent = plays === 1 ? "played once" : `played ${plays} times`;

    meta.append(titleEl, playsEl);

    const btnLoad = document.createElement("button");
    btnLoad.className = "btn-small";
    btnLoad.textContent = "▶";
    btnLoad.title = "Play now";
    btnLoad.onclick = () => loadFavorite(fav.id);

    const btnQueue = document.createElement("button");
    btnQueue.className = "btn-small";
    btnQueue.textContent = "+Queue";
    btnQueue.title = "Add to queue";
    btnQueue.onclick = () => queueFavorite(fav.id, fav.title);

    const btnRemove = document.createElement("button");
    btnRemove.className = "btn-small";
    btnRemove.textContent = "✕";
    btnRemove.title = "Remove from favorites";
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
  const self = user === username;
  el.innerHTML = `<span class="msg-time">[${time}]</span> <span class="msg-name${self ? " is-self" : ""}"><b>${self ? "You" : safeUser}:</b></span> <span class="msg-text">${safeText}</span>`;
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