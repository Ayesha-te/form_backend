import mongoose from "mongoose";

const registrationSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 255,
    },
    mobile: {
      type: String,
      required: true,
      trim: true,
    },
    dateOfBirth: {
      type: String,
      required: true,
    },
    gender: {
      type: String,
      required: true,
    },
    interests: {
      type: [String],
      required: true,
      default: [],
    },
    country: {
      type: String,
      required: true,
      trim: true,
    },
    city: {
      type: String,
      required: true,
      trim: true,
    },
    photo: {
      data: {
        type: Buffer,
        required: true,
      },
      mimeType: {
        type: String,
        required: true,
      },
      originalName: {
        type: String,
        required: true,
      },
      size: {
        type: Number,
        required: true,
      },
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

export const Registration =
  mongoose.models.Registration ?? mongoose.model("Registration", registrationSchema);
