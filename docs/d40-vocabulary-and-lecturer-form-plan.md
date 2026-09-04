# D40 — Religion from the table, civil status as a vocabulary, and the lecturer form as a page

**Status: complete (2026-08-27).** Branch `tertiary-refactor`.
Source: client ask, verbatim — *"go to the student list for the filter, pull from the
religion table in the religion field, and create a dropdown for civil status … check all
where civil status is and change to dropdown (single, married, divorced, widow(er)). And in
the add lecturer make it so it adds all the other fields — right now it is just some info —
make it like the application UI that takes the whole module space."*

Three asks, and the third turned out not to be a UI-only change.

---

## What was asked, and where it landed

| # | Ask | Phase | Done |
|---|---|---|---|
| 1 | Student-list Religion filter reads the `religions` table | A | ✅ |
| 2 | Civil status becomes a dropdown everywhere it was free text | B | ✅ |
| 3 | A civil-status filter on the student list | B | ✅ |
| 4 | Add lecturer captures every field, as a full-module page | C | ✅ |

---

## Phase A — the Religion filter reads the vocabulary, not the register

- [x] `StudentsListPage` builds the Religion options from **`useReligions()`** — the
      client-owned `religions` table D39 added, and the same list the student and
      application forms already write from.
- [x] The **DISCOVERED list is merged in behind it**, and this is the part that must not
      be dropped. `student_profiles.religion` is free text and stays so (D37), so a student
      imported from the client's previous system holds a religion the table has never
      carried. Without the merge they are visible in the table's Religion column and
      unreachable by the filter beside it. Verified against the demo dataset: the table
      holds `Catholic` and `Seventh Day Adventist`, the register also holds `Adventist`,
      `Anglican` and `Methodist`, and every one of the five is offered.
- [x] `GET /students/filter-options` keeps returning the discovered religions — it is no
      longer the dropdown's *source*, it is its *residue*.

**Why it was wrong before.** The options were `SELECT DISTINCT religion`, so the Dean could
not filter by a religion nobody had been recorded with yet. "Show me the Methodist students"
had no option to click, which reads as the filter being broken rather than the answer being
zero.

---

## Phase B — civil status becomes a vocabulary

No migration. The columns stay `varchar(50)` free text, exactly as D37 settled for `gender`:
narrowing them to a DB enum would reject historical rows this system did not write, and no
migration can safely guess what a value it has never seen was meant to be. **The write path
is what is constrained.**

- [x] `app/common/enums.py::CivilStatus` — `Single` · `Married` · `Divorced` · `Widow(er)`,
      plus `_CIVIL_STATUS_ALIASES` and `normalise_civil_status`, modelled line for line on
      `Gender` / `normalise_gender`.
- [x] **TitleCase**, unlike `Gender`, because that is what the live dump already holds
      (`student_profiles.civil_status = 'Single'`). Matching the data beats matching the
      other enum's style.
- [x] `Widow(er)` keeps its parenthetical because the client's paper form does. It is one
      status, not two.
- [x] Wired into every write path `gender` is: student create, student update, application
      create, application patch, pending-application patch, **and the acceptance copy**.
- [x] Frontend mirror in `shared/types/enums.ts`: `CIVIL_STATUSES`, `canonicalCivilStatus`,
      `civilStatusOptions`, `normaliseCivilStatus` (the last for demo mode).
- [x] `StudentFormDialog` and `ApplicationWizardScreen`: `TextField` → `TextField select`.
      Both carry a stored value the list does not offer as an **"(as recorded)"** option.
- [x] New `civil_status` query param on `GET /students`, exact-match, plus a
      **Civil status column** on the directory — D38's rule: filtering by something the
      table does not show leaves the result unverifiable.
- [x] `civil_statuses` added to `GET /students/filter-options`, so a legacy value stays
      selectable.

---

## Phase C — the lecturer form is a page, and it captures everything

- [x] New `features/teachers/screens/TeacherFormScreen.tsx` at **`/teachers/new`** and
      **`/teachers/:teacherId/edit`**. Sectioned single page (Identity · Contact ·
      Employment · Profile · Subject expertise · Login), `PageContainer` + `PageHeader` +
      one `Paper`, saved once at the bottom.
- [x] `TeacherFormDialog` **deleted**, not merely unlinked. `TeachersListPage`'s *Add
      Lecturer* and `TeacherProfileView`'s *Edit* both navigate.
- [x] `TeacherCreateRequest` gained `gender`, `bio` and `expertise`; `create_teacher`
      writes them; the MSW create handler mirrors it (including the licence pattern).
- [x] Sections, not a Stepper. The application form is seven steps because it is seven
      numbered sections of a legal document. A lecturer is ~20 fields and fits on a page;
      splitting it would add four clicks and a Back button for nothing.

---

## Findings worth carrying forward

**(a) `POST /teachers` could not carry the fields the form now shows, and it 422'd rather
than dropping them.** `TeacherCreateRequest` sets `extra="forbid"`, so `gender`, `bio` and
`expertise` were not silently ignored — a create body carrying any of them was rejected
outright. The dialog hid this by gating those fields behind `editing`, which is why the
symptom presented as "add lecturer only asks for some info" rather than as an error. This is
the reason Phase C is a backend change and not just a screen.

**(b) The create/edit split was the real defect, not the modal.** Create showed six fields
and edit showed twenty, so the Dean added a lecturer and then reopened the record they had
just made to type the hire date, licence number and qualification they were holding in their
hand. One screen for both modes is what stops the two from disagreeing about which fields a
lecturer record even has.

**(c) Executing the vocabulary helpers found a disagreement a typecheck could not.**
`canonicalCivilStatus('widower')` returned `null` while the server's normaliser folds it to
`Widow(er)` — one value that the form would have shown as *"widower (as recorded)"* beside
the real `Widow(er)` option, in the one control whose job is to make sure it is one value.
Both now share a single alias table, and a test asserts the two tables are identical entry
for entry.

**(d) The blank-`<select>` trap is the same one D37 found on `gender`, on the column beside
it.** MariaDB's `utf8mb4_uca1400_ai_ci` cannot tell `'single'` from `'Single'`, so no
`GROUP BY` or `<>` will reveal the drift — but the browser compares case-sensitively, a
value that matches no option renders BLANK, and **saving an unrelated edit from a blank
select writes NULL over a real civil status.** Both forms canonicalise on load, and a
genuinely unknown value ('Common law') is carried as its own option rather than dropped.

**(e) An unrecognised civil status is never rejected.** `normalise_civil_status` passes it
through unchanged, like `normalise_gender`. This runs on the admissions transcription path,
and turning an unexpected spelling into a 422 would stop a Registrar recording a real
student over something cosmetic. The dropdowns keep new data clean; the normaliser is the
safety net under them.

**(f) The filter had to match the STUDENT, not their enrolment** — the trap
`academic_year_id` and `religion` both already record. A graduated student holds no active
enrolment, so filtering through one would quietly empty the view. Pinned by a test.

---

## Verification

* Backend **1746 green** (was 1714) — `tests/test_d40_civil_status_and_lecturer_create.py`
  adds 32, covering the normaliser, the four student write paths, the acceptance copy, the
  directory filter, `filter-options`, and the full lecturer create round-trip.
* Frontend `tsc -b --force` clean; `eslint src` clean (2 pre-existing warnings, untouched
  files).
* **Executed, not merely typechecked** (`vite` cannot run here — esbuild is blocked by
  policy):
  * the vocabulary helpers compiled to CJS and run — alias-table parity with the server
    proven, and the select shown to be non-blank for every input including `null`;
  * the demo selectors run — `civil_status` partitions the 45 demo students exactly
    (27 Single + 9 Married + 9 unset), ANDs with `gender`, and returns 0 (not everything)
    for an unknown value;
  * the **MSW handlers themselves** run out-of-Vite — `POST /teachers` persists all
    thirteen new fields, trims, drops a blank expertise row and 422s a bad licence;
    `GET /students` filters; create/patch fold `'  married '` and `'widower'`.
