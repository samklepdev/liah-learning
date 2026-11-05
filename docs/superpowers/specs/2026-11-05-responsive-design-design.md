# Responsive design for mobile and desktop — design

## Context

The app currently has only two responsive breakpoints in `frontend/src/App.css`:
- `@media (max-width: 48rem)` — turns the sidebar into a fixed overlay with a scrim.
- `@media (max-width: 30rem)` — drops the theme toggle's text label, icon only.

Everything else has no responsive handling. Most pages (auth, quiz, results, course-list,
progress, notfound, profile) are already single-column with `max-width` + horizontal
padding, so they're expected to reflow reasonably already — these get a visual spot-check,
not new CSS. The admin tables are the real gap: they're fixed multi-column `<table>`
layouts that will overflow horizontally on a phone.

This spec covers the whole app (not just the admin section touched by the recent
pagination work), to the "polished" bar: phone-width layouts should be deliberately
reworked, not just prevented from breaking.

## Breakpoints

Reuses the existing `rem`-based convention in `App.css`:

- **≤48rem (768px)** — existing: sidebar overlay.
- **≤40rem (640px)** *(new)* — "phone" tier: admin tables become card lists, two-button
  action rows stack vertically, topnav spacing tightens.
- **≤30rem (480px)** — existing: theme toggle drops its label.

## Admin tables → card list at ≤40rem

`AdminUsersPage.tsx` (main users table, import-preview table, import-results "created"
table), and `AttemptsTable.tsx` (used standalone and inside `UserAttemptsModal.tsx`) all
render `<table className="admin-table">`. One shared CSS treatment covers all of them.

**Markup change:** add a `data-label="..."` attribute to every `<td>` in these four
tables, matching its column header text (e.g. `<td data-label="Email">{u.email}</td>`).
No behavior or structural change — purely an attribute addition.

**CSS (`App.css`), inside `@media (max-width: 40rem)`:**
- `.admin-table thead` — `display: none` (headers become redundant once each cell is
  self-labeled).
- `.admin-table tr` — `display: block`, bordered, rounded, with margin between rows so
  each row reads as a card. Replaces the existing per-cell `border-bottom`.
- `.admin-table td` — `display: flex`, `justify-content: space-between`, no individual
  border; `::before { content: attr(data-label); font-weight: 600; opacity: 0.7; }`
  renders the label on the left, value on the right.
- `.admin-table td.admin-actions` — the actions cell has no single "value," so it skips
  the label pseudo-element (`::before { content: none }`) and instead renders its icon
  buttons left-aligned in their own row within the card.
- `.admin-attempts-row td` (the expandable attempts sub-row) and `.admin-modal`'s table
  inherit the same card rendering automatically — no separate rule needed since both
  reuse `.admin-table`.

## Two-button rows stack at ≤40rem

- `.profile-actions` (Save/Cancel on `ProfilePage`) and `.results-actions`
  (Retake/Back on `ResultsPage`) switch `flex-direction: row` → `column` inside the new
  `@media (max-width: 40rem)` block, so each button gets a full-width tap target instead
  of being squeezed side-by-side.

## Topnav tightening at ≤40rem

- Reduce `.topnav` horizontal padding and `.topnav-brand` gap slightly inside the
  `@media (max-width: 40rem)` block.
- Verify in-browser at 360px width that brand text + sidebar toggle + theme toggle +
  account menu still fit without overlap or clipping; adjust the above values as needed
  to make that true. No markup changes anticipated.

## Out of scope / no changes expected

Auth, quiz, course-list, results, progress, and notfound pages: already single-column
with `max-width` + `padding: 0 1.25rem`, so they should reflow correctly as-is. These get
a visual spot-check at 360px / 768px / 1440px in Chrome devtools rather than speculative
new CSS. If the spot-check finds a real issue (e.g. a flex row that doesn't wrap), fix it
inline — but no such issue is assumed up front.

## Testing

This is CSS plus a mechanical `data-label` markup addition — no new testable logic.
Verification is visual:
- Run the dev server, check every page at phone (360px), tablet (768px), and desktop
  (1440px) widths.
- Confirm: no horizontal overflow anywhere, admin tables render as cards below 640px and
  as normal tables above it, two-button rows stack below 640px, topnav doesn't clip at
  360px.
- Existing component tests (`AdminUsersPage.test.tsx`, `AttemptsTable` coverage via that
  file, etc.) should keep passing unchanged, since `data-label` is an added attribute, not
  a structural change — but confirm no test asserts on `td` attributes/content in a way
  the addition would break.
