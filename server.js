const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
app.use(express.static("public"));

// Aggregate-only lobby stat: how many rooms are open right now.
// Deliberately nothing else — no names, no per-room data, no history.
app.get("/stats", (req, res) => {
  res.json({ rooms: Object.keys(rooms).length });
});

const server = http.createServer(app);
const io = new Server(server, {
  transports: ["websocket"],
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// rooms[roomId] = { state, queue }
const rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      state: { videoId: null, time: 0, isPlaying: false, lastUpdate: Date.now(), loop: false },
      queue: [],
      users: {} // socket.id -> username, for the presence list
    };
  }
  return rooms[roomId];
}

function presenceList(room) {
  return Object.values(room.users);
}

function getRoomState(room) {
  let t = room.state.time;
  if (room.state.isPlaying) {
    t += (Date.now() - room.state.lastUpdate) / 1000;
  }
  return { ...room.state, time: t };
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  let roomId = null;
  let username = null;

  socket.on("join_room", (payload) => {
    // Accept either the old bare-string shape or {roomId, username} —
    // username is needed for the presence list and join/leave messages.
    const id = typeof payload === "string" ? payload : payload && payload.roomId;
    const name = (typeof payload === "object" && payload && payload.username) || "";
    if (typeof id !== "string" || !id) return;
    roomId = id.slice(0, 20);
    username = (name || "?").toString().trim().slice(0, 20) || "?";
    socket.join(roomId);
    const room = getRoom(roomId);
    const wasAlreadyPresent = room.users[socket.id] === username;
    room.users[socket.id] = username;
    socket.emit("sync_state", { ...getRoomState(room), queue: room.queue, users: presenceList(room) });
    if (!wasAlreadyPresent) {
      socket.broadcast.to(roomId).emit("presence_update", presenceList(room));
      socket.broadcast.to(roomId).emit("system_message", `${username} joined the room`);
    }
    console.log(`${socket.id} joined room: ${roomId}`);
  });

  socket.on("update_username", (name) => {
    if (!roomId || typeof name !== "string") return;
    const room = getRoom(roomId);
    const trimmed = name.trim().slice(0, 20);
    if (!trimmed || trimmed === username) return;
    const old = username;
    username = trimmed;
    room.users[socket.id] = username;
    io.to(roomId).emit("presence_update", presenceList(room));
    io.to(roomId).emit("system_message", `${old} is now known as ${username}`);
  });

  // Shared by an explicit "leave" and a dropped connection — removes this
  // socket from the room's presence, deletes the room if that was the
  // last person, otherwise tells whoever's left.
  function leaveCurrentRoom() {
    if (!roomId) return;
    const room = rooms[roomId];
    const leftId = roomId;
    const leftName = username;
    roomId = null;
    if (!room) return;
    delete room.users[socket.id];
    socket.leave(leftId);
    const sockets = io.sockets.adapter.rooms.get(leftId);
    if (!sockets || sockets.size === 0) {
      delete rooms[leftId];
      console.log("Room deleted (empty):", leftId);
    } else {
      io.to(leftId).emit("presence_update", presenceList(room));
      io.to(leftId).emit("system_message", `${leftName || "Someone"} left the room`);
    }
  }

  socket.on("leave_room", leaveCurrentRoom);
  socket.on("disconnect", leaveCurrentRoom);

  const inRoom = () => roomId !== null;

  socket.on("request_sync", () => {
    if (!inRoom()) return;
    const room = getRoom(roomId);
    socket.emit("sync_state", { ...getRoomState(room), queue: room.queue, users: presenceList(room) });
  });

  // Relay only a validated {user, text} shape with capped lengths — the
  // client escapes on render, but the server shouldn't forward junk either.
  socket.on("chat_message", (data) => {
    if (!inRoom() || !data || typeof data.user !== "string" || typeof data.text !== "string") return;
    const user = data.user.trim().slice(0, 20);
    const text = data.text.trim().slice(0, 500);
    if (!user || !text) return;
    io.to(roomId).emit("chat_message", { user, text });
  });

  socket.on("system_message", (msg) => {
    if (!inRoom() || typeof msg !== "string" || !msg.trim()) return;
    io.to(roomId).emit("system_message", msg.slice(0, 300));
  });

  socket.on("change_video", (videoId) => {
    if (!inRoom()) return;
    const room = getRoom(roomId);
    room.state.videoId = videoId;
    room.state.time = 0;
    // loadVideoById() autoplays on every client (loader and receivers
    // alike), so the room really is playing at this point — marking it
    // paused here made anyone who joined right after a video change get
    // cued as paused while everyone already present was actually playing.
    room.state.isPlaying = true;
    room.state.lastUpdate = Date.now();
    socket.broadcast.to(roomId).emit("change_video", videoId);
  });

  socket.on("play", (time) => {
    if (!inRoom()) return;
    const room = getRoom(roomId);
    room.state.isPlaying = true;
    room.state.time = time;
    room.state.lastUpdate = Date.now();
    socket.broadcast.to(roomId).emit("play", time);
  });

  socket.on("pause", (time) => {
    if (!inRoom()) return;
    const room = getRoom(roomId);
    room.state.isPlaying = false;
    room.state.time = time;
    room.state.lastUpdate = Date.now();
    socket.broadcast.to(roomId).emit("pause", time);
  });

  socket.on("seek", (time) => {
    if (!inRoom()) return;
    const room = getRoom(roomId);
    room.state.time = time;
    room.state.lastUpdate = Date.now();
    socket.broadcast.to(roomId).emit("seek", time);
  });

  socket.on("add_to_queue", (item) => {
    if (!inRoom() || !item || !item.id) return;
    const room = getRoom(roomId);
    const entry = { qid: crypto.randomUUID(), id: item.id, title: item.title || item.id, addedBy: item.addedBy || "?" };
    room.queue.push(entry);
    io.to(roomId).emit("queue_update", room.queue);
    io.to(roomId).emit("system_message", `${entry.addedBy} added "${entry.title}" to the queue`);
  });

  // Removal is keyed by qid (not array index) so two people acting on the
  // queue at nearly the same time can't remove/play the wrong item after
  // an earlier removal has shifted everyone else's indices.
  socket.on("remove_from_queue", (qid) => {
    if (!inRoom()) return;
    const room = getRoom(roomId);
    const idx = room.queue.findIndex((q) => q.qid === qid);
    if (idx === -1) return;
    room.queue.splice(idx, 1);
    io.to(roomId).emit("queue_update", room.queue);
  });

  socket.on("toggle_loop", () => {
    if (!inRoom()) return;
    const room = getRoom(roomId);
    room.state.loop = !room.state.loop;
    io.to(roomId).emit("loop_update", room.state.loop);
  });

  socket.on("clear_queue", (user) => {
    if (!inRoom()) return;
    const room = getRoom(roomId);
    room.queue = [];
    io.to(roomId).emit("queue_update", room.queue);
    io.to(roomId).emit("system_message", `${user || "Someone"} cleared the queue`);
  });

  socket.on("video_ended", (endedId) => {
    if (!inRoom()) return;
    const room = getRoom(roomId);
    if (endedId !== room.state.videoId) return;

    if (room.state.loop) {
      // Everyone in the room independently detects ENDED and emits this,
      // so a duplicate for the same play-through arrives moments later.
      // Unlike the non-loop path, videoId doesn't change on replay, so it
      // can't be used to dedupe — guard on how recently we last restarted
      // instead (a real video can't end again within 1.5s of restarting).
      // Tracked separately from state.lastUpdate, which other actions
      // (change_video, play, pause, seek) also touch and would otherwise
      // cause an unrelated recent action to wrongly suppress a real replay.
      if (Date.now() - (room.lastLoopRestart || 0) < 1500) return;
      room.lastLoopRestart = Date.now();
      room.state.time = 0;
      room.state.isPlaying = true;
      room.state.lastUpdate = Date.now();
      io.to(roomId).emit("change_video", room.state.videoId);
      return;
    }

    if (room.queue.length === 0) return;
    const next = room.queue.shift();
    room.state.videoId = next.id;
    room.state.time = 0;
    room.state.isPlaying = true;
    room.state.lastUpdate = Date.now();
    io.to(roomId).emit("change_video", next.id);
    io.to(roomId).emit("queue_update", room.queue);
    io.to(roomId).emit("system_message", `▶ Now playing: "${next.title}"`);
  });

  socket.on("skip_video", (user) => {
    if (!inRoom()) return;
    const room = getRoom(roomId);
    if (room.queue.length === 0) return;
    const next = room.queue.shift();
    room.state.videoId = next.id;
    room.state.time = 0;
    room.state.isPlaying = true;
    room.state.lastUpdate = Date.now();
    io.to(roomId).emit("change_video", next.id);
    io.to(roomId).emit("queue_update", room.queue);
    io.to(roomId).emit("system_message", `${user || "Someone"} skipped to "${next.title}"`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port", PORT));
