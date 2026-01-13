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


// State management
const activeWorkers = new Map(); // workerId -> socketId
const activeBookings = new Map(); // bookingId -> { customerSocketId, workerId, status }

io.on("connection", (socket) => {
  // 1. Worker joins and registers their ID
  socket.on("register-active-worker", (workerId) => {
    socket.workerId = workerId;
    activeWorkers.set(workerId, socket.id);
    console.log(`Worker ${workerId} is active`);
  });

  // 2. Customer broadcasts to specific nearby workers
  socket.on("notify-nearby-workers", ({ bookingId, workerIds, jobDetails }) => {
    activeBookings.set(bookingId, { customerSocketId: socket.id, status: "pending" });
    
    workerIds.forEach(id => {
      const socketId = activeWorkers.get(id);
      if (socketId) {
        io.to(socketId).emit("new-job-request", { bookingId, ...jobDetails });
      }
    });
  });

  // 3. Worker Accepts: Logic to disable for others
  socket.on("accept-booking", ({ bookingId, workerId }) => {
    const booking = activeBookings.get(bookingId);
    if (booking && booking.status === "pending") {
      booking.status = "accepted";
      booking.workerId = workerId;

      // Notify the specific customer
      io.to(booking.customerSocketId).emit("booking-accepted", { workerId });
      // Notify ALL other workers to hide the request
      socket.broadcast.emit("booking-filled", { bookingId });
    }
  });

  // 4. Live Tracking: Targeted only to the assigned customer
  socket.on("update-location", ({ workerId, location }) => {
    for (let [id, data] of activeBookings.entries()) {
      if (data.workerId === workerId && data.status === "accepted") {
        io.to(data.customerSocketId).emit("location-broadcast", location);
      }
    }
  });

  // 5. Completion: Stop tracking
  socket.on("confirm-reached", ({ bookingId }) => {
    const booking = activeBookings.get(bookingId);
    if (booking) {
      booking.status = "reached";
      io.to(booking.customerSocketId).emit("worker-arrived");
      activeBookings.delete(bookingId);
    }
  });

  socket.on("disconnect", () => activeWorkers.delete(socket.workerId));
});



httpServer.listen(4000, () => console.log("Tracking server on :4000"));