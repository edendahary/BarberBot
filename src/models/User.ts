import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  password: string;
  role: "user" | "barber";
  name: string;
  email: string;
  telegramId?: number;
}

const UserSchema = new Schema<IUser>({
  password: { type: String, required: true },
  role: { type: String, enum: ["user", "barber"], required: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  telegramId: { type: Number, unique: true, sparse: true },
});

export default mongoose.model<IUser>("User", UserSchema);
