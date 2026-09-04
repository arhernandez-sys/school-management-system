# D41 — Editing a course offering, and telling Restore apart from Retire

**Status: complete (2026-08-27).** Branch `tertiary-refactor`.
Source: client ask, verbatim — *"for the course offerings add an edit button to modify
course offering. change the icon for the restore to a green icon so it looks different from
retire and restore. at the moment both are grey but have different icon."*

Two asks. The first turned up two latent server defects, both invisible until now because
**nothing had ever called `PATCH /offerings/{id}`** — `useOfferings.ts` carried a note
saying exactly that.

---

## What was asked, and where it landed

| # | Ask | Phase | Done |
|---|---|---|---|
| 1 | An Edit button on the course-offerings list | A | ✅ |
| 2 | Restore icon in green, distinct from Retire | B | ✅ |

---

## Phase A — Edit a course offering

- [x] `useUpdateOffering(offeringId)` — the hook the old NOTE said would be three lines
      once a screen rendered it. `DELETE /offerings/{id}` is still uncalled and still has
      no hook, for the same reason.
- [x] `OfferingFormDialog` gained an **edit mode** (`offering` + `onUpdate`). Same
      component, two modes, chosen by the props.
- [x] An **Edit** row action on `OfferingsListPage`, gated on `canWrite('offerings')`.
- [x] The dialog seeds from the **LIST ROW**, so opening it costs no request and cannot
      show a spinner over a form the user is already looking at.
- [x] **An Archived switch** — the only write path to `is_archived` anywhere in the app.
      The list has printed an Active/Archived badge since D31 and nothing could set it.

### What edit mode shows, and why it is not the create form

The server accepts different bodies for the two verbs, so the form does too:

| Field | Create | Edit | Why |
|---|---|---|---|
| Course · Session | editable | **read-only** | The offering's IDENTITY. `OfferingUpdateRequest` does not accept them. |
| Section code · Capacity | editable | editable | The only two mutable attributes. |
| Archived | — | editable | Owned by this endpoint. |
| Lecturers · Weekly schedule | editable | **not shown** | Their own endpoints (`PUT .../teachers`, `PUT .../meetings`) and their own UI on the offering itself. |

Rendering the create form's other fields in edit mode and dropping them on save would be
the worse lie: the Dean changes the lecturer, presses Save, and watches it revert. An
`Alert` at the top of the edit form says all of this once, rather than leaving it to be
discovered on two disabled controls.

---

## Phase B — Restore is green

- [x] `color="success"` on the Restore `IconButton` in **`CoursesPage`** and
      **`ProgramsScreen`** — the two screens that have the pair.
- [x] Retire stays neutral. It is reversible, and red is reserved for Delete, which is not.

The two sat side by side in the same default grey, distinguished only by
Archive/Unarchive — the same box with the arrow flipped. At 20px, in a row of icon
buttons, that is not a difference anyone reads before clicking. Green is what this app
already uses for an active/positive state (`StatusBadge kind="success"`).

---

## Findings worth carrying forward

**(a) ARCHIVING AN OFFERING WAS A ONE-WAY DOOR.** `_assert_year_writable` rejects a write
when the offering is archived *or* its year is — and it runs before the payload is read.
So the PATCH that would clear `is_archived` was refused **because `is_archived` was set**.
An offering archived by mistake could not be restored by any route in the system. The
Archived switch would have shipped a trap: flip it on, and the offering is gone from every
picker for good.

Fixed with `allow_archived_offering=True` on the one caller that owns the flag. The
archived-YEAR check is deliberately *not* exempted — a closed year is a school-wide
close-out, and restoring an offering inside one is still a write into a sealed year.

**(b) An explicit `null` meant "leave alone", so neither nullable field could be cleared.**
`if payload.capacity is not None` cannot tell an omitted key from an explicit null, and
both of this endpoint's nullable fields are ones the form can legitimately clear —
`capacity = null` is *no limit* (not 0, and the state a new offering starts in),
`section_code = null` is *the only section* (what the unique index's `COALESCE` is built
around). A Dean would blank the field, get a 200, and watch the old value come back.
`model_fields_set` now separates them, the same arm `update_student` already used.

**(c) The MSW mock was RIGHT and the server was wrong — on both counts.** The mock used
`body.x !== undefined` and never applied its archived-offering guard to PATCH. So demo mode
would have certified a screen the real API silently refused, which is the reverse of the
usual asymmetry and the reason both fixes are pinned server-side. The mock did lack the
archived-YEAR guard, which was added so the two now agree in both directions.

**(d) `archive_seeded_active_year` does not stamp `archived_at`.** The fixture flips
`status` and deactivates the term; `_assert_year_writable` reads `archived_at`, which the
real `archive_year` endpoint sets alongside. A test using the fixture alone would have
passed against no guard at all — so the archived-year test stamps it explicitly. Worth
remembering for any future test of a year-archived guard.

**(e) The Edit button is gated on `canWrite`, not `actionable_by_caller`.** That flag is
the LECTURER's write scope — their own offerings' rosters and grades — and a lecturer
editing the capacity or archive state of a course they happen to teach is a different
permission the server does not grant. Pinned by a 403 test.

---

## Verification

* Backend **1763 green** (was 1746) — `tests/test_d41_offering_update.py` adds 17: the
  one-way-door regression, explicit-null clearing on both fields, absence-means-leave-alone,
  the archived-year exemption boundary, section-code collisions (including *clearing onto*
  an existing blank section), identity fields rejected with 422, and the role gate.
* Frontend `tsc -b --force` clean; `eslint src` clean (2 pre-existing warnings, untouched
  files).
* **Executed, not merely typechecked** — the MSW offerings handler run out-of-Vite:
  rename → the server-computed `label` follows (`MATH1110-77`), `capacity: null` clears,
  `section_code: null` clears and drops the section from the label, omitted fields stay
  put, archive → **restore** round-trips, an archived offering is still editable, a
  duplicate section is 409 `duplicate_offering`, and a lecturer gets 403.
  *(That last check first reported a false PASS against the wrong session-cookie name —
  `sessionRole` defaults to `principal`, so the probe was silently running as the Dean.
  The same trap D33's probe hit. It is `sis_mock_session`, and it has to travel as a real
  `Cookie` header.)*
