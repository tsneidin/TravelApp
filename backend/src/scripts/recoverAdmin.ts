import 'dotenv/config';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { hashPassword } from '../lib/password.js';
import { z } from 'zod';

async function main(): Promise<void> {
  if (!process.argv.includes('--confirm')) {
    throw new Error('Recovery requires --confirm. This creates or updates the configured admin account and resets its password.');
  }
  const email = config.bootstrap.email.trim().toLowerCase();
  if (!z.string().email().safeParse(email).success || config.bootstrap.password.length < 8) {
    throw new Error('Set a valid BOOTSTRAP_EMAIL and a BOOTSTRAP_PASSWORD of at least 8 characters in the API container');
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const passwordHash = await hashPassword(config.bootstrap.password);
  await prisma.user.upsert({
    where: { email },
    create: { email, name: config.bootstrap.name.trim() || 'Admin', passwordHash, isAdmin: true },
    update: { passwordHash, isAdmin: true },
  });
  console.log(`[admin-recovery] ${existing ? 'reset and promoted' : 'created'} ${email}`);
}

main()
  .catch((error) => {
    console.error('[admin-recovery] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
