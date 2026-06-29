import {
  ALLOWED_FILE_TYPES,
  COUNTRY_CITY_MAP,
  GENDER_OPTIONS,
  INTEREST_OPTIONS,
  MAX_FILE_SIZE,
} from "./config.js";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mobileRegex = /^\+?[0-9\s-]{7,15}$/;

export function normalizeRegistrationInput(rawInput) {
  const interests = Array.isArray(rawInput.interests)
    ? rawInput.interests
    : typeof rawInput.interests === "string" && rawInput.interests.length > 0
      ? [rawInput.interests]
      : [];

  return {
    fullName: String(rawInput.fullName ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    email: String(rawInput.email ?? "")
      .trim()
      .toLowerCase(),
    mobile: String(rawInput.mobile ?? "").trim(),
    dateOfBirth: String(rawInput.dateOfBirth ?? "").trim(),
    gender: String(rawInput.gender ?? "").trim(),
    interests: [...new Set(interests.map((value) => String(value).trim()).filter(Boolean))],
    country: String(rawInput.country ?? "").trim(),
    city: String(rawInput.city ?? "").trim(),
  };
}

export function validateRegistration(input, file) {
  const errors = {};

  if (input.fullName.length < 2 || input.fullName.length > 100) {
    errors.fullName = "Full name must be between 2 and 100 characters.";
  }

  if (!emailRegex.test(input.email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!mobileRegex.test(input.mobile)) {
    errors.mobile = "Enter a valid mobile number (7-15 digits).";
  }

  if (!isValidPastDate(input.dateOfBirth)) {
    errors.dateOfBirth = "Select a valid date of birth.";
  }

  if (!GENDER_OPTIONS.has(input.gender)) {
    errors.gender = "Select a gender.";
  }

  if (input.interests.length === 0) {
    errors.interests = "Pick at least one interest.";
  } else if (input.interests.some((value) => !INTEREST_OPTIONS.has(value))) {
    errors.interests = "Pick valid interests.";
  }

  if (!input.country) {
    errors.country = "Select a country.";
  } else if (!(input.country in COUNTRY_CITY_MAP)) {
    errors.country = "Select a valid country.";
  }

  if (!input.city) {
    errors.city = "Select a city.";
  } else if (
    input.country in COUNTRY_CITY_MAP &&
    !COUNTRY_CITY_MAP[input.country].includes(input.city)
  ) {
    errors.city = "Select a valid city.";
  }

  if (!file) {
    errors.photo = "Upload a JPG or PNG photo under 1 MB.";
  } else if (!ALLOWED_FILE_TYPES.has(file.mimetype)) {
    errors.photo = "Only JPG, JPEG, or PNG files are allowed.";
  } else if (file.size > MAX_FILE_SIZE) {
    errors.photo = "Photo must be 1 MB or smaller.";
  }

  return errors;
}

function isValidPastDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;

  return parsed <= new Date();
}
