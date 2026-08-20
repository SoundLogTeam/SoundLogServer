#!/usr/bin/env node

const required = [
  'DATABASE_URL',
  'JWT_SECRET',
  'CLIENT_URLS',
  'UPLOAD_PUBLIC_BASE_URL',
  'MODERATION_ADMIN_KEY',
  'MODERATION_ALERT_MODE',
  'APP_REVIEW_EMAIL',
  'APP_REVIEW_PASSWORD',
  'SUPPORT_EMAIL',
  'TRUST_PROXY_HOPS',
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

if (process.env.AUTH_RATE_LIMIT_ENABLED === 'false') {
  addError('AUTH_RATE_LIMIT_ENABLED must not be false in production.');
}

if (process.env.TRUST_PROXY_HOPS !== '1') {
  addError('TRUST_PROXY_HOPS must be 1 behind the api.soundlog.p-e.kr nginx proxy.');
}

if (!isHttpsUrl(process.env.UPLOAD_PUBLIC_BASE_URL)) {
  addError('UPLOAD_PUBLIC_BASE_URL must be an HTTPS URL.');
}

if (process.env.UPLOAD_PUBLIC_BASE_URL !== 'https://api.soundlog.p-e.kr') {
  addError('UPLOAD_PUBLIC_BASE_URL must use https://api.soundlog.p-e.kr.');
}

if (
  process.env.ML_RECOMMENDATION_API_URL &&
  !isHttpsUrl(process.env.ML_RECOMMENDATION_API_URL)
) {
  addWarning(
    'ML_RECOMMENDATION_API_URL is not HTTPS and will be disabled; seed recommendations will be used.',
  );
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

if ((process.env.MODERATION_ADMIN_KEY ?? '').length < 32) {
  addError('MODERATION_ADMIN_KEY must be at least 32 characters in production.');
}

if (!['cloud_logging', 'webhook'].includes(process.env.MODERATION_ALERT_MODE)) {
  addError('MODERATION_ALERT_MODE must be cloud_logging or webhook.');
}

if (
  process.env.MODERATION_ALERT_MODE === 'webhook' &&
  !isHttpsUrl(process.env.MODERATION_ALERT_WEBHOOK_URL)
) {
  addError('Webhook alert mode requires an HTTPS MODERATION_ALERT_WEBHOOK_URL.');
}

if ((process.env.APP_REVIEW_PASSWORD ?? '').length < 8) {
  addError('APP_REVIEW_PASSWORD must be at least 8 characters.');
}

if (!/^\S+@\S+\.\S+$/.test(process.env.SUPPORT_EMAIL ?? '')) {
  addError('SUPPORT_EMAIL must be a valid email address.');
}

if ((process.env.SUPPORT_EMAIL ?? '').endsWith('@soundlog.shop')) {
  addError('SUPPORT_EMAIL must not use soundlog.shop until its mail receiving setup is verified.');
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
