const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(express.static("public")); // serve frontend folder

const server = http.createServer(app);
const io = new Server(server);

let state = {
  videoId: null,
  time: 0,
  isPlaying: false,
};

io.on("connection", (socket) => {
  console.log("A user connected");

  socket.emit("sync_state", state);

  socket.on("change_video", (videoId) => {
    state.videoId = videoId;
    io.emit("change_video", videoId);
  });

  socket.on("play", (time) => {
    state.isPlaying = true;
    state.time = time;
    io.emit("play", time);
  });

  socket.on("pause", (time) => {
    state.isPlaying = false;
    state.time = time;
    io.emit("pause", time);
  });

  socket.on("seek", (time) => {
    state.time = time;
    io.emit("seek", time);
  });
});

server.listen(3000, () =>
  console.log("Server running at http://localhost:3000")
);
