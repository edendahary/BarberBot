import mongoose from "mongoose";

const dayOffSchema = new mongoose.Schema({
  date: {
    type: String, // Format: YYYY-MM-DD
    required: true,
    unique: true,
  },
  reason: {
    type: String,
    default: "יום חופש",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("DayOff", dayOffSchema);
