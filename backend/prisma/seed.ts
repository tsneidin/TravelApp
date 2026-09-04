import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
  const adminCount = await prisma.user.count();
  console.log(`seed: ${adminCount} users exist; running demo seed`);

  if ((await prisma.user.count()) === 0) {
    const admin = await prisma.user.create({
      data: {
        email: 'demo@travelapp.local',
        name: 'Demo Admin',
        passwordHash: await hashPassword('password123'),
        isAdmin: true,
      },
    });

    const trip = await prisma.trip.create({
      data: {
        name: 'Japan Autumn',
        destination: 'Japan',
        currency: 'USD',
        startDate: new Date('2026-10-01'),
        endDate: new Date('2026-10-14'),
        ownerId: admin.id,
      },
    });

    const d1 = await prisma.day.create({ data: { tripId: trip.id, label: 'Arrival', date: new Date('2026-10-01') } });
    const d2 = await prisma.day.create({ data: { tripId: trip.id, label: 'Tokyo', date: new Date('2026-10-02') } });

    await prisma.place.createMany({
      data: [
        { tripId: trip.id, dayId: d1.id, name: 'Narita Airport', lat: 35.7647, lng: 140.3864, sortOrder: 0 },
        { tripId: trip.id, dayId: d2.id, name: 'Meiji Shrine', lat: 35.6764, lng: 139.6993, sortOrder: 0 },
        { tripId: trip.id, dayId: d2.id, name: 'Shibuya Crossing', lat: 35.6595, lng: 139.7005, sortOrder: 1 },
      ],
    });

    await prisma.booking.create({
      data: {
        tripId: trip.id,
        userId: admin.id,
        type: 'flight',
        title: 'ANA 123 to Tokyo (NRT)',
        provider: 'ANA',
        reference: 'ABCDEF',
        startAt: new Date('2026-10-01T08:00:00Z'),
      },
    });

    await prisma.expense.create({
      data: { tripId: trip.id, userId: admin.id, description: 'Shinkansen Tokyo->Kyoto', amount: 120, category: 'transport', currency: 'USD', date: new Date('2026-10-03') },
    });

    console.log('seed complete');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());