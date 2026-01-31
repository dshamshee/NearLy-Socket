import mongoose from "mongoose";

export interface ActiveWorkers{
    workerId: string;
    socketId: string;
    createdAt: Date;
}

const ActiveWorkersSchema = new mongoose.Schema<ActiveWorkers>({
    workerId: {type: String, required: true},
    socketId: {type: String, required: true},
    createdAt: {type: Date, default: Date.now},
})

let ActiveWorkersModel: mongoose.Model<ActiveWorkers>;
if(mongoose.models.ActiveWorkers){
    ActiveWorkersModel = mongoose.models.ActiveWorkers as mongoose.Model<ActiveWorkers>;
} else {
    ActiveWorkersModel = mongoose.model<ActiveWorkers>("ActiveWorkers", ActiveWorkersSchema);
}

export default ActiveWorkersModel;