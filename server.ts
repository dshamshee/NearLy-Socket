import dbConnect from "./config/dbConnection";
import ActiveBookingsModel from "./model/activeBookings";
import ActiveWorkersModel from "./model/activeWorkers";
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();



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
      const normalizedId = String(workerId ?? "").trim();
      if (!normalizedId) {
        console.warn("register-active-worker: empty workerId");
        return;
      }
      const existingWorker = await ActiveWorkersModel.findOne({workerId: normalizedId});
      if (existingWorker) {
        // Worker exists but might have reconnected with a new socketId - update it
        existingWorker.socketId = socket.id;
        await existingWorker.save();
        (socket as any).workerId = normalizedId;
        console.log("Worker re-registered with new socket:", normalizedId, socket.id);
        return;
      }


      (socket as any).workerId = normalizedId;
      const newWorker = await ActiveWorkersModel.create({
        workerId: normalizedId,
        socketId: socket.id,
      });
      await newWorker.save();
      console.log("Worker registered:", workerId, socket.id);
} catch (error: unknown) {
  console.log(error instanceof Error ? error.message : "Internal Server Error on register-active-worker");
  socket.emit("register-active-worker-error", { message: "Internal Server Error on register-active-worker" });
}
  });

  socket.on("unregister-active-worker", async (workerId) => {
try {
      await dbConnect();

      const existingWorker = await ActiveWorkersModel.findOne({workerId: workerId});

      if(!existingWorker){
        console.warn("Active Worker not found:", workerId);
        socket.emit("unregister-active-worker-error", { message: "Worker not registered" });
        return; // Do not proceed if worker is not found
      }


      await ActiveWorkersModel.deleteOne({workerId: workerId});
      console.log("Worker unregistered:", workerId);
} catch (error: unknown) {
  console.log(error instanceof Error ? error.message : "Internal Server Error on unregister-active-worker");
  socket.emit("unregister-active-worker-error", { message: "Internal Server Error on unregister-active-worker" });
}
  });

  // Update customer socket ID for a specific booking (useful when customer reconnects)
  socket.on("update-customer-socket", async ({ bookingId }) => {
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOneAndUpdate(
        { bookingId: bookingId },
        { customerSocketId: socket.id },
        { new: true }
      );
      
      if (booking) {
        console.log("Updated customer socket for booking:", bookingId, "New socket:", socket.id);
        socket.emit("customer-socket-updated", { success: true });
      } else {
        console.warn("Booking not found for socket update:", bookingId);
        socket.emit("customer-socket-update-error", { message: "Booking not found" });
      }
    } catch (error: unknown) {
      console.log(error instanceof Error ? error.message : "Internal Server Error on update-customer-socket");
      socket.emit("customer-socket-update-error", { message: "Internal Server Error on update-customer-socket" });
    }
  });

  // NEW: Customer sends request to ONE specific worker
  socket.on("send-booking-request", async ({ bookingId, selectedWorkerId, jobDetails }, ack) => {
    const sendError = (message: string) => {
      if (typeof ack === "function") {
        ack({ error: message });
      } else {
        socket.emit("booking-request-error", { message });
      }
    };

    try {
      await dbConnect();
      console.log("Received booking request:", { bookingId, selectedWorkerId, customerSocketId: socket.id });
      
      if (!bookingId || !selectedWorkerId || !jobDetails) {
        console.error("Invalid booking request data:", { bookingId, selectedWorkerId, jobDetails });
        sendError("Invalid booking request data");
        return;
      }
  
      // Check if booking already exists (customer might have reconnected)
      const existingBooking = await ActiveBookingsModel.findOne({ bookingId: bookingId });
      
      if (existingBooking) {
        // Update customerSocketId in case customer reconnected with new socket
        // Reset status to "pending" if booking was previously rejected (customer retrying)
        existingBooking.customerSocketId = socket.id;
        if (existingBooking.status === "rejected") {
          existingBooking.status = "pending";
        }
        await existingBooking.save();
        console.log("Updated existing booking with new customer socket:", bookingId, socket.id);
      } else {
        // Create new booking
        await ActiveBookingsModel.create({ 
          bookingId: bookingId,
          customerSocketId: socket.id, 
          workerId: selectedWorkerId,
          status: "pending" 
        });
        console.log("Created new booking:", bookingId);
      }
  
      // Normalize workerId to string for comparison (handles ObjectId serialization differences)
      const normalizedWorkerId = String(selectedWorkerId).trim();
      const targetSocketId = await ActiveWorkersModel.findOne({ workerId: normalizedWorkerId });
      if (targetSocketId) {
        io.to(targetSocketId.socketId).emit("incoming-request", { bookingId, jobDetails });
        console.log("Booking request sent to worker:", targetSocketId.socketId);
        if (typeof ack === "function") {
          ack({ success: true });
        }
      } else {
        console.warn("Worker not found in active workers:", selectedWorkerId);
        sendError("Worker is not currently active");
      }
    } catch (error: unknown) {
      console.error("send-booking-request error:", error);
      sendError("Internal Server Error on send-booking-request");
    }
  });

  socket.on("accept-booking", async ({ bookingId }) => {
   try {
     await dbConnect();
     // Update booking status and get the updated document
     const booking = await ActiveBookingsModel.findOneAndUpdate(
       {bookingId: bookingId}, 
       {status: "accepted"},
       {new: true} // Return the updated document
     );
     
     if (booking && booking.customerSocketId) {
       // Emit confirmation to customer
       io.to(booking.customerSocketId).emit("booking-confirmed", { msg: "Worker accepted!" });
       console.log("Booking accepted:", bookingId, "Customer socket:", booking.customerSocketId);
     } else {
       console.warn("Booking not found or missing customerSocketId:", bookingId);
       socket.emit("booking-request-error", { message: "Booking not found" });
     }
   } catch (error: unknown) {
    console.log(error instanceof Error ? error.message : "Internal Server Error on accept-booking");
    socket.emit("booking-request-error", { message: "Internal Server Error on accept-booking" });
   }
  });


  // Triggered when worker rejects the booking
  socket.on('reject-booking', async({bookingId}) => {
    console.log('console 1')
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOneAndUpdate({bookingId: bookingId}, {status: "rejected"});
      if (booking) {
        console.log('console 2')
        io.to(booking.customerSocketId).emit("booking-rejected", { msg: "Booking rejected by worker" });
        // console.log("Booking rejected:", bookingId, "Customer socket:", booking.customerSocketId);
      } else {
        console.warn("Booking not found or missing customerSocketId:", bookingId);
        socket.emit("booking-rejected-error", { message: "Booking not found" });
      }
    } catch (error: unknown) {
      console.log(error instanceof Error ? error.message : "Internal Server Error on reject-booking");
      socket.emit("booking-rejected-error", { message: "Internal Server Error on reject-booking" });
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
       console.warn("something went wrong on start-navigation");
       socket.emit("start-navigation-error", { message: "something went wrong on start-navigation" });
     }
   } catch (error: unknown) {
    console.log(error instanceof Error ? error.message : "Internal Server Error on start-navigation");
    socket.emit("start-navigation-error", { message: "Internal Server Error on start-navigation" });
   }
  });

  // Triggered when worker updates their location
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
       socket.emit("update-location-error", { message: "Worker not found" });
     }
   } catch (error: unknown) {
    console.log(error instanceof Error ? error.message : "Internal Server Error on update-location");
    socket.emit("update-location-error", { message: "Internal Server Error on update-location" });
   }
  });

  // Triggered when worker confirms they have reached the destination
  socket.on("confirm-reached", async ({ bookingId }) => {
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOneAndUpdate({bookingId: bookingId}, {status: "completed"});
      if (booking) {
        io.to(booking.customerSocketId).emit("worker-arrived");
        console.log("Worker arrived:", bookingId);
      } else {
        console.warn("Booking not found:", bookingId);
        socket.emit("confirm-reached-error", { message: "Booking not found" });
      }
    } catch (error: unknown) {
    console.log(error instanceof Error ? error.message : "Internal Server Error on confirm-reached");
    socket.emit("confirm-reached-error", { message: "Internal Server Error on confirm-reached" });
    }
  });


  // Triggered when worker request for the payment
  socket.on('request-payment', async ({bookingId, amount}, ack) => {
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOne({bookingId: bookingId});
      if (booking) {
        io.to(booking.customerSocketId).emit("payment-requested", { amount });
      }
    } catch (error: unknown) {
      console.log(error instanceof Error ? error.message : "Internal Server Error on request-payment");
      socket.emit("payment-request-error", { message: "Internal Server Error on request-payment" });
    }
  })

  // Triggered when customer confirms the payment
  socket.on('confirm-payment', async ({bookingId, paymentId, orderId, amount}, ack) => {
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOne({bookingId: bookingId});
      if (booking) {
        const activeWorkerSocketId = await ActiveWorkersModel.findOne({workerId: booking.workerId});
        if (activeWorkerSocketId) {
          io.to(activeWorkerSocketId.socketId).emit("payment-confirmed", { paymentId, orderId, amount });
          console.log("Payment confirmed:", paymentId, orderId, amount);
        }
      } else {
        console.warn("Booking not found:", bookingId);
        socket.emit("payment-confirm-error", { message: "Booking not found" });
      }
    } catch (error: unknown) {
      console.log(error instanceof Error ? error.message : "Internal Server Error on confirm-payment");
      socket.emit("payment-confirm-error", { message: "Internal Server Error on confirm-payment" });
    }
  })

  socket.on("disconnect", async () => {
  try {
      await dbConnect();
      if ((socket as any).workerId) {
        await ActiveWorkersModel.deleteOne({workerId: (socket as any).workerId});
        console.log("Worker disconnected:", (socket as any).workerId);
      } else {
        console.warn("Worker not found:", (socket as any).workerId);
        socket.emit("booking-request-error", { message: "Worker not found" });
      }
  } catch (error: unknown) {
    console.log(error instanceof Error ? error.message : "Internal Server Error on disconnect");
    socket.emit("booking-request-error", { message: "Internal Server Error on disconnect" });
  }
  });


});

app.get("/", (req, res) => {
  res.send("Tracking server is running");
});

httpServer.listen(4000, () => console.log("Tracking server on :4000"));