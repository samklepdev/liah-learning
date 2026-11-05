# Profile Page — Combined Name + Password Edit — Design

**Date:** 2026-11-05
**Status:** Approved

## Goal

Replace ProfilePage's two always-visible, always-editable forms (name, password)
with a single read-only display plus one "Edit profile" toggle. In edit mode, both
name and password can be changed together and saved with one "Save profile" button.

## Scope

**In:** read-only display of first/last name, email, role; an "Edit profile" toggle;
a combined edit form (name + password fields); one "Save profile" action that calls
both existing endpoints as needed; a "Cancel" action that discards unsaved edits.

**Out:** any backend changes — `PATCH /api/auth/name` and `PATCH /api/auth/password`
are reused as-is, called independently from one save handler. No new combined
backend endpoint.

## Read-only view (default)

```
Profile
  First name: <value or "—">
  Last name:  <value or "—">
  Email:      <value>
  Role:       <value>              (admin only, as today)

  [Edit profile]
```

- `dl` with one `<dt>`/`<dd>` pair per field, matching the existing `profile-details`
  pattern. Empty `firstName`/`lastName` render as `—`.
- A single "Edit profile" button switches `isEditing` to `true`.

## Edit mode

```
Profile
  [First name input] [Last name input]
  [Current password input] [New password input]
  (hint: at least 8 characters)

  [Save profile] [Cancel]
```

- One form. Name inputs pre-filled from `user.firstName`/`user.lastName` (empty
  string if null). Password inputs always start empty.
- Password fields are optional: leaving both blank skips the password change
  entirely. Filling in only one is a validation error.
- `Cancel` resets name inputs back to the current user's values, clears password
  inputs and any error/success state, and exits edit mode — no network calls.

## Save behavior

On submit:

1. **Pre-validate:** if exactly one of current/new password is filled, show
   "Enter both current and new password to change it, or leave both blank." and
   stop — no API calls made.
2. **Name:** always call `authApi.updateName(firstName, lastName)` (cheap/idempotent
   if unchanged; mirrors today's behavior where the name form is always submittable).
3. **Password:** call `authApi.changePassword(currentPassword, newPassword)` only if
   both fields are filled.
4. Fire the name call and (if attempted) the password call concurrently — one
   failing must not block or skip the other. Track each outcome independently (no
   rollback — these are two separate backend resources):
   - **Both succeed, or password wasn't attempted:** call `updateUser(...)` with the
     name response, exit edit mode, show a brief "Profile updated." message on the
     read-only view.
   - **Name succeeds, password fails (or vice versa):** apply whichever update
     succeeded (`updateUser(...)` if it was the name), stay in edit mode, show the
     failing call's error next to its own fields, leave the user's typed values in
     place so they can retry just the part that failed.
   - **Both fail:** stay in edit mode, show both errors next to their respective
     fields.
5. While a save is in flight, disable both buttons and show a busy state (`aria-busy`,
   "Working…" on Save profile), same convention as today's forms.

## Component shape

Single `ProfilePage` component, one `isEditing` boolean plus the existing
`firstName`/`lastName`/`currentPassword`/`newPassword`/error/success/submitting
state (consolidated into fewer, clearly-named pieces — e.g. one `error`/`success`
pair for the name/profile-level outcome, one for the password outcome, since they
can now fail independently in the same submit). No new files; this stays scoped to
`ProfilePage.tsx`.

## Testing

Rewrite `ProfilePage.test.tsx` for the new flow:
- Read-only view renders first/last name (and "—" when null).
- Clicking "Edit profile" reveals the form with name pre-filled.
- Saving with only the name changed: calls `updateName`, not `changePassword`;
  exits to read-only view.
- Saving with both name and password filled in: calls both APIs; exits to read-only
  view on success.
- Only one password field filled: shows the validation error, calls neither API.
- Password call fails (e.g. wrong current password): name change still applied
  (`updateUser` called), edit mode stays open, password error shown.
- Cancel: discards edits, calls no APIs, returns to read-only view showing the
  original values.
