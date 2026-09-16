import { test, expect } from '@playwright/test';
import { minutesOfDay, timelinePosition } from '../src/lib/timelineGeometry';

const user = { id: 'user-1', name: 'Traveler', email: 'traveler@example.test', isAdmin: false };
const trip = {
  id: 'timeline-trip', name: 'Italy', destination: 'Naples and Bari', currency: 'EUR', ownerId: user.id, owner: user,
  startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-02T00:00:00.000Z',
  createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z',
  members: [], places: [], expenses: [], packing: [], journal: [], photos: [], todos: [],
  days: [{
    id: 'day-2', tripId: 'timeline-trip', date: '2026-10-02T00:00:00.000Z', sortOrder: 1,
    places: [{ id: 'activity-1', tripId: 'timeline-trip', dayId: 'day-2', name: 'Museum visit', category: 'Activity', sortOrder: 0,
      startTime: '2026-10-02T15:00:00.000Z', endTime: '2026-10-02T17:00:00.000Z' }],
  }],
  bookings: [
    { id: 'hotel-1', tripId: 'timeline-trip', type: 'hotel', title: 'Bari hotel', startAt: '2026-10-01T15:00:00.000Z', endAt: '2026-10-04T11:00:00.000Z' },
    { id: 'bus-1', tripId: 'timeline-trip', type: 'car', title: 'Intercity bus', startAt: '2026-10-02T09:00:00.000Z', endAt: '2026-10-02T12:00:00.000Z' },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('travelapp_token', 'sample-token'));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === '/api/auth/me') data = { user };
    else if (path === '/api/trips') data = { trips: [trip] };
    else if (path === `/api/trips/${trip.id}`) data = { trip };
    else if (path.endsWith('/ai/status')) data = { enabled: false };
    else if (path.endsWith('/ai/messages')) data = { messages: [] };
    await route.fulfill({ json: data });
  });
});

test('timeline geometry maps check-in, checkout, and short visits to hours', () => {
  expect(minutesOfDay('3:30 PM')).toBe(930);
  const hotel = timelinePosition(0, 3, 240, '2026-10-01T15:00:00Z', '2026-10-04T11:00:00Z');
  expect(hotel.left).toBe(150);
  expect(hotel.width).toBeCloseTo(680);
  const overnight = timelinePosition(1, 1, 240, '23:00', '01:00', { minWidth: 0 });
  expect(overnight.width).toBeCloseTo(20);
});

test('hotel spans check-in through checkout and timed items use part of each day', async ({ page }, testInfo) => {
  await page.goto(`/trips/${trip.id}?tab=timeline`);
  const stay = page.getByTestId('timeline-stay');
  const transit = page.getByTestId('timeline-transit');
  const activity = page.getByTestId('timeline-activity');
  await expect(stay).toBeVisible();
  await expect(transit).toBeVisible();
  await expect(activity).toBeVisible();
  await expect(page.getByText('Day 4', { exact: true })).toBeVisible();
  const positions = await Promise.all([stay, transit, activity].map((item) => item.evaluate((el) => ({
    left: parseFloat((el as HTMLElement).style.left), width: parseFloat((el as HTMLElement).style.width),
  }))));
  expect(positions[0].left).toBeGreaterThan(0);
  expect(positions[0].width).toBeGreaterThan(positions[1].width * 10);
  expect(positions[2].left).toBeGreaterThan(positions[1].left);
  expect(positions[1].width).toBeLessThan(100);
  await page.screenshot({ path: testInfo.outputPath('timed-timeline.png') });
  await page.getByRole('button', { name: 'Open Museum visit details' }).click();
  await expect(page.getByRole('dialog', { name: 'Museum visit' })).toBeVisible();
});
