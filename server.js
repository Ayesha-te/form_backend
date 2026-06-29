import "dotenv/config";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_REQUEST_SIZE,
  corsHeaders,
  createRegistrationFromFields,
  getHealthPayload,
  getUploadedFileData,
  isAllowedOrigin,
  listRegistrations,
  toErrorResponse,
} from "../server/registration-core.js";

const PORT = Number.parseInt(process.env.PORT ?? "4000", 10);

async function handleRequest(request, response) {
  const origin = request.headers.origin;

  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (!isAllowedOrigin(origin)) {
      return sendJson(request, response, 403, {
        ok: false,
        message: "This origin is not allowed by the API.",
      });
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders(origin));
      return response.end();
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(request, response, 200, getHealthPayload());
    }

    if (request.method === "GET" && url.pathname === "/api/registrations") {
      return sendJson(request, response, 200, await listRegistrations());
    }

    if (request.method === "POST" && url.pathname === "/api/registrations") {
      return await handleRegistration(request, response);
    }

    if (request.method === "GET" && url.pathname.startsWith("/uploads/")) {
      const uploadedFile = await getUploadedFileData(url.pathname.replace(/^\/uploads\//, ""));
      response.writeHead(200, {
        ...corsHeaders(origin),
        ...uploadedFile.headers,
      });
      return response.end(uploadedFile.buffer);
    }

    return sendJson(request, response, 404, {
      ok: false,
      message: "Route not found.",
    });
  } catch (error) {
    const { status, payload } = toErrorResponse(error);

    if (status >= 500) {
      console.error(error);
    }

    return sendJson(request, response, status, payload);
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
  const payload = await createRegistrationFromFields(fields, files.photo ?? null);
  return sendJson(request, response, 201, payload);
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

function sendJson(request, response, status, payload) {
  response.writeHead(status, {
    ...corsHeaders(request.headers.origin),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
