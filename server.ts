import dbConnect from "./config/dbConnection";
import ActiveBookingsModel from "./model/activeBookings";
import ActiveWorkersModel from "./model/activeWorkers";

const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();


// const checkDBConnection = async ()=>{
//   try {
//     await dbConnect();
//     console.log("DB Connected Successfully");
//     return true;
//   } catch (error: unknown) {
//     console.log(error instanceof Error ? error.message : "Internal Server Error on checkDBConnection");
//     return false;
//   } finally {
//     console.log("DB Connection Checked");
//   }
// }

// checkDBConnection();


const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.NEARLY_CLIENT_URL } 
});


// ... existing imports and setup ...

// const activeWorkers = new Map(); 
// const activeBookings = new Map(); 

io.on("connection", (socket) => {
  
  socket.on("register-active-worker", async (workerId) => {
try {
      await dbConnect();
      socket.workerId = workerId;
      await ActiveWorkersModel.create({
        workerId: workerId,
        socketId: socket.id,
      })
      console.log("Worker registered:", workerId);
} catch (error: unknown) {
  console.log(error instanceof Error ? error.message : "Internal Server Error on register-active-worker");
  socket.emit("register-active-worker-error", { message: "Internal Server Error on register-active-worker" });
}
  });

  socket.on("unregister-active-worker", async (workerId) => {
try {
      await dbConnect();
      await ActiveWorkersModel.deleteOne({workerId: workerId});
      console.log("Worker unregistered:", workerId);
} catch (error: unknown) {
  console.log(error instanceof Error ? error.message : "Internal Server Error on unregister-active-worker");
  socket.emit("unregister-active-worker-error", { message: "Internal Server Error on unregister-active-worker" });
}
  });

  // NEW: Customer sends request to ONE specific worker
  socket.on("send-booking-request", async ({ bookingId, selectedWorkerId, jobDetails }) => {
    try {
      await dbConnect();
      console.log("Received booking request:", { bookingId, selectedWorkerId, customerSocketId: socket.id });
      
      if (!bookingId || !selectedWorkerId || !jobDetails) {
        console.error("Invalid booking request data:", { bookingId, selectedWorkerId, jobDetails });
        socket.emit("booking-request-error", { message: "Invalid booking request data" });
        return;
      }
  
      await ActiveBookingsModel.create({ 
        bookingId: bookingId,
          customerSocketId: socket.id, 
          workerId: selectedWorkerId,
          status: "pending" 
      });
  
      const targetSocketId = await ActiveWorkersModel.findOne({workerId: selectedWorkerId});
      if (targetSocketId) {
        io.to(targetSocketId.socketId).emit("incoming-request", { bookingId, jobDetails });
        console.log("Booking request sent to worker:", targetSocketId.socketId);
      } else {
        console.warn("Worker not found in active workers:", selectedWorkerId);
        socket.emit("booking-request-error", { message: "Worker is not currently active" });
      }
    } catch (error: unknown) {
      console.log(error instanceof Error ? error.message : "Internal Server Error on send-booking-request");
      socket.emit("booking-request-error", { message: "Internal Server Error on send-booking-request" });
    }
  });

  socket.on("accept-booking", async ({ bookingId }) => {
   try {
     await dbConnect();
     const booking = await ActiveBookingsModel.findOneAndUpdate({bookingId: bookingId}, {status: "accepted"});
     if (booking) {
       booking.status = "accepted";
       io.to(booking.customerSocketId).emit("booking-confirmed", { msg: "Worker accepted!" });
       console.log("Booking accepted:", bookingId);
     } else {
       console.warn("Booking not found:", bookingId);
       socket.emit("booking-request-error", { message: "Booking not found" });
     }
   } catch (error: unknown) {
    console.log(error instanceof Error ? error.message : "Internal Server Error on accept-booking");
    socket.emit("booking-request-error", { message: "Internal Server Error on accept-booking" });
   }
  });

  // Triggered when worker clicks "Out for Service"
  socket.on("start-navigation", async ({ bookingId }) => {
   try {
     await dbConnect();
     const booking = await ActiveBookingsModel.findOneAndUpdate({bookingId: bookingId}, {status: "in-transit"});
     if (booking) {
       io.to(booking.customerSocketId).emit("worker-started-navigation");
       console.log("Worker started navigation:", bookingId);
     } else {
       console.warn("Booking not found:", bookingId);
       socket.emit("booking-request-error", { message: "Booking not found" });
     }
   } catch (error: unknown) {
    console.log(error instanceof Error ? error.message : "Internal Server Error on start-navigation");
    socket.emit("booking-request-error", { message: "Internal Server Error on start-navigation" });
   }
  });

  socket.on("update-location", async ({ workerId, location }) => {
   try {
     await dbConnect();
     // Find the active booking for this worker that is 'in-transit'
     const booking = await ActiveBookingsModel.findOne({workerId: workerId, status: "in-transit"});
     if (booking) {
       io.to(booking.customerSocketId).emit("location-broadcast", location);
       console.log("Location broadcasted to customer:", booking.customerSocketId);
     } else {
       console.warn("Worker not found:", workerId);
       socket.emit("booking-request-error", { message: "Booking not found" });
     }
   } catch (error: unknown) {
    console.log(error instanceof Error ? error.message : "Internal Server Error on update-location");
    socket.emit("booking-request-error", { message: "Internal Server Error on update-location" });
   }
  });

  socket.on("confirm-reached", async ({ bookingId }) => {
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOneAndUpdate({bookingId: bookingId}, {status: "completed"});
      if (booking) {
        io.to(booking.customerSocketId).emit("worker-arrived");
        console.log("Worker arrived:", bookingId);
      } else {
        console.warn("Booking not found:", bookingId);
        socket.emit("booking-request-error", { message: "Booking not found" });
      }
    } catch (error: unknown) {
    console.log(error instanceof Error ? error.message : "Internal Server Error on confirm-reached");
    socket.emit("booking-request-error", { message: "Internal Server Error on confirm-reached" });
    }
  });

  socket.on("disconnect", async () => {
  try {
      await dbConnect();
      if (socket.workerId) {
        await ActiveWorkersModel.deleteOne({workerId: socket.workerId});
        console.log("Worker disconnected:", socket.workerId);
      } else {
        console.warn("Worker not found:", socket.workerId);
        socket.emit("booking-request-error", { message: "Worker not found" });
      }
  } catch (error: unknown) {
    console.log(error instanceof Error ? error.message : "Internal Server Error on disconnect");
    socket.emit("booking-request-error", { message: "Internal Server Error on disconnect" });
  }
  });


});


httpServer.listen(4000, () => console.log("Tracking server on :4000"));