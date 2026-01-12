const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.NEARLY_CLIENT_URL } 
});

io.on("connection", (socket) => {
  // Join a unique room for each worker to keep data private
  socket.on("join-room", (workerId) => {
    socket.join(`worker-${workerId}`);
  });

  // When worker sends location, broadcast to anyone in that room (the customer)
  socket.on("update-location", ({ workerId, location }) => {
    io.to(`worker-${workerId}`).emit("location-broadcast", location);
  });

  socket.on("disconnect", () => console.log("User disconnected"));
});

httpServer.listen(4000, () => console.log("Tracking server on :4000"));