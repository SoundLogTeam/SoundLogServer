#!/bin/sh

set -eu

node scripts/check-production-env.mjs
./node_modules/.bin/prisma migrate deploy
node dist/prisma/seed.js --public-catalog
exec node dist/src/server.js
