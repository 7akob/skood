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

// rooms[roomId] = { state, queue }
const rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      state: { videoId: null, time: 0, isPlaying: false, lastUpdate: Date.now() },
      queue: []
    };
  }
  return rooms[roomId];
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

  socket.on("join_room", (id) => {
    if (typeof id !== "string" || !id) return;
    roomId = id.slice(0, 20);
    socket.join(roomId);
    const room = getRoom(roomId);
    socket.emit("sync_state", { ...getRoomState(room), queue: room.queue });
    console.log(`${socket.id} joined room: ${roomId}`);
  });

  socket.on("disconnect", () => {
    if (!roomId) return;
    const sockets = io.sockets.adapter.rooms.get(roomId);
    if (!sockets || sockets.size === 0) {
      delete rooms[roomId];
      console.log("Room deleted (empty):", roomId);
    }
  });

  const inRoom = () => roomId !== null;

  socket.on("request_sync", () => {
    if (!inRoom()) return;
    const room = getRoom(roomId);
    socket.emit("sync_state", { ...getRoomState(room), queue: room.queue });
  });

  socket.on("chat_message", (data) => {
    if (!inRoom()) return;
    io.to(roomId).emit("chat_message", data);
  });

  socket.on("system_message", (msg) => {
    if (!inRoom() || typeof msg !== "string") return;
    io.to(roomId).emit("system_message", msg);
  });

  socket.on("change_video", (videoId) => {
    if (!inRoom()) return;
    const room = getRoom(roomId);
    room.state.videoId = videoId;
    room.state.time = 0;
    room.state.isPlaying = false;
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
    const entry = { id: item.id, title: item.title || item.id, addedBy: item.addedBy || "?" };
    room.queue.push(entry);
    io.to(roomId).emit("queue_update", room.queue);
    io.to(roomId).emit("system_message", `${entry.addedBy} added "${entry.title}" to the queue`);
  });

  socket.on("remove_from_queue", (index) => {
    if (!inRoom()) return;
    const room = getRoom(roomId);
    if (index < 0 || index >= room.queue.length) return;
    room.queue.splice(index, 1);
    io.to(roomId).emit("queue_update", room.queue);
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
    if (endedId !== room.state.videoId || room.queue.length === 0) return;
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
