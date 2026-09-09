import { test, expect } from '@playwright/test';

const user = { id: 'user-1', name: 'Sample Traveler', email: 'sample@example.test', isAdmin: false };
const trip = {
  id: 'sample-trip', name: 'Japan autumn: Tokyo, Kyoto and the Japanese Alps',
  destination: 'Tokyo / Kyoto / Matsumoto', currency: 'USD', ownerId: user.id, owner: user,
  startDate: '2026-10-12T00:00:00.000Z', endDate: '2026-10-20T00:00:00.000Z',
  createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z',
  members: [], days: [], places: [], bookings: [], expenses: [], packing: [], journal: [], photos: [], todos: [],
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

test('trip calendar dates do not shift backwards in Central Time', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('10/12/2026', { exact: false })).toBeVisible();
  await page.goto(`/trips/${trip.id}?tab=bookings`);
  await expect(page.locator('.page-sub')).toContainText('10/12/2026');
});

test('failed creation preserves the form and allows retry', async ({ page }) => {
  await page.route('**/api/trips', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 503, json: { error: 'Connection interrupted. Try again.' } });
    } else await route.fulfill({ json: { trips: [trip] } });
  });
  await page.goto('/');
  await page.getByRole('main').getByRole('button', { name: 'New trip', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New trip' });
  await dialog.getByLabel('Name', { exact: true }).fill('Autumn holiday');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Connection interrupted');
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Autumn holiday');
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
});

test('dialogs contain focus, scroll on short screens and restore focus', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('main').getByRole('button', { name: 'New trip', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'New trip' });
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close modal' })).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await dialog.getByLabel('Name', { exact: true }).fill('A trip');
  await dialog.getByRole('button', { name: 'Create', exact: true }).scrollIntoViewIfNeeded();
  const bounds = await dialog.getByRole('button', { name: 'Create', exact: true }).boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});

test('trip editing reports errors inside the dialog', async ({ page }) => {
  await page.route(`**/api/trips/${trip.id}`, async (route) => {
    await route.fulfill(route.request().method() === 'PATCH'
      ? { status: 503, json: { error: 'Could not save. Retry.' } }
      : { json: { trip } });
  });
  await page.goto(`/trips/${trip.id}?tab=bookings`);
  await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit trip' });
  await dialog.getByLabel('Name', { exact: true }).fill('Revised trip');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not save');
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Revised trip');
});

test('mobile navigation works in light themes without horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop');
  await page.goto(`/trips/${trip.id}?tab=bookings`);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'homedepot'));
  await page.getByRole('button', { name: 'More trip sections' }).click();
  const sheet = page.getByRole('dialog', { name: 'More trip sections' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS('background-image', 'linear-gradient(rgb(255, 255, 255), rgb(250, 251, 252))');
  await sheet.getByRole('link', { name: 'Packing List', exact: false }).click();
  await expect(page).toHaveURL(/tab=packing/);
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Main navigation' });
  await expect(drawer).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#main-navigation')).toHaveCSS('visibility', 'hidden');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('trip sections fit the viewport', async ({ page }) => {
  for (const tab of ['itinerary', 'bookings', 'budget', 'packing', 'todos', 'photos', 'timeline', 'map']) {
    await page.goto(`/trips/${trip.id}?tab=${tab}`);
    await expect(page.getByRole('heading', { name: trip.name })).toBeVisible();
    await expect(page.getByText('Loading section…')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), tab).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
});

test('populated trip stays usable on narrow screens', async ({ page }, testInfo) => {
  const place = { id: 'place-1', tripId: trip.id, dayId: 'day-1', name: 'Explore the historic streets and gardens of eastern Kyoto', category: 'activity', sortOrder: 0, includeInCalendar: true };
  const populated = {
    ...trip,
    days: [{ id: 'day-1', tripId: trip.id, date: trip.startDate, sortOrder: 0, location: 'Kyoto', places: [place] }],
    places: [place],
    packing: [{ id: 'pack-1', tripId: trip.id, item: 'Waterproof jacket and comfortable walking shoes', category: 'Clothing', done: false, sortOrder: 0 }],
    todos: [{ id: 'todo-1', tripId: trip.id, title: 'Reserve tickets for the train from Tokyo to Kyoto', done: false, sortOrder: 0 }],
    bookings: [{ id: 'booking-1', tripId: trip.id, type: 'hotel', title: 'Kyoto garden hotel near the historic district', startAt: trip.startDate, endAt: trip.endDate }],
  };
  await page.route(`**/api/trips/${trip.id}`, (route) => route.fulfill({ json: { trip: populated } }));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const tab of ['itinerary', 'bookings', 'packing', 'todos', 'timeline']) {
    await page.goto(`/trips/${trip.id}?tab=${tab}`);
    await expect(page.getByRole('heading', { name: trip.name })).toBeVisible();
    await expect(page.getByText('Loading section…')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), tab).toBeLessThanOrEqual(page.viewportSize()!.width);
    if (testInfo.project.name !== 'desktop') {
      const nav = page.getByRole('navigation', { name: 'Trip navigation' });
      await expect(nav).toBeInViewport();
      if (tab === 'itinerary') {
        await expect(page.locator('.place-title').first()).toBeVisible();
        const titleBounds = await page.locator('.place-title-group').first().boundingBox();
        expect(titleBounds!.width).toBeGreaterThan(150);
        await expect(page.getByRole('button', { name: 'Add place', exact: true })).toBeInViewport();
        await expect(page.locator('.ai-fab')).toBeHidden();
        await expect(page.locator('.mobile-day-chip-sub').first()).toContainText('Mon, 10/12');
        const toolbar = page.locator('.day-toolbar').first();
        expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(44);
        await expect(toolbar.getByRole('button', { name: 'Edit day notes' })).toBeHidden();
        const options = toolbar.getByRole('button', { name: 'Day 1 options' });
        for (const action of ['Notes (0)', 'Journals (0)', 'To-dos (0)']) {
          await options.click();
          const sheet = page.getByRole('dialog', { name: 'Day 1 options' });
          await expect(sheet.getByRole('button', { name: action, exact: true })).toBeVisible();
          await sheet.getByRole('button', { name: action, exact: true }).click();
          await expect(sheet).toHaveCount(0);
          await expect(page.getByRole('dialog')).toHaveCount(1);
          await page.keyboard.press('Escape');
          await expect(page.getByRole('dialog')).toHaveCount(0);
        }
        await options.click();
        await page.getByRole('dialog').getByRole('button', { name: 'Focus day', exact: true }).click();
        await expect(options).toHaveClass(/primary/);
        expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(44);
        await options.click();
        await page.getByRole('dialog').getByRole('button', { name: 'Show all days', exact: true }).click();
        await expect(options).not.toHaveClass(/primary/);
        await options.click();
        await page.getByRole('dialog').getByRole('button', { name: 'Delete day', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Delete day' })).toBeVisible();
        await page.keyboard.press('Escape');
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`${tab}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('failed deletion stays recoverable and blocks duplicate clicks', async ({ page }) => {
  let deleteRequests = 0;
  await page.route(`**/api/trips/${trip.id}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      deleteRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({ status: 503, json: { error: 'Deletion failed. Try again.' } });
    } else await route.fulfill({ json: { trip } });
  });
  await page.goto(`/trips/${trip.id}?tab=bookings`);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete trip' });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Working…' })).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('Deletion failed');
  expect(deleteRequests).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
});

test('calendar and source controls live in the item edit form', async ({ page }, testInfo) => {
  let item = { id: 'place-1', tripId: trip.id, name: 'Kyoto walking tour', category: 'activity', sortOrder: 0, includeInCalendar: true, sourceText: 'Confirmation: Kyoto walking tour, reference SAMPLE-123.' };
  const updates: unknown[] = [];
  await page.route(`**/api/trips/${trip.id}`, (route) => route.fulfill({ json: { trip: { ...trip, places: [item] } } }));
  await page.route(`**/api/trips/${trip.id}/places/place-1`, async (route) => {
    const update = route.request().postDataJSON();
    updates.push(update);
    item = { ...item, ...update };
    await route.fulfill({ json: { place: item } });
  });
  await page.goto(`/trips/${trip.id}?tab=itinerary`);
  const card = page.locator('.place-card-compact').first();
  await expect(card.getByRole('button', { name: /calendar|source/i })).toHaveCount(0);
  await card.getByRole('button', { name: 'Edit place', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Edit place' });
  await expect(form.getByLabel('Show in calendar')).toBeChecked();
  await form.getByRole('button', { name: 'View source', exact: true }).click();
  await expect(form.getByText(item.sourceText, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('item-form-footer.png') });
  await form.getByLabel('Show in calendar').uncheck();
  expect(updates).toHaveLength(0);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({ includeInCalendar: false });
  await card.getByRole('button', { name: 'Edit place', exact: true }).click();
  await expect(form.getByLabel('Show in calendar')).not.toBeChecked();
  await form.getByLabel('Show in calendar').check();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(updates).toHaveLength(1);
});

test('mobile map search has its own full-width unobstructed row', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop');
  await page.route('**/api/places/search?**', (route) => route.fulfill({ json: { places: [{ name: 'Kyoto Station', address: 'Kyoto, Japan', lat: 34.985, lng: 135.759, category: 'transit' }] } }));
  for (const tab of ['map', 'itinerary']) {
    await page.goto(`/trips/${trip.id}?tab=${tab}`);
    if (tab === 'itinerary') await page.getByTitle('Switch to interactive map view', { exact: true }).click();
    const toolbar = page.locator('.map-top-floating-bar:visible').first();
    const input = toolbar.getByPlaceholder('Search map places, hotels, landmarks…');
    await expect(input).toBeVisible();
    const field = (await input.boundingBox())!;
    const bar = (await toolbar.boundingBox())!;
    const actions = (await toolbar.locator('.map-top-actions-group').boundingBox())!;
    expect(field.width).toBeGreaterThanOrEqual(bar.width - 1);
    expect(actions.y).toBeGreaterThanOrEqual(field.y + field.height);
    if (tab === 'itinerary') {
      expect(field.y + field.height).toBeLessThan(page.viewportSize()!.height / 2);
      const add = (await page.getByRole('button', { name: 'Add place', exact: true }).boundingBox())!;
      expect(add.y).toBeGreaterThan(field.y + field.height);
    }
    await input.fill('Kyoto');
    await expect(toolbar.getByText('Kyoto Station', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${tab}-search.png`) });
    await toolbar.getByText('Kyoto Station', { exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').locator('input[value="Kyoto Station"]')).toBeVisible();
  }
});

test('one title field supports real search results and manual titles', async ({ page }, testInfo) => {
  await page.route('**/api/places/search?**', (route) => route.fulfill({ json: { provider: 'Google Maps', places: [{ name: 'Kyoto Station', address: 'Kyoto, Japan', lat: 34.985, lng: 135.759, category: 'Transport' }] } }));
  let saved: Record<string, unknown> | undefined;
  await page.route(`**/api/trips/${trip.id}/places`, async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { place: saved } });
  });
  await page.goto(`/trips/${trip.id}?tab=itinerary`);
  await page.getByRole('button', { name: 'Add place', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add place' });
  const title = form.getByRole('combobox', { name: 'Title / Place name', exact: true });
  await title.fill('Kyoto station');
  await expect(form.getByRole('option', { name: /Kyoto Station/ })).toBeVisible();
  await expect(form.getByText(/as location/)).toHaveCount(0);
  await title.press('Enter');
  await expect(title).toHaveValue('Kyoto Station');
  await expect(form.locator('input[value="Kyoto, Japan"]')).toBeVisible();
  await expect(form.getByRole('listbox')).toHaveCount(0);
  await title.fill('Meet friends at the station');
  await expect(form.getByRole('option', { name: /Kyoto Station/ })).toBeVisible();
  await title.press('Escape');
  await expect(form).toBeVisible();
  await expect(title).toHaveValue('Meet friends at the station');
  await page.screenshot({ path: testInfo.outputPath('combined-place-form.png') });
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(saved).toMatchObject({ name: 'Meet friends at the station', address: 'Kyoto, Japan', lat: 34.985 });
});

test('time preference controls itinerary display and editing without shifting stored time', async ({ page }, testInfo) => {
  for (const format of ['12', '24']) {
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { ...user, settings: { timeFormat: format } } } }));
    const item = { id: 'clock-place', tripId: trip.id, name: 'Afternoon tour', sortOrder: 0, includeInCalendar: true, startTime: '2026-10-12T13:05:00.000Z' };
    let saved: Record<string, unknown> | undefined;
    await page.route(`**/api/trips/${trip.id}`, (route) => route.fulfill({ json: { trip: { ...trip, places: [item] } } }));
    await page.route(`**/api/trips/${trip.id}/places/clock-place`, async (route) => {
      saved = route.request().postDataJSON();
      await route.fulfill({ json: { place: { ...item, ...saved } } });
    });
    await page.goto(`/trips/${trip.id}?tab=itinerary`);
    const card = page.locator('.place-card-compact').first();
    await expect(card).toContainText(format === '24' ? '13:05' : '1:05 PM');
    await card.getByRole('button', { name: 'Edit place' }).click();
    const form = page.getByRole('dialog', { name: 'Edit place' });
    await expect(form.locator('.clock-field:visible').getByLabel('Start time', { exact: true })).toHaveValue(format === '24' ? '13:05' : '1:05 PM');
    await page.screenshot({ path: testInfo.outputPath(`time-form-${format}.png`) });
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toHaveCount(0);
    expect(saved?.startTime).toBe('2026-10-12T13:05:00.000Z');
  }
});

test('account time format is saved with existing settings', async ({ page }, testInfo) => {
  let profile = { ...user, settings: { timeFormat: '12', otherPreference: 'preserved' } };
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: profile } }));
  await page.route('**/api/auth/profile', async (route) => {
    profile = { ...profile, ...route.request().postDataJSON() };
    await route.fulfill({ json: { user: profile } });
  });
  await page.goto('/');
  if (testInfo.project.name !== 'desktop') await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page.getByTitle('Account & Member Settings', { exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Account & Member Settings' });
  await form.getByLabel('Time format', { exact: true }).selectOption('24');
  await form.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(form.getByText('Profile updated successfully!')).toBeVisible();
  expect(profile.settings).toEqual({ timeFormat: '24', otherPreference: 'preserved' });
});

test('booking date and time entry respects the saved clock format', async ({ page }) => {
  for (const format of ['12', '24']) {
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { ...user, settings: { timeFormat: format } } } }));
    const booking = { id: 'clock-booking', tripId: trip.id, type: 'hotel', title: 'Kyoto hotel', startAt: '2026-10-12T18:30:00.000Z', endAt: '2026-10-13T18:30:00.000Z' };
    await page.route(`**/api/trips/${trip.id}`, (route) => route.fulfill({ json: { trip: { ...trip, bookings: [booking] } } }));
    await page.goto(`/trips/${trip.id}?tab=bookings`);
    await page.getByText('Kyoto hotel', { exact: true }).click();
    const form = page.getByRole('dialog');
    await expect(form.locator('.clock-field:visible').getByLabel('Start time', { exact: true })).toHaveValue(format === '12' ? '1:30 PM' : '13:30');
    await expect(form.getByLabel('Start date', { exact: true })).toHaveValue('2026-10-12');
  }
});

test('day controls show note and journal counts on desktop and mobile', async ({ page }, testInfo) => {
  const note = { id: 'note-1', tripId: trip.id, dayId: 'day-1', name: 'Reservation note', category: 'Note', sortOrder: 0 };
  const populated = {
    ...trip,
    days: [{ id: 'day-1', tripId: trip.id, date: trip.startDate, sortOrder: 0, notes: 'Bring tickets', places: [note] }],
    places: [note],
    journal: [{ id: 'journal-1', tripId: trip.id, title: 'Arrival', body: 'A good day', date: trip.startDate }],
  };
  await page.route(`**/api/trips/${trip.id}`, (route) => route.fulfill({ json: { trip: populated } }));
  await page.goto(`/trips/${trip.id}?tab=itinerary`);
  if (testInfo.project.name === 'desktop') {
    await expect(page.getByRole('button', { name: 'Notes (2)', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Journals (1)', exact: true })).toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Day 1 options' }).click();
    const options = page.getByRole('dialog', { name: 'Day 1 options' });
    await expect(options.getByRole('button', { name: 'Notes (2)', exact: true })).toBeVisible();
    await expect(options.getByRole('button', { name: 'Journals (1)', exact: true })).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath('day-counts.png') });
});

test('new journal from an existing day creates a separate entry', async ({ page }, testInfo) => {
  const existing = { id: 'journal-1', tripId: trip.id, title: 'Arrival', body: 'Existing entry', date: trip.startDate };
  const populated = {
    ...trip,
    days: [{ id: 'day-1', tripId: trip.id, date: trip.startDate, sortOrder: 0, places: [] }],
    journal: [existing],
  };
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  await page.route(`**/api/trips/${trip.id}`, (route) => route.fulfill({ json: { trip: populated } }));
  await page.route(`**/api/trips/${trip.id}/journal**`, async (route) => {
    requests.push({ method: route.request().method(), path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    await route.fulfill({ status: 201, json: { entry: { id: 'journal-2', ...route.request().postDataJSON() } } });
  });
  await page.goto(`/trips/${trip.id}?tab=itinerary`);
  if (testInfo.project.name === 'desktop') {
    await page.getByRole('button', { name: 'Journals (1)', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Day 1 options' }).click();
    await page.getByRole('dialog', { name: 'Day 1 options' }).getByRole('button', { name: 'Journals (1)', exact: true }).click();
  }
  const form = page.getByRole('dialog', { name: 'Edit Journal Entry' });
  await form.getByRole('button', { name: 'New Journal', exact: true }).click();
  const newForm = page.getByRole('dialog', { name: 'New Journal Entry' });
  await newForm.getByLabel('Title', { exact: true }).fill('Evening walk');
  await newForm.getByLabel('Story & Notes', { exact: true }).fill('Walked through Gion.');
  await newForm.getByRole('button', { name: 'Save Entry', exact: true }).click();
  await expect(newForm).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ method: 'POST', path: `/api/trips/${trip.id}/journal` });
});
