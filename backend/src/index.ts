import 'dotenv/config';
import { createApp } from './app.js';
import { prisma } from './db.js';
import { config } from './config.js';
import { hashPassword } from './lib/password.js';
import { startEmailWorker } from './services/emailPoller.js';

async function bootstrapAdmin() {
  const count = await prisma.user.count();
  if (count === 0 && config.bootstrap.email && config.bootstrap.password) {
    const existing = await prisma.user.findUnique({ where: { email: config.bootstrap.email.toLowerCase() } });
    if (!existing) {
      await prisma.user.create({
        data: {
          email: config.bootstrap.email.toLowerCase(),
          name: config.bootstrap.name,
          passwordHash: await hashPassword(config.bootstrap.password),
          isAdmin: true,
        },
      });
      console.log(`[bootstrap] created admin ${config.bootstrap.email}`);
    }
  }
}

async function main() {
  await bootstrapAdmin();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[api] listening on :${config.port}`);
    console.log(`[api] debug logging ${config.debugLogging ? 'enabled' : 'disabled'}`);
  });

  if (config.email.enabled) {
    startEmailWorker();
  } else {
    console.log('[email] worker disabled (EMAIL_ENABLED=false)');
  }

  const shutdown = async () => {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('[api] fatal startup error', e);
  process.exit(1);
});