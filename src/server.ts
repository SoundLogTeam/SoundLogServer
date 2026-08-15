import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { contentModerationService } from './services/content-moderation.service.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`Soundlog API server listening on http://localhost:${env.PORT}`);
});

const moderationSweepTimer = setInterval(() => {
  void contentModerationService.sweepReportDeadlines().catch((error) => {
    console.error('Moderation deadline sweep failed', error);
  });
}, env.MODERATION_SWEEP_INTERVAL_MS);
moderationSweepTimer.unref();

function shutdown() {
  clearInterval(moderationSweepTimer);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
