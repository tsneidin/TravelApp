import { test, expect } from '@playwright/test';

const user = { id: 'user-1', name: 'Test Traveler', email: 'traveler@example.test', isAdmin: false };
const baseTrip = {
  id: 'italy-trip', name: 'Italy', destination: 'Naples and Bari', currency: 'EUR',
  ownerId: user.id, owner: user, startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-15T00:00:00.000Z',
  createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z',
  members: [], days: [], places: [], bookings: [], expenses: [], packing: [], journal: [], photos: [], todos: [],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('travelapp_token', 'sample-token'));
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user } }));
  await page.route('**/api/trips', (route) => route.fulfill({ json: { trips: [baseTrip] } }));
  await page.route('**/api/trips/*/ai/status', (route) => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/trips/*/ai/messages', (route) => route.fulfill({ json: { messages: [] } }));
});

test('busy calendar stays contained and readable', async ({ page }, testInfo) => {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
  const events = Array.from({ length: 8 }, (_, index) => ({
    id: `place-${index}`,
    type: 'place',
    tripId: baseTrip.id,
    title: `Naples and Bari reservation number ${index + 1}`,
    date,
    sortOrder: index,
    placeId: `place-${index}`,
    category: index % 2 ? 'Transport' : 'Restaurant',
  }));
  await page.route('**/api/calendar', (route) => route.fulfill({ json: { events } }));
  await page.goto('/calendar');

  const scroll = page.locator('.calendar-scroll');
  const grid = page.locator('.cal-grid');
  await expect(grid).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  const sizes = await scroll.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  if (testInfo.project.name === 'desktop') expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
  else expect(sizes.scroll).toBeGreaterThan(sizes.client);
  const event = page.locator('.cal-event').first();
  const cell = event.locator('..');
  expect((await event.boundingBox())!.width).toBeLessThanOrEqual((await cell.boundingBox())!.width);
  await expect(page.getByText('+3 more', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('busy-calendar.png') });
});

test('every expense can be deleted from desktop and mobile budget views', async ({ page }, testInfo) => {
  let currentTrip = {
    ...baseTrip,
    expenses: [
      { id: 'expense-auto', tripId: baseTrip.id, description: 'ITABUS (TEST12345)', amount: 39.98, currency: 'EUR', category: 'transport', date: '2026-10-01T12:45:00.000Z', splitType: 'none', paidById: user.id },
      { id: 'expense-duplicate', tripId: baseTrip.id, description: '2x Ticket Comfort', amount: 39.98, currency: 'EUR', category: 'activity', date: '2026-10-01T12:45:00.000Z', splitType: 'none', paidById: user.id },
    ],
  };
  let deletedId = '';
  await page.route(`**/api/trips/${baseTrip.id}`, (route) => route.fulfill({ json: { trip: currentTrip } }));
  await page.route(`**/api/trips/${baseTrip.id}/expenses/*`, async (route) => {
    deletedId = new URL(route.request().url()).pathname.split('/').pop() || '';
    currentTrip = { ...currentTrip, expenses: currentTrip.expenses.filter((expense) => expense.id !== deletedId) };
    await route.fulfill({ status: 204, body: '' });
  });
  await page.goto(`/trips/${baseTrip.id}?tab=budget`);

  if (testInfo.project.name === 'desktop') {
    const row = page.locator('tr').filter({ hasText: '2x Ticket Comfort' });
    await row.getByTitle('Delete expense').click();
  } else {
    await page.getByRole('button', { name: 'Delete 2x Ticket Comfort', exact: true }).click();
  }
  const confirmation = page.getByRole('dialog', { name: 'Delete expense' });
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect(deletedId).toBe('expense-duplicate');
  await expect(page.getByText('2x Ticket Comfort', { exact: true })).toHaveCount(0);
  await expect(page.getByText('ITABUS (TEST12345)', { exact: true }).filter({ visible: true })).toBeVisible();
});

test('left navigation omits the Add Trip Note shortcut', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.route(`**/api/trips/${baseTrip.id}`, (route) => route.fulfill({ json: { trip: baseTrip } }));
  await page.goto(`/trips/${baseTrip.id}?tab=itinerary`);
  await expect(page.getByText('Add Trip Note', { exact: true })).toHaveCount(0);
});
