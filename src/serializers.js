export function serializeRegistration(registration, request) {
  const baseUrl = getBaseUrl(request);
  const photoPath = `/api/registrations/${registration._id}/photo`;

  return {
    id: String(registration._id),
    fullName: registration.fullName,
    email: registration.email,
    mobile: registration.mobile,
    dateOfBirth: registration.dateOfBirth,
    gender: registration.gender,
    interests: registration.interests,
    country: registration.country,
    city: registration.city,
    photoPath,
    originalPhotoName: registration.photo.originalName,
    createdAt: registration.createdAt?.toISOString?.() ?? null,
    photoUrl: baseUrl ? `${baseUrl}${photoPath}` : null,
  };
}

function getBaseUrl(request) {
  const origin = getHeader(request.headers, "origin");
  if (origin) return origin;

  const protocol = getHeader(request.headers, "x-forwarded-proto") ?? "http";
  const host = getHeader(request.headers, "x-forwarded-host") ?? getHeader(request.headers, "host");
  return host ? `${protocol}://${host}` : "";
}

function getHeader(headers, name) {
  if (!headers) return "";

  if (typeof headers.get === "function") {
    return headers.get(name) ?? "";
  }

  return headers[name] ?? headers[name.toLowerCase()] ?? "";
}
