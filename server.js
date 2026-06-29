import 'dotenv/config';
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { MongoClient, ObjectId } from "mongodb";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const PORT = Number.parseInt(process.env.PORT ?? "4000", 10);
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_REQUEST_SIZE = MAX_FILE_SIZE + 512 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const DEFAULT_ALLOWED_ORIGINS = [
  "https://form-builder-love.vercel.app",
  "https://reg-form-three-eta.vercel.app",
  "https://reg-form-1.vercel.app",
  "https://reg-form.vercel.app",
];

const JERSEY_SIZES = new Set(["Small", "Medium", "Large", "XL", "XXL", "3XL", "4XL"]);
const PREFERRED_SLEEVES = new Set(["Full Sleeves", "Half Sleeves"]);
const AVAILABILITY_OPTIONS = new Set(["Available all matches", "Missing few matches"]);
const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeStorageRoot = process.env.VERCEL
  ? process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"
  : __dirname;
const dataDir = join(runtimeStorageRoot, "data");
const uploadDir = join(runtimeStorageRoot, "uploads");

// MongoDB configuration — set MONGODB_URI and MONGODB_DB in environment
const MONGODB_URI = process.env.MONGODB_URI ?? (process.env.NODE_ENV === "production" ? null : "mongodb://localhost:27017");
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
    first_name: registration.firstName,
    last_name: registration.lastName,
    full_name: `${registration.firstName} ${registration.lastName}`.trim(),
    email: registration.email,
    mobile: registration.mobile,
    whatsapp_number: registration.whatsappNumber,
    jersey_name: registration.jerseyName,
    jersey_number: registration.jerseyNumber,
    jersey_size: registration.jerseySize,
    preferred_sleeves: registration.preferredSleeves,
    current_club: registration.currentClub,
    availability: registration.availability,
    not_available_on: registration.notAvailableOn,
    fee_agreement: registration.feeAgreement,
    photo_path: photoPath,
    original_photo_name: photo.filename,
    created_at: new Date().toISOString(),
  };

  const result = await registrationsCollection.insertOne(insertDoc);
  const saved = await registrationsCollection.findOne({ _id: result.insertedId });

  return sendJson(request, response, 201, {
    ok: true,
    message: "Registration submitted successfully.",
    registration: formatRegistration(saved),
  });
}

async function serveUploadedFile(request, response, pathname) {
  const fileName = decodeURIComponent(pathname.replace(/^\/uploads\//, ""));
  const filePath = resolve(uploadDir, fileName);
  const safeRelativePath = relative(uploadDir, filePath);

  if (
    !fileName ||
    safeRelativePath.startsWith("..") ||
    isAbsolute(safeRelativePath)
  ) {
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
    firstName: getString(fields.firstName).trim(),
    lastName: getString(fields.lastName).trim(),
    email: getString(fields.email).trim().toLowerCase(),
    mobile: getString(fields.mobile).trim(),
    whatsappNumber: getString(fields.whatsappNumber).trim(),
    jerseyName: getString(fields.jerseyName).trim(),
    jerseyNumber: getString(fields.jerseyNumber).trim(),
    jerseySize: getString(fields.jerseySize).trim(),
    preferredSleeves: getString(fields.preferredSleeves).trim(),
    currentClub: getString(fields.currentClub).trim(),
    availability: getString(fields.availability).trim(),
    notAvailableOn: getArray(fields.notAvailableOn)
      .map((value) => value.trim())
      .filter(Boolean),
    feeAgreement: getString(fields.feeAgreement).trim() === "true",
  };
}

function validateRegistration(registration, photo) {
  const errors = {};
  const phoneRegex = /^(\+9715\d{8}|\d{10})$/;

  if (!registration.firstName) errors.firstName = "First name is required.";
  if (!registration.lastName) errors.lastName = "Last name is required.";

  if (!phoneRegex.test(registration.mobile)) {
    errors.mobile = "Use 10 digits or UAE format +9715XXXXXXXX.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registration.email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!phoneRegex.test(registration.whatsappNumber)) {
    errors.whatsappNumber = "Use 10 digits or UAE format +9715XXXXXXXX.";
  }

  if (!registration.jerseyName) errors.jerseyName = "Name of jersey is required.";

  if (!/^\d{1,3}$/.test(registration.jerseyNumber)) {
    errors.jerseyNumber = "Jersey number must be whole numbers only.";
  }

  if (!JERSEY_SIZES.has(registration.jerseySize)) {
    errors.jerseySize = "Select a jersey size.";
  }

  if (!PREFERRED_SLEEVES.has(registration.preferredSleeves)) {
    errors.preferredSleeves = "Select preferred sleeves.";
  }

  if (!registration.currentClub) errors.currentClub = "Current club/team is required.";

  if (!AVAILABILITY_OPTIONS.has(registration.availability)) {
    errors.availability = "Select availability.";
  }

  if (registration.availability === "Missing few matches" && registration.notAvailableOn.length === 0) {
    errors.notAvailableOn = "Select at least one match.";
  }

  if (!registration.feeAgreement) {
    errors.feeAgreement = "You must agree to the registration and match fees.";
  }

  if (!photo || photo.buffer.length === 0) {
    errors.photo = "Upload a JPG or PNG photo under 2 MB.";
  } else {
    const extension = extname(photo.filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      errors.photo = "Only JPG, JPEG, or PNG files are allowed.";
    } else if (!ALLOWED_IMAGE_TYPES.has(photo.contentType.toLowerCase())) {
      errors.photo = "Only JPG, JPEG, or PNG files are allowed.";
    } else if (photo.buffer.length > MAX_FILE_SIZE) {
      errors.photo = "Photo must be 2 MB or smaller.";
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
  return {
    id: row._id ? String(row._id) : Number(row.id),
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name,
    email: row.email,
    mobile: row.mobile,
    whatsappNumber: row.whatsapp_number,
    jerseyName: row.jersey_name,
    jerseyNumber: row.jersey_number,
    jerseySize: row.jersey_size,
    preferredSleeves: row.preferred_sleeves,
    currentClub: row.current_club,
    availability: row.availability,
    notAvailableOn: Array.isArray(row.not_available_on) ? row.not_available_on : [],
    feeAgreement: Boolean(row.fee_agreement),
    photoPath: row.photo_path,
    originalPhotoName: row.original_photo_name,
    createdAt: row.created_at,
  };
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
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) || parsed.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
