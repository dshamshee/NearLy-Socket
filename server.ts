import dbConnect from "./config/dbConnection";
import ActiveBookingsModel from "./model/activeBookings";
import ActiveWorkersModel from "./model/activeWorkers";
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
dotenv.config();



const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.NEARLY_CLIENT_URL } 
});


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
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOneAndUpdate({bookingId: bookingId}, {status: "rejected"});
      if (booking?.customerSocketId) {
        io.to(booking.customerSocketId).emit("booking-rejected", { msg: "Booking rejected by worker" });
        console.log("Booking rejected:", bookingId);
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
     if (booking?.customerSocketId) {
       io.to(booking.customerSocketId).emit("worker-started-navigation");
       console.log("Worker started navigation:", bookingId);
     } else {
       console.warn("Booking not found or missing customerSocketId:", bookingId);
       socket.emit("start-navigation-error", { message: "Booking not found" });
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
     const booking = await ActiveBookingsModel.findOne({workerId: String(workerId).trim(), status: "in-transit"});
     if (booking?.customerSocketId) {
       io.to(booking.customerSocketId).emit("location-broadcast", location);
       console.log("Location broadcasted to customer:", booking.customerSocketId);
     } else {
       console.warn("Booking not found for worker:", workerId);
       socket.emit("update-location-error", { message: "Booking not found" });
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
      if (booking?.customerSocketId) {
        io.to(booking.customerSocketId).emit("worker-arrived");
        console.log("Worker arrived:", bookingId);
      } else {
        console.warn("Booking not found or missing customerSocketId:", bookingId);
        socket.emit("confirm-reached-error", { message: "Booking not found" });
      }
    } catch (error: unknown) {
    console.log(error instanceof Error ? error.message : "Internal Server Error on confirm-reached");
    socket.emit("confirm-reached-error", { message: "Internal Server Error on confirm-reached" });
    }
  });


  // Triggered when worker request for the payment
  socket.on('request-payment', async ({bookingId, amount}) => {
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOneAndUpdate(
        { bookingId: bookingId },
        { requestedPaymentAmount: amount },
        { new: true }
      );
      if (booking?.customerSocketId) {
        io.to(booking.customerSocketId).emit("payment-requested", { amount });
        console.log("Payment requested for booking:", bookingId);
      } else {
        console.warn("Booking not found or missing customerSocketId:", bookingId);
        socket.emit("payment-request-error", { message: "Booking not found" });
      }
    } catch (error: unknown) {
      console.log(error instanceof Error ? error.message : "Internal Server Error on request-payment");
      socket.emit("payment-request-error", { message: "Internal Server Error on request-payment" });
    }
  })

  // Triggered when customer completes Razorpay payment (from payment tab)
  socket.on('customer-razorpay-payment-result', async ({ bookingId, success }) => {
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOne({ bookingId });
      console.log("socket is run when details saved")
      console.log(booking)
      if (booking?.customerSocketId) {
        io.to(booking.customerSocketId).emit('customer-payment-result', { bookingId, success });
        console.log('Customer payment result forwarded:', bookingId, success);
      }
    } catch (error: unknown) {
      console.log(error instanceof Error ? error.message : 'Internal Server Error on customer-razorpay-payment-result');
    }
  });

  // Triggered when customer confirms the payment
  socket.on('confirm-payment', async ({bookingId}) => {
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOne({bookingId: bookingId});
      if (booking) {
        const activeWorkerSocketId = await ActiveWorkersModel.findOne({workerId: booking.workerId});
        if (activeWorkerSocketId) {
          io.to(activeWorkerSocketId.socketId).emit("payment-received");
          console.log("Payment received:");
        }
      } else {
        console.warn("Booking not found:", bookingId);
        socket.emit("payment-error", { message: "Booking not found" });
      }
    } catch (error: unknown) {
      console.log(error instanceof Error ? error.message : "Internal Server Error on confirm-payment");
      socket.emit("payment-error", { message: "Internal Server Error on confirm-payment" });
      console.log("Payment error:", error);
    }
  });

  // Triggered when worker verifies payment OTP - notify customer to reset dashboard
  socket.on('confirm-payment-otp', async ({ bookingId }) => {
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOne({ bookingId });
      if (booking?.customerSocketId) {
        io.to(booking.customerSocketId).emit('payment-otp-confirmed', { success: true });
        console.log('Payment OTP confirmed, customer notified:', bookingId);
      } else {
        console.warn('Booking not found or missing customerSocketId for confirm-payment-otp:', bookingId);
      }
    } catch (error: unknown) {
      console.log(error instanceof Error ? error.message : 'Internal Server Error on confirm-payment-otp');
    }
  });

  // Triggered when worker ends the service - notify customer to reset dashboard
  socket.on('service-ended', async ({ bookingId }) => {
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOne({ bookingId });
      if (booking?.customerSocketId) {
        io.to(booking.customerSocketId).emit('service-ended', { success: true });
        console.log('Service ended, customer notified:', bookingId);
      } else {
        console.warn('Booking not found or missing customerSocketId for service-ended:', bookingId);
      }
    } catch (error: unknown) {
      console.log(error instanceof Error ? error.message : 'Internal Server Error on service-ended');
    }
  });


  // Triggered when worker confirms the OTP verification success
  socket.on("confirm-payment-otp", async ({bookingId}) => {
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOne({bookingId: bookingId});
      if (booking) {
        io.to(booking.customerSocketId).emit("payment-otp-confirmed", {success: true});
        // console.log("Payment OTP confirmed:", bookingId);
      } else {
        // console.warn("Booking not found:", bookingId);
        socket.emit("payment-otp-error", { success: false });
      }
    } catch (error: unknown) {
      console.log(error instanceof Error ? error.message : "Internal Server Error on confirm-payment-otp");
      socket.emit("payment-otp-error", { success: false });
      // console.log("Payment OTP error:", error);
    }
  })

  // Triggered when worker clicks "End Service" - notify customer to reset their state
  socket.on("service-ended", async ({ bookingId }) => {
    try {
      await dbConnect();
      const booking = await ActiveBookingsModel.findOne({ bookingId });
      if (booking?.customerSocketId) {
        io.to(booking.customerSocketId).emit("service-ended", { success: true });
      }
    } catch (error: unknown) {
      console.log(error instanceof Error ? error.message : "Internal Server Error on service-ended");
    }
  });

  socket.on("disconnect", async () => {
  try {
      await dbConnect();
      if ((socket as any).workerId) {
        await ActiveWorkersModel.deleteOne({workerId: (socket as any).workerId});
        await axios.get(`${process.env.NEARLY_CLIENT_URL}/api/worker/togglestatus/${(socket as any).workerId}`);
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

// HTTP endpoint for payment API to notify dashboard (more reliable than payment tab socket)
app.post("/notify-payment-result", async (req, res) => {
  try {
    const { bookingId, success } = req.body as { bookingId?: string; success?: boolean };
    if (!bookingId || typeof success !== "boolean") {
      res.status(400).json({ error: "bookingId and success required" });
      return;
    }
    await dbConnect();
    const booking = await ActiveBookingsModel.findOne({ bookingId });
    if (booking?.customerSocketId) {
      io.to(booking.customerSocketId).emit("customer-payment-result", { bookingId, success });
      console.log("Payment result notified via HTTP:", bookingId, success);
      res.json({ ok: true });
    } else {
      console.warn("Booking not found for payment notify:", bookingId);
      res.status(404).json({ error: "Booking not found" });
    }
  } catch (error) {
    console.error("notify-payment-result error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


app.get("/check-server", (req, res)=>{
  res.send("I am Updated Now");
})

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || "0.0.0.0";

httpServer.listen(PORT, HOST, () => console.log(`Tracking server on ${HOST}:${PORT}`));