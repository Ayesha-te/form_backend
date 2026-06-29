import "dotenv/config";

import cors from "cors";
import express from "express";
import multer from "multer";

import { getAllowedOrigins, MAX_FILE_SIZE } from "./config.js";
import { connectToDatabase } from "./db.js";
import { Registration } from "./models/Registration.js";
import { serializeRegistration } from "./serializers.js";
import { normalizeRegistrationInput, validateRegistration } from "./validators.js";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const allowedOrigins = getAllowedOrigins();
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("This origin is not allowed by the API."));
    },
  }),
);

app.use(async (request, response, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", (_request, response) => {
  response.status(200).json({
    ok: true,
    service: "form-love-build-backend",
    database: "mongodb",
  });
});

app.get("/api/registrations", async (request, response, next) => {
  try {
    const registrations = await Registration.find({}, { "photo.data": 0 })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    response.status(200).json({
      ok: true,
      registrations: registrations.map((registration) =>
        serializeRegistration(registration, request),
      ),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/registrations/:id/photo", async (request, response, next) => {
  try {
    const registration = await Registration.findById(request.params.id).select("photo");

    if (!registration) {
      response.status(404).json({
        ok: false,
        message: "Registration photo not found.",
      });
      return;
    }

    response.setHeader("Content-Type", registration.photo.mimeType);
    response.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(registration.photo.originalName)}"`,
    );
    response.status(200).send(registration.photo.data);
  } catch (error) {
    next(error);
  }
});

app.post("/api/registrations", upload.single("photo"), async (request, response, next) => {
  try {
    const input = normalizeRegistrationInput(request.body);
    const errors = validateRegistration(input, request.file);

    if (Object.keys(errors).length > 0) {
      response.status(400).json({
        ok: false,
        message: "Please fix the highlighted fields.",
        errors,
      });
      return;
    }

    const registration = await Registration.create({
      ...input,
      photo: {
        data: request.file.buffer,
        mimeType: request.file.mimetype,
        originalName: request.file.originalname,
        size: request.file.size,
      },
    });

    response.status(201).json({
      ok: true,
      message: "Registration submitted successfully.",
      registration: serializeRegistration(registration, request),
    });
  } catch (error) {
    next(error);
  }
});

app.use((request, response) => {
  response.status(404).json({
    ok: false,
    message: `Route not found: ${request.method} ${request.originalUrl}`,
  });
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(400).json({
      ok: false,
      message: "Please fix the highlighted fields.",
      errors: {
        photo: "Photo must be 1 MB or smaller.",
      },
    });
    return;
  }

  if (error?.message === "This origin is not allowed by the API.") {
    response.status(403).json({
      ok: false,
      message: error.message,
    });
    return;
  }

  console.error(error);
  response.status(500).json({
    ok: false,
    message: "The backend could not process that request.",
  });
});

export default app;
