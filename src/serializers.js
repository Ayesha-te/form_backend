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
  const origin = request.headers.origin;
  if (origin) return origin;

  const protocol = request.headers["x-forwarded-proto"] ?? "http";
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  return host ? `${protocol}://${host}` : "";
}
