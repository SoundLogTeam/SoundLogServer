#!/usr/bin/env node

const required = [
  'DATABASE_URL',
  'JWT_SECRET',
  'CLIENT_URLS',
  'UPLOAD_PUBLIC_BASE_URL',
  'APPLE_CLIENT_ID',
  'KAKAO_APP_ID',
];

const errors = [];
const warnings = [];

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

function isHttpsUrl(value) {
  return typeof value === 'string' && value.startsWith('https://');
}

required.forEach((key) => {
  if (!process.env[key]) {
    addError(`Missing required production env: ${key}`);
  }
});

if (process.env.NODE_ENV !== 'production') {
  addError('NODE_ENV must be production.');
}

if (process.env.USE_MOCK_DB === 'true') {
  addError('USE_MOCK_DB must be false or unset in production.');
}

if (process.env.ALLOW_DEV_AUTH_FALLBACK === 'true') {
  addError('ALLOW_DEV_AUTH_FALLBACK must be false or unset in production.');
}

if (!isHttpsUrl(process.env.UPLOAD_PUBLIC_BASE_URL)) {
  addError('UPLOAD_PUBLIC_BASE_URL must be an HTTPS URL.');
}

const clientUrls = (process.env.CLIENT_URLS ?? process.env.CLIENT_URL ?? '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

if (clientUrls.length === 0) {
  addError('CLIENT_URLS or CLIENT_URL must include at least one frontend origin.');
}

clientUrls.forEach((url) => {
  if (!isHttpsUrl(url)) {
    addError(`Client origin must be HTTPS in production: ${url}`);
  }
});

if ((process.env.JWT_SECRET ?? '').length < 32) {
  addWarning('JWT_SECRET is shorter than 32 characters. Use a long random secret in production.');
}

if (!process.env.TOUR_API_SERVICE_KEY) {
  addWarning('TOUR_API_SERVICE_KEY is missing. Tour nearby-place API will fall back to seed/mock behavior.');
}

if (warnings.length > 0) {
  console.log('Production env warnings:');
  warnings.forEach((warning) => console.log(`- ${warning}`));
}

if (errors.length > 0) {
  console.error('Production env check failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Production env check passed.');
