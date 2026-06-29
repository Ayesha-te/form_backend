export const MAX_FILE_SIZE = 1024 * 1024;
export const ALLOWED_FILE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);
export const GENDER_OPTIONS = new Set(["Male", "Female", "Other"]);
export const INTEREST_OPTIONS = new Set([
  "Sports",
  "Music",
  "Travel",
  "Reading",
  "Gaming",
  "Cooking",
  "Movies",
  "Technology",
]);

export const COUNTRY_CITY_MAP = {
  UAE: ["Dubai", "Sharjah", "Abu Dhabi", "Ajman", "Ras Al Khaimah"],
  India: ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai", "Kolkata"],
  USA: ["New York", "Los Angeles", "Chicago", "Houston", "San Francisco"],
  UK: ["London", "Manchester", "Birmingham", "Liverpool", "Edinburgh"],
  Canada: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa"],
  Australia: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide"],
};

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "https://reg-form-three-eta.vercel.app",
  "https://reg-form.vercel.app",
  "https://reg-form-1.vercel.app",
];

export function getAllowedOrigins() {
  const configuredOrigins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins])];
}
