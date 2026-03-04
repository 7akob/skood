const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const io = new Server(server, {
  transports: ["websocket"],
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Shared sync state
let state = {
  videoId: null,
  time: 0,
  isPlaying: false,
  lastUpdate: Date.now()
};

let queue = []; // Array of { id, title, addedBy }

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Send current state + queue to new client
  socket.emit("sync_state", { ...getCurrentState(), queue });

  // Chat message
  socket.on("chat_message", (data) => {
    io.emit("chat_message", data);
  });

  // System/activity message (client-initiated, e.g. "User loaded a video")
  socket.on("system_message", (msg) => {
    if (typeof msg !== "string") return;
    io.emit("system_message", msg);
  });

  // Change video
  socket.on("change_video", (videoId) => {
    state.videoId = videoId;
    state.time = 0;
    state.isPlaying = false;
    state.lastUpdate = Date.now();
    socket.broadcast.emit("change_video", videoId);
  });

  // Play
  socket.on("play", (time) => {
    state.isPlaying = true;
    state.time = time;
    state.lastUpdate = Date.now();
    socket.broadcast.emit("play", time);
  });

  // Pause
  socket.on("pause", (time) => {
    state.isPlaying = false;
    state.time = time;
    state.lastUpdate = Date.now();
    socket.broadcast.emit("pause", time);
  });

  // Seek
  socket.on("seek", (time) => {
    state.time = time;
    state.lastUpdate = Date.now();
    socket.broadcast.emit("seek", time);
  });

  // Queue: add item
  socket.on("add_to_queue", (item) => {
    if (!item || !item.id) return;
    const entry = {
      id: item.id,
      title: item.title || item.id,
      addedBy: item.addedBy || "?"
    };
    queue.push(entry);
    io.emit("queue_update", queue);
    io.emit("system_message", `${entry.addedBy} added "${entry.title}" to the queue`);
  });

  // Queue: remove item by index
  socket.on("remove_from_queue", (index) => {
    if (index < 0 || index >= queue.length) return;
    queue.splice(index, 1);
    io.emit("queue_update", queue);
  });

  // Queue: clear all
  socket.on("clear_queue", (user) => {
    queue = [];
    io.emit("queue_update", queue);
    io.emit("system_message", `${user || "Someone"} cleared the queue`);
  });

  // Queue: advance when video ends — deduped by checking endedId matches current
  socket.on("video_ended", (endedId) => {
    if (endedId !== state.videoId || queue.length === 0) return;
    const next = queue.shift();
    state.videoId = next.id;
    state.time = 0;
    state.isPlaying = true;
    state.lastUpdate = Date.now();
    io.emit("change_video", next.id);
    io.emit("queue_update", queue);
    io.emit("system_message", `▶ Now playing: "${next.title}"`);
  });

  // Queue: manual skip to next
  socket.on("skip_video", (user) => {
    if (queue.length === 0) return;
    const next = queue.shift();
    state.videoId = next.id;
    state.time = 0;
    state.isPlaying = true;
    state.lastUpdate = Date.now();
    io.emit("change_video", next.id);
    io.emit("queue_update", queue);
    io.emit("system_message", `${user || "Someone"} skipped to "${next.title}"`);
  });
});

function getCurrentState() {
  let t = state.time;
  if (state.isPlaying) {
    const delta = (Date.now() - state.lastUpdate) / 1000;
    t += delta;
  }
  return { ...state, time: t };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port", PORT));
