import mongoose, { Document, Schema } from "mongoose";

export interface IAppointment extends Document {
  user: mongoose.Types.ObjectId;
  barber: string;
  time: Date;
  status: "pending" | "approved" | "rejected";
}

const AppointmentSchema = new Schema<IAppointment>({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  barber: { type: String, required: true },
  time: { type: Date, required: true },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
});

export default mongoose.model<IAppointment>("Appointment", AppointmentSchema);
