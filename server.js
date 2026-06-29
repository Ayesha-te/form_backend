import "dotenv/config";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { MongoClient } from "mongodb";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const PORT = Number.parseInt(process.env.PORT ?? "4000", 10);
const MAX_FILE_SIZE = 1024 * 1024;
const MAX_REQUEST_SIZE = MAX_FILE_SIZE + 256 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const DEFAULT_ALLOWED_ORIGINS = [
  "https://form-builder-love.vercel.app",
  "https://reg-form-three-eta.vercel.app",
  "https://reg-form-1.vercel.app",
  "https://reg-form.vercel.app",
];

const GENDER_OPTIONS = new Set(["Male", "Female", "Other"]);
const INTEREST_OPTIONS = new Set([
  "Sports",
  "Music",
  "Travel",
  "Reading",
  "Gaming",
  "Cooking",
  "Movies",
  "Technology",
]);
const COUNTRY_CITY_MAP = {
  UAE: ["Dubai", "Sharjah", "Abu Dhabi", "Ajman", "Ras Al Khaimah"],
  India: ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai", "Kolkata"],
  USA: ["New York", "Los Angeles", "Chicago", "Houston", "San Francisco"],
  UK: ["London", "Manchester", "Birmingham", "Liverpool", "Edinburgh"],
  Canada: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa"],
  Australia: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide"],
};
const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeStorageRoot = process.env.VERCEL
  ? (process.env.TMPDIR ?? process.env.TEMP ?? "/tmp")
  : __dirname;
const dataDir = join(runtimeStorageRoot, "data");
const uploadDir = join(runtimeStorageRoot, "uploads");

// MongoDB configuration — set MONGODB_URI and MONGODB_DB in environment
const MONGODB_URI =
  process.env.MONGODB_URI ??
  (process.env.NODE_ENV === "production" ? null : "mongodb://localhost:27017");
const MONGODB_DB = process.env.MONGODB_DB ?? "registrations_db";

let mongoClient;
let registrationsCollection;
let initialized = false;
let initializationError = null;

async function ensureInitialized() {
  if (initialized) return;
  if (initializationError) throw initializationError;

  try {
    await mkdir(dataDir, { recursive: true });
    await mkdir(uploadDir, { recursive: true });

    if (!MONGODB_URI) {
      throw new Error(
        "Missing MONGODB_URI in production. Set the MongoDB connection string in environment variables.",
      );
    }

    mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await mongoClient.connect();
    const db = mongoClient.db(MONGODB_DB);
    registrationsCollection = db.collection("registrations");

    initialized = true;
  } catch (error) {
    initializationError = error;
    throw error;
  }
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (!isAllowedOrigin(request.headers.origin)) {
      return sendJson(request, response, 403, {
        ok: false,
        message: "This origin is not allowed by the local API.",
      });
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders(request));
      return response.end();
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(request, response, 200, {
        ok: true,
        service: "registration-api",
        storage: "mongodb",
      });
    }

    await ensureInitialized();

    if (request.method === "GET" && url.pathname === "/api/registrations") {
      const docs = await registrationsCollection.find().sort({ _id: -1 }).limit(50).toArray();
      const registrations = docs.map(formatRegistration);
      return sendJson(request, response, 200, { ok: true, registrations });
    }

    if (request.method === "POST" && url.pathname === "/api/registrations") {
      return handleRegistration(request, response);
    }

    if (request.method === "GET" && url.pathname.startsWith("/uploads/")) {
      return serveUploadedFile(request, response, url.pathname);
    }

    return sendJson(request, response, 404, {
      ok: false,
      message: "Route not found.",
    });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    const message =
      error instanceof Error && status < 500
        ? error.message
        : "The API could not process that request.";

    if (status >= 500) {
      console.error(error);
    }

    return sendJson(request, response, status, {
      ok: false,
      message,
    });
  }
}

const server = createServer(handleRequest);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`Registration API running at http://localhost:${PORT}`);
  });
}

export default handleRequest;

async function handleRegistration(request, response) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return sendJson(request, response, 415, {
      ok: false,
      message: "Use multipart/form-data to submit the registration.",
    });
  }

  const body = await readBody(request, MAX_REQUEST_SIZE);
  const { fields, files } = parseMultipartFormData(contentType, body);
  const photo = files.photo;
  const registration = normalizeRegistration(fields);
  const errors = validateRegistration(registration, photo);

  if (Object.keys(errors).length > 0) {
    return sendJson(request, response, 400, {
      ok: false,
      message: "Please fix the highlighted fields.",
      errors,
    });
  }

  const imageExtension = detectImageExtension(photo.buffer);
  const storedFileName = `${randomUUID()}${imageExtension}`;
  const photoPath = `/uploads/${storedFileName}`;
  await writeFile(join(uploadDir, storedFileName), photo.buffer, { flag: "wx" });

  const insertDoc = {
    full_name: registration.fullName,
    email: registration.email,
    mobile: registration.mobile,
    date_of_birth: registration.dateOfBirth,
    gender: registration.gender,
    interests: registration.interests,
    country: registration.country,
    city: registration.city,
    photo_path: photoPath,
    original_photo_name: photo.filename,
    created_at: new Date().toISOString(),
  };

  const result = await registrationsCollection.insertOne(insertDoc);
  const saved = await registrationsCollection.findOne({ _id: result.insertedId });
  const registrationRecord = saved ?? { ...insertDoc, _id: result.insertedId };

  return sendJson(request, response, 201, {
    ok: true,
    message: "Registration submitted successfully.",
    registration: formatRegistration(registrationRecord),
  });
}

async function serveUploadedFile(request, response, pathname) {
  const fileName = decodeURIComponent(pathname.replace(/^\/uploads\//, ""));
  const filePath = resolve(uploadDir, fileName);
  const safeRelativePath = relative(uploadDir, filePath);

  if (!fileName || safeRelativePath.startsWith("..") || isAbsolute(safeRelativePath)) {
    return sendJson(request, response, 400, {
      ok: false,
      message: "Invalid upload path.",
    });
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return sendJson(request, response, 404, {
      ok: false,
      message: "Uploaded file not found.",
    });
  }

  const headers = {
    ...corsHeaders(request),
    "content-length": String(fileStat.size),
    "content-type": imageContentType(extname(fileName)),
    "cache-control": "public, max-age=31536000, immutable",
  };

  response.writeHead(200, headers);
  createReadStream(filePath).pipe(response);
}

function normalizeRegistration(fields) {
  return {
    fullName: getString(fields.fullName).replace(/\s+/g, " ").trim(),
    email: getString(fields.email).trim().toLowerCase(),
    mobile: getString(fields.mobile).trim(),
    dateOfBirth: getString(fields.dateOfBirth).trim(),
    gender: getString(fields.gender).trim(),
    interests: [
      ...new Set(
        getArray(fields.interests)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ],
    country: getString(fields.country).trim(),
    city: getString(fields.city).trim(),
  };
}

function validateRegistration(registration, photo) {
  const errors = {};
  const phoneRegex = /^\+?[0-9\s-]{7,15}$/;

  if (registration.fullName.length < 2 || registration.fullName.length > 100) {
    errors.fullName = "Full name must be between 2 and 100 characters.";
  }

  if (!phoneRegex.test(registration.mobile)) {
    errors.mobile = "Enter a valid mobile number (7-15 digits).";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registration.email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!isValidPastDate(registration.dateOfBirth)) {
    errors.dateOfBirth = "Select a valid date of birth.";
  }

  if (!GENDER_OPTIONS.has(registration.gender)) {
    errors.gender = "Select a gender.";
  }

  if (registration.interests.length === 0) {
    errors.interests = "Pick at least one interest.";
  } else if (registration.interests.some((interest) => !INTEREST_OPTIONS.has(interest))) {
    errors.interests = "Pick valid interests.";
  }

  if (!registration.country) {
    errors.country = "Select a country.";
  } else if (!(registration.country in COUNTRY_CITY_MAP)) {
    errors.country = "Select a valid country.";
  }

  if (!registration.city) {
    errors.city = "Select a city.";
  } else if (
    registration.country in COUNTRY_CITY_MAP &&
    !COUNTRY_CITY_MAP[registration.country].includes(registration.city)
  ) {
    errors.city = "Select a valid city.";
  }

  if (!photo || photo.buffer.length === 0) {
    errors.photo = "Upload a JPG or PNG photo under 1 MB.";
  } else {
    const extension = extname(photo.filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      errors.photo = "Only JPG, JPEG, or PNG files are allowed.";
    } else if (!ALLOWED_IMAGE_TYPES.has(photo.contentType.toLowerCase())) {
      errors.photo = "Only JPG, JPEG, or PNG files are allowed.";
    } else if (photo.buffer.length > MAX_FILE_SIZE) {
      errors.photo = "Photo must be 1 MB or smaller.";
    } else if (!detectImageExtension(photo.buffer)) {
      errors.photo = "Upload a valid JPG or PNG image.";
    }
  }

  return errors;
}

function parseMultipartFormData(contentType, body) {
  const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);
  if (!boundaryMatch) {
    throw httpError(400, "Multipart boundary is missing.");
  }

  const boundary = Buffer.from(`--${boundaryMatch[1]}`);
  const headerDivider = Buffer.from("\r\n\r\n");
  const nextBoundaryPrefix = Buffer.from(`\r\n--${boundaryMatch[1]}`);
  const fields = {};
  const files = {};
  let position = 0;

  while (position < body.length) {
    const boundaryStart = body.indexOf(boundary, position);
    if (boundaryStart === -1) break;

    let partStart = boundaryStart + boundary.length;
    if (body.slice(partStart, partStart + 2).toString() === "--") break;
    if (body.slice(partStart, partStart + 2).toString() === "\r\n") {
      partStart += 2;
    }

    const headerEnd = body.indexOf(headerDivider, partStart);
    if (headerEnd === -1) {
      throw httpError(400, "Multipart part headers are invalid.");
    }

    const headers = parsePartHeaders(body.slice(partStart, headerEnd).toString("utf8"));
    const contentStart = headerEnd + headerDivider.length;
    const contentEnd = body.indexOf(nextBoundaryPrefix, contentStart);
    if (contentEnd === -1) {
      throw httpError(400, "Multipart body is incomplete.");
    }

    const disposition = headers["content-disposition"] ?? "";
    const name = getHeaderParam(disposition, "name");
    const filename = getHeaderParam(disposition, "filename");
    const content = body.slice(contentStart, contentEnd);

    if (name) {
      if (filename != null && filename !== "") {
        files[name] = {
          filename,
          contentType: headers["content-type"] ?? "application/octet-stream",
          buffer: content,
        };
      } else if (filename == null) {
        appendField(fields, name, content.toString("utf8"));
      }
    }

    position = contentEnd + 2;
  }

  return { fields, files };
}

function parsePartHeaders(rawHeaders) {
  return rawHeaders.split("\r\n").reduce((headers, line) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) return headers;

    const name = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    headers[name] = value;
    return headers;
  }, {});
}

function getHeaderParam(headerValue, paramName) {
  const pattern = new RegExp(`${paramName}="([^"]*)"`, "i");
  return headerValue.match(pattern)?.[1];
}

function appendField(fields, name, value) {
  const fieldName = name.endsWith("[]") ? name.slice(0, -2) : name;
  const current = fields[fieldName];

  if (current == null) {
    fields[fieldName] = value;
  } else if (Array.isArray(current)) {
    current.push(value);
  } else {
    fields[fieldName] = [current, value];
  }
}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    request.on("data", (chunk) => {
      if (settled) return;

      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        settled = true;
        reject(httpError(413, "Upload payload is too large."));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });

    request.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function detectImageExtension(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return ".jpg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return ".png";
  }

  return "";
}

function imageContentType(extension) {
  if (extension.toLowerCase() === ".png") return "image/png";
  return "image/jpeg";
}

function formatRegistration(row) {
  const fullName =
    row.full_name ?? [row.first_name, row.last_name].filter(Boolean).join(" ").trim();

  return {
    id: row._id ? String(row._id) : String(row.id ?? ""),
    fullName,
    email: row.email ?? "",
    mobile: row.mobile ?? row.whatsapp_number ?? "",
    dateOfBirth: row.date_of_birth ?? "",
    gender: row.gender ?? "",
    interests: Array.isArray(row.interests) ? row.interests : [],
    country: row.country ?? "",
    city: row.city ?? "",
    photoPath: row.photo_path ?? null,
    originalPhotoName: row.original_photo_name ?? null,
    createdAt: row.created_at ?? null,
  };
}

function isValidPastDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;

  return parsed <= new Date();
}

function getString(value) {
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
}

function getArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

function sendJson(request, response, status, payload) {
  response.writeHead(status, {
    ...corsHeaders(request),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  return {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type, Accept",
    "access-control-allow-origin": origin ?? "*",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function isAllowedOrigin(origin) {
  if (!origin) return true;

  const configuredOrigins = [
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];

  if (configuredOrigins.length === 0) {
    return true;
  }

  if (configuredOrigins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    return (
      ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) ||
      parsed.hostname.endsWith(".vercel.app")
    );
  } catch {
    return false;
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
