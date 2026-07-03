import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scanRoots = ['src', 'prisma', 'openapi', 'tests', 'dist'];
const blockedPatterns = [
  /spotify/i,
  /open\.spotify\.com/i,
  /spotify-auth/i,
  /playback/i,
];
const allowedExtensions = new Set([
  '.js',
  '.json',
  '.mjs',
  '.prisma',
  '.sql',
  '.ts',
  '.yaml',
  '.yml',
]);
const ignoredDirectories = new Set(['node_modules', '.git']);
const findings = [];

function listFiles(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  const stat = fs.statSync(targetPath);

  if (stat.isFile()) {
    return [targetPath];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  return fs.readdirSync(targetPath, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      return [];
    }

    return listFiles(path.join(targetPath, entry.name));
  });
}

function isTextFile(filePath) {
  return allowedExtensions.has(path.extname(filePath));
}

for (const root of scanRoots) {
  for (const filePath of listFiles(path.join(projectRoot, root)).filter(isTextFile)) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(projectRoot, filePath);

    blockedPatterns.forEach((pattern) => {
      if (pattern.test(text)) {
        findings.push(`${relativePath} matches ${pattern}`);
      }
    });
  }
}

if (findings.length > 0) {
  console.error('Spotify/streaming metadata check failed:');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log('Spotify/streaming metadata check passed.');
