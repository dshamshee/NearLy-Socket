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


// ... existing imports and setup ...

const activeWorkers = new Map(); 
const activeBookings = new Map(); 

io.on("connection", (socket) => {
  
  socket.on("register-active-worker", (workerId) => {
    socket.workerId = workerId;
    activeWorkers.set(workerId, socket.id);
    console.log("Worker registered:", workerId);
  });

  socket.on("unregister-active-worker", (workerId) => {
    if (activeWorkers.has(workerId)) {
      activeWorkers.delete(workerId);
      console.log("Worker unregistered:", workerId);
    }
  });

  // NEW: Customer sends request to ONE specific worker
  socket.on("send-booking-request", ({ bookingId, selectedWorkerId, jobDetails }) => {
    console.log("Received booking request:", { bookingId, selectedWorkerId, customerSocketId: socket.id });
    
    if (!bookingId || !selectedWorkerId || !jobDetails) {
      console.error("Invalid booking request data:", { bookingId, selectedWorkerId, jobDetails });
      socket.emit("booking-request-error", { message: "Invalid booking request data" });
      return;
    }

    activeBookings.set(bookingId, { 
        customerSocketId: socket.id, 
        workerId: selectedWorkerId,
        status: "pending" 
    });

    const targetSocketId = activeWorkers.get(selectedWorkerId);
    console.log("Active workers map:", Array.from(activeWorkers.entries()));
    console.log("Looking for worker:", selectedWorkerId);
    console.log("Target socket ID:", targetSocketId);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit("incoming-request", { bookingId, jobDetails });
      console.log("Booking request sent to worker:", targetSocketId);
    } else {
      console.warn("Worker not found in active workers:", selectedWorkerId);
      socket.emit("booking-request-error", { message: "Worker is not currently active" });
    }
  });

  socket.on("accept-booking", ({ bookingId }) => {
    const booking = activeBookings.get(bookingId);
    if (booking) {
      booking.status = "accepted";
      io.to(booking.customerSocketId).emit("booking-confirmed", { msg: "Worker accepted!" });
    }
  });

  // Triggered when worker clicks "Out for Service"
  socket.on("start-navigation", ({ bookingId }) => {
    const booking = activeBookings.get(bookingId);
    if (booking) {
      booking.status = "in-transit";
      io.to(booking.customerSocketId).emit("worker-started-navigation");
    }
  });

  socket.on("update-location", ({ workerId, location }) => {
    // Find the active booking for this worker that is 'in-transit'
    for (let [id, data] of activeBookings.entries()) {
      if (data.workerId === workerId && data.status === "in-transit") {
        io.to(data.customerSocketId).emit("location-broadcast", location);
      }
    }
  });

  socket.on("confirm-reached", ({ bookingId }) => {
    const booking = activeBookings.get(bookingId);
    if (booking) {
      io.to(booking.customerSocketId).emit("worker-arrived");
      activeBookings.delete(bookingId);
    }
  });

  socket.on("disconnect", () => {
    if (socket.workerId) {
      activeWorkers.delete(socket.workerId);
      console.log("Worker disconnected:", socket.workerId);
    }
  });
});


httpServer.listen(4000, () => console.log("Tracking server on :4000"));