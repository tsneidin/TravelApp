# TravelApp usability polish, 0.0.134

Branch: `codex/mobile-usability-polish`

Started from a fresh GitHub clone of `master` at `2a36bd9` (0.0.129).

## Changes

- Replaced the segmented time picker with compact clock fields and separate desktop and mobile layouts.
- Fixed new journal saves from days with existing entries, made the New Journal action available with one existing entry, and surfaced validation and request errors in the form.
- Itinerary Notes and Journals actions now show their current counts in both desktop controls and the mobile day menu.
- Calendar visibility is a compact switch at the bottom of the item form, with source text in an expandable row beneath it.
- Title and place search share one field. Real results are selected before any custom location option, manual titles remain possible, and stale responses cannot overwrite newer queries.
- Normal searches use Google Places Text Search when configured, preserving result order and biasing toward the trip or day location. Without a key, the existing OpenStreetMap search remains available. Provider errors are visible.
- Added a saved account-wide 12/24-hour preference for time input and display, including booking date/time controls. Storage and timezone conversion semantics remain unchanged.
- Calendar visibility and source text moved from itinerary cards into the item edit form. Visibility changes apply on Save and are discarded on Cancel.
- Mobile map search occupies a full-width row with action buttons and route controls below it; autocomplete stays above those controls.
- The mobile itinerary map renders independently of desktop split-view preferences and fills the space between navigation bars.
- Mobile day headers use one Day options button beside Add. Notes, journals, to-dos, focus, and deletion are available in a compact sheet; desktop keeps its existing controls.
- Mobile itinerary cards keep titles readable and move their controls to a separate row with larger touch targets.
- The mobile assistant uses the existing top-bar control, freeing the floating Add place button from overlap.
- Timeline filters wrap on narrow screens. Mobile sheets, navigation, and map controls follow the selected theme.
- Dialogs constrain scrolling, keep keyboard focus inside, restore focus on close, and support Escape. Closed mobile navigation no longer receives keyboard focus.
- Failed create, edit, and confirmation actions show errors in their dialogs. Creation and editing preserve entered values; pending confirmations prevent repeat submissions.
- Trip and itinerary day labels preserve the calendar date in Central Time.
- Trip sections load on demand. Initial JavaScript fell from 556.53 KB to approximately 290 KB before compression, or 152.43 KB to approximately 88 KB compressed. This measures bundle size, not real-world load time.
- Switching tabs no longer reloads the sidebar trip list. Older trip detail requests cannot overwrite newer results.

## Verification

- Frontend lint, type checking, and production build passed.
- Backend lint and type checking passed; all 73 tests passed with a generated Prisma client and test-only environment values, including Google request and response handling tests.
- 46 browser tests passed with two expected desktop skips, including journal creation, count indicators, compact clock input, and mobile layout checks.
- Browser viewport sizes: 320 by 568, 390 by 844, and 1440 by 1000 pixels.
- Browser tests cover sample populated and empty trips, all eight trip sections, date display, form failures, deletion failures, keyboard focus, and mobile navigation.
- Reviewed generated mobile and desktop screenshots. Tests save populated-trip screenshots under `frontend/test-results/`.

Browser tests mock API responses. Live database persistence, Google Maps rendering,
email import, AI integrations, and physical iPhone/Safari behavior were not tested.
This branch has not been merged or deployed.
