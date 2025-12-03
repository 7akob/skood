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

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Send current state to new client
  socket.emit("sync_state", getCurrentState());

  // Chat message
socket.on("chat_message", (data) => {
  const { user, text } = data;
  const box = document.getElementById("chatBox");

  const time = new Date().toLocaleTimeString();

  const el = document.createElement("div");
  el.className = "message";

  if (user === username) {
    // YOU
    el.innerHTML = `
      <span style="color:#FFFF00;">[${time}]</span>
      <span style="color:#00FF00;"><b>You:</b></span>
      <span style="color:#FFFFFF;">${text}</span>
    `;
  } else {
    // FRIENDS
    el.innerHTML = `
      <span style="color:#FFFF00;">[${time}]</span>
      <span style="color:#00FFEA;"><b>${user}:</b></span>
      <span style="color:#FFFFFF;">${text}</span>
    `;
  }

  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
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
