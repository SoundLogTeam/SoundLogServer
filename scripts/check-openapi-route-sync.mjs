#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const routeSource = fs.readFileSync(
  path.join(projectRoot, 'src/routes/index.ts'),
  'utf8',
);
const openApiSource = fs.readFileSync(
  path.join(projectRoot, 'openapi/soundlog-api.yaml'),
  'utf8',
);
const supportedMethods = 'get|post|put|patch|delete';

function normalizeExpressPath(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function getExpressOperations() {
  const routePattern = new RegExp(
    `router\\.(${supportedMethods})\\(\\s*['\"]([^'\"]+)`,
    'g',
  );

  return Array.from(routeSource.matchAll(routePattern), (match) =>
    `${match[1].toUpperCase()} ${normalizeExpressPath(match[2])}`,
  );
}

function getOpenApiOperations() {
  const operations = [];
  let currentPath;

  openApiSource.split(/\r?\n/).forEach((line) => {
    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);

    if (pathMatch) {
      currentPath = pathMatch[1];
      return;
    }

    const methodMatch = line.match(
      new RegExp(`^    (${supportedMethods}):\\s*$`),
    );

    if (methodMatch && currentPath) {
      operations.push(`${methodMatch[1].toUpperCase()} ${currentPath}`);
    }
  });

  return operations;
}

function findDuplicates(operations) {
  const seen = new Set();
  const duplicates = new Set();

  operations.forEach((operation) => {
    if (seen.has(operation)) {
      duplicates.add(operation);
    }

    seen.add(operation);
  });

  return Array.from(duplicates).sort();
}

const expressOperations = getExpressOperations();
const openApiOperations = getOpenApiOperations();
const expressOperationSet = new Set(expressOperations);
const openApiOperationSet = new Set(openApiOperations);
const missingFromOpenApi = expressOperations
  .filter((operation) => !openApiOperationSet.has(operation))
  .sort();
const missingFromExpress = openApiOperations
  .filter((operation) => !expressOperationSet.has(operation))
  .sort();
const duplicateExpressOperations = findDuplicates(expressOperations);
const duplicateOpenApiOperations = findDuplicates(openApiOperations);

if (
  missingFromOpenApi.length > 0 ||
  missingFromExpress.length > 0 ||
  duplicateExpressOperations.length > 0 ||
  duplicateOpenApiOperations.length > 0
) {
  console.error('Express/OpenAPI route sync check failed.');

  if (missingFromOpenApi.length > 0) {
    console.error('\nMissing from OpenAPI:');
    missingFromOpenApi.forEach((operation) => console.error(`- ${operation}`));
  }

  if (missingFromExpress.length > 0) {
    console.error('\nDocumented but not implemented:');
    missingFromExpress.forEach((operation) => console.error(`- ${operation}`));
  }

  if (duplicateExpressOperations.length > 0) {
    console.error('\nDuplicate Express operations:');
    duplicateExpressOperations.forEach((operation) =>
      console.error(`- ${operation}`),
    );
  }

  if (duplicateOpenApiOperations.length > 0) {
    console.error('\nDuplicate OpenAPI operations:');
    duplicateOpenApiOperations.forEach((operation) =>
      console.error(`- ${operation}`),
    );
  }

  process.exit(1);
}

console.log(
  `Express/OpenAPI route sync check passed (${expressOperations.length} operations).`,
);
