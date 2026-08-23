# D37 — Gender & School Year as Dropdowns

> **Working record.** Successor to D36. The ask was two dropdowns; auditing the live data
> first turned up drift that the dropdowns would have exposed, so this fixes both.

---

## STATUS

| | |
|---|---|
| **Status** | 🟢 **D37 COMPLETE** — 2026-08-23 |
| **Branch** | `tertiary-refactor` |
| **Migration** | **none.** Both columns stay free text — see §B |
| **Live data** | **2 rows folded** (`student_profiles` and `applications` each held one `'Male'`) |
| **Backend suite** | **1,633 green** (1,606 + 27 new) |
| **Frontend** | `tsc -b --force` clean; `eslint` 0 errors / 2 pre-existing warnings; `probe_d33.mjs` **100/100** |

### What was asked

> "make gender a dropdown and also school year"

Both were free-text `TextField`s on the **admissions application wizard**. Gender was
already a dropdown on `StudentFormDialog`; school year exists only on the application.

---

## §A — What the audit found first

Before writing anything, the live values:

| table | column | values |
|---|---|---|
| `student_profiles` | `gender` | `'female'` ×23, `'male'` ×22, **`'Male'` ×1** |
| `applications` | `gender` | **`'Male'` ×1** |
| `applications` | `school_year` | `'2026-2027'` ×1 |
| `academic_years` | `name` | `'2024-2025'`, `'2025-2026'` |

Two problems, both created by the free text:

1. **A capitalised `'Male'` on BOTH tables**, and `admissions.accept` copies the
   application's gender onto the new student **verbatim** — so accepting spreads it.
2. **The declared school year matches no academic year on file.** `school_year` is a free
   label distinct from `academic_year_id` (the real FK, set at acceptance), and nothing
   reconciles them.

### ⚠️ Why nothing had reported the gender drift — and how it beat my own fix

The collation is `utf8mb4_uca1400_ai_ci`, i.e. **case-insensitive**. So:

* `WHERE gender = 'male'` **matches** `'Male'` — the D32 directory filter kept working.
* `GROUP BY gender` **collapses** the two into one group and reports whichever it saw
  first. The obvious diagnostic query actively *hid* the drift: my first look reported a
  clean `'female'`/`'male'` split on `student_profiles` and blamed only `applications`.
* `UPDATE ... WHERE gender <> LOWER(gender)` **matched zero rows** for the same reason.

It took `GROUP BY HEX(gender)` to see it and `BINARY gender <> BINARY LOWER(gender)` to fix
it. Worth remembering on any case-sensitivity question against this database.

**The breakage was in the browser**, where comparisons are case-sensitive:

* `StudentFormDialog` — a `<select>` whose value is not among its options renders **blank**,
  and saving from a blank select **clears the field**. A student stored as `'Male'` would
  have had their gender silently wiped by an unrelated edit.
* `StudentProfileSummary` — `gender === 'female' ? 'Female' : 'Male'` labelled a stored
  `'Female'` as **"Male"**, and any other value as "Male" too.

---

## §B — The design: constrain the WRITE PATH, not the column

The columns stay `varchar` free text, carrying their original comment *"Free/lookup text;
not a fixed enum"*. Narrowing them to a DB enum would reject rows this system did not write,
and no migration can safely guess what an unseen value meant.

So:

* `app/common/enums.py::Gender` — the canonical pair, **lowercase** (45 of 47 live rows
  already were, and every JS comparison and the demo dataset assume it).
* `normalise_gender()` — folds `Male` / `FEMALE` / ` f ` / `Woman` onto the pair.
  **Deliberately permissive**: an unrecognised value passes through *unchanged* rather than
  422-ing. This runs on the admissions transcription path, and rejecting an unexpected
  spelling would stop a Registrar recording a real student over something cosmetic. The
  dropdowns keep new data clean; this is the net under them.
* Returns a **plain `str`, never the enum member** — `Gender` subclasses `str`, but from
  Python 3.11 `str(Gender.MALE)` is `'Gender.MALE'`, which would land in a `varchar` the
  moment anything stringified it. Pinned by a test.

Wired into all four write paths: student create, student update, application create,
application patch — **and the acceptance copy**, which is the one that spreads it.

---

## §C — School year

`schoolYearOptions(academicYearNames, current?)` in `shared/utils/schoolYears.ts`.

**Not simply "the academic years that exist."** An application is for a *future* intake, so
the year it names routinely will not exist as a row yet — which is exactly what the live
data shows (`2026-2027` while the active year is `2025-2026`). A strict list would block the
normal case: recording next year's applications before the Dean has created next year.

So the options are the years on file **plus the next three derived from the latest**, all in
one `YYYY-YYYY` format. That fixes the formatting drift without blocking a forward-dated
application. Two details that are load-bearing:

* **A held value is always included.** A `<select>` whose value is absent from its options
  renders blank and saving then clears the field, so opening an existing application must
  never drop the label it already has — even one predating everything on file.
* **A malformed label is not extrapolated.** `2024-2026` is not a school year; stepping it
  forward would invent data, so only labels whose halves are consecutive are walked.

---

## §D — What shipped

### Backend
- [x] `Gender` + `normalise_gender` in `app/common/enums.py`
- [x] Normalisation on student create / update, application create / patch, **and the
      acceptance copy onto `student_profiles`**
- [x] `tests/test_gender_vocabulary.py` — **27 passed**

### Frontend
- [x] `Gender`, `GENDERS`, `GENDER_LABEL`, `genderLabel`, `canonicalGender` in
      `shared/types/enums.ts` — one vocabulary, mirroring the server
- [x] `shared/utils/schoolYears.ts`
- [x] **Application wizard: Gender and School year are now selects**
- [x] Both selects carry a legacy value as its own `(as recorded)` option, so a value the
      dropdown does not offer cannot be silently wiped
- [x] `StudentProfileSummary` uses `genderLabel`, not the ternary
- [x] `StudentFormDialog` seeds via `canonicalGender`; state widened from the two-value
      union to `string`, because the union was a lie the column never enforced
- [x] `StudentFiltersDialog` reads the shared pair instead of hardcoding it
- [x] `StudentDetail.gender` / `StudentWritePayload.gender` widened to `string` — honest
      about a free-text column
- [x] Demo mode mirrored on create, patch and the acceptance copy. The old
      `app.gender === 'female' ? 'female' : 'male'` sent every unrecognised value —
      including a capitalised `'Female'` — to `'male'`

### Live data
- [x] Both stray rows folded to lowercase, verified **by bytes** (`HEX`), and a check that
      no row in either table is off the canonical pair

---

## §E — Verification

1. **Backend suite — 1,633 green.**
2. **`probe_d33.mjs` — 100/100.** Section 9 covers the vocabulary, `canonicalGender`,
   `genderLabel` (including the capitalised-`Female` case the old ternary got wrong), the
   school-year list (newest-first, future intakes, held values, no extrapolation of a
   malformed label), the demo write paths folding, and that no demo student is off the pair.
3. **Both guard tests were verified to FAIL without the fix.** Removing the acceptance
   normalisation makes `test_a_legacy_application_value_lands_CANONICAL_on_the_student` fail
   with `Male` — a guard that cannot fail proves nothing.
4. **Live data checked by bytes**, not by `GROUP BY` — see §A.

---

## §F — Open for the client

1. **Only two gender options are offered.** `normalise_gender` passes anything else through
   unchanged, so a value already on file survives and displays as stored — but the dropdowns
   cannot *enter* a third. If BAJC wants one (e.g. "Prefer not to say"), it is one entry in
   `Gender` plus one in the frontend `GENDERS`; no migration, because the columns are free
   text.
2. **`school_year` and `academic_year_id` are still two fields.** The dropdown stops the
   *format* drifting, but nothing yet asserts that the label agrees with the FK set at
   acceptance. Worth deciding whether `school_year` should simply be derived from
   `academic_year_id` and dropped as an input.
3. Carried over: the `programs` code sets disagree (D34 §F), and `educationbg_id` / `doc_id`
   remain inert.
