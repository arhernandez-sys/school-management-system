# D35 — `coursestatus`: Audit & Withdrawal

> **Working record.** Successor to D34 (`docs/d34-client-schema-reconcile-plan.md`).
> The short version: **no migration was needed.** The column already existed and had never
> been used by anything.

---

## STATUS

| | |
|---|---|
| **Status** | 🟢 **D35 COMPLETE** — 2026-08-23 |
| **Branch** | `tertiary-refactor` (continues from D34) |
| **Migration** | **none** — `class_enrollments.enrollment_status` has existed since `005_tertiary.sql` §8 with all four values |
| **Backend suite** | **1595 green** (1566 + 29 new) |
| **Frontend** | `tsc -b --force` clean; `eslint` 0 errors / 2 pre-existing warnings; `probe_d33.mjs` **77/77** |

### What was asked

> "add coursestatus the school said they wanted that"

D34 had flagged that the client's `courses.coursestatus`
(`Audit` / `Withdraw Passing` / `Withdraw Failing`) describes an **enrolment**, not a
catalog row. The school confirmed they want the capability, so it is built where it works.

---

## §A — What was actually there

`class_enrollments.enrollment_status` already existed, with exactly the values the client
asked for plus the normal case:

```
enum('enrolled','audit','withdraw_passing','withdraw_failing')
```

`005_tertiary.sql` §8 moved it off `courses.coursestatus` for the reason D34 gave — on the
catalog, marking one student as auditing would have marked **everyone** taking the course —
and added `enrolled`, which the client's enum lacked despite being the normal case.

**But it was mapped and nothing else.** Verified by grep before writing any code:

* no endpoint set it (`POST /offerings/{id}/enrollments` did not accept it),
* no calculation read it (`academics.py`, `reports/service.py`, `calc.py` — none),
* no test mentioned it,
* the frontend did not know it existed,
* **all 393 live rows said `enrolled`.**

The same write-only trap D32 found on `report_card_snapshots.storage_key`. So D35 is not
"add a column", it is "make the column real", and the work is almost entirely in the
consequences.

---

## §B — The defect this would have shipped

`academics.py::_enrolled_course_ids` returned `{course_id: semester_id}` — no status. So a
course the student **audited or withdrew from** was indistinguishable from one they were
still taking. `academic_history` filed it as `in_progress`, which meant:

* it stayed `in_progress` **permanently**, since no grade would ever arrive; and
* its credits went into the **GPA denominator with zero quality points**.

The effect is a **silently depressed GPA that no screen could explain**, and it would have
appeared the first time anyone used the feature. The bucket now carries the status, and both
`audited` and `withdrawn` are excluded from the GPA on *both* sides of the fraction — the
same argument the pre-existing `transferred` bucket already makes for transfer credit.

### A second hole, found by a test I wrote for the happy path

The first cut checked the status only in the `elif course_id in enrolled:` branch — i.e.
**after** the result branch. So a course that was **graded and then audited** still earned
credit and still entered the GPA, because `elif result is not None:` won first.

`test_an_audit_earns_no_credit` grades the course before auditing it, and caught it. The
rule is now explicit and ordered:

```
transferred  >  audit / withdrawn  >  result  >  enrolled  >  remaining
```

**The course status outranks the result**, and it has to: the gradebook does not know about
course status, so a lecturer can mark an auditing student, and a withdrawal recorded after
grades went in is entirely ordinary.

---

## §C — What shipped

### Write path
- [x] `RosterEntry.enrollment_status` — the roster is where a Registrar sees it
- [x] `EnrollRequest.enrollment_status`, defaulting to `enrolled` so every pre-D35 caller is
      unchanged. Applies to the whole batch, which is what an audit cohort looks like
- [x] **`PATCH /offerings/{id}/enrollments/{enrollment_id}`** — new, Dean/Registrar only,
      returns the updated `RosterEntry`. `409 enrollment_closed` on an un-enrolled row
- [x] Audited with before/after and the reason. The reason is **only** on the audit row —
      `class_enrollments` has no column for it, and inventing one to hold free text nothing
      reads would be worse

### The distinction that drove the design
**`PATCH` is not `DELETE`.**

| | what it means | the row |
|---|---|---|
| `DELETE` | the registration was a mistake | closed (`unenrolled_at`), off the roster |
| `PATCH` → `withdraw_*` | they **sat** the course and left | **stays open, stays on the roster** |

A withdrawal has to keep the row because **the transcript prints `W/P` / `W/F` against the
course**. Deleting it would erase the very thing being recorded.

- [x] The UI action formerly labelled **"Withdraw"** is now **"Remove"**. It was the
      `DELETE`, and "withdraw" is now the name of the other thing — two actions sharing one
      word on the same screen is how the wrong one gets clicked

### Arithmetic
- [x] `academics.py` — `audited` and `withdrawn` buckets; no credit; out of the GPA on both
      sides; the precedence above
- [x] `AcademicHistoryCounts` gained both keys. **Required, not cosmetic**: a key the
      service counts but the schema does not declare is dropped by pydantic on
      serialisation, so the UI would show a total that did not add up
- [x] `_WITHDRAWN` documents the one judgment call — see §F

### Transcript
- [x] `TranscriptSubjectRow.notation` — `AU` / `W/P` / `W/F`
- [x] `get_transcript` prints the notated row **and skips the graded-only filter for it**.
      Without that the course vanished from the transcript entirely, which is the opposite
      of what recording the status is for
- [x] Excluded from the term average and from the GPA via the existing
      `_gpa_entries(exclude_cs_ids=...)` hook

### Frontend
- [x] `CourseStatusDialog` — spells out the consequence of each option, because "audit" and
      "withdrew" both silently change a student's credits and GPA and a Registrar should not
      have to know the arithmetic to predict that
- [x] Roster status column shows it (audit reads `info`, a withdrawal `warning`)
- [x] `AcademicHistoryPanel` renders both new buckets with their hints
- [x] `TranscriptDocument` prints the notation in the grade column
- [x] Demo mode mirrored: the enrolment shape, the seed (one of each status, deliberately
      **not** on the two scenario students whose GPAs the demo walks through), the PATCH
      handler with the same 409, the academic-history precedence, and the transcript notation

### Tests
- [x] `tests/test_course_status.py` — **29 passed**, in four groups: it is settable; a
      withdrawal is not an un-enrolment; it changes the arithmetic; the transcript prints it

---

## §D — Verification

1. **Backend suite — 1595 green** (was 1566).
2. **`probe_d33.mjs` — 77/77**, driving the real MSW handlers. Section 8 is new: the roster
   carries it, every value settable, a Lecturer refused, an unknown value refused, a
   withdrawn student stays on the roster with the row open, the `audited`/`withdrawn`
   buckets, **credits leaving the GPA denominator (12 → 0)**, and the transcript printing
   `W/F` with no numeric or letter.
3. **`check_msw_routes.mjs`** — it caught the new PATCH as a ghost route until
   `openapi.json` was regenerated. 0 ghosts now.
4. **Two probe assertions were wrong**, not the code: they counted **enrolments** where the
   academic-history buckets are per **COURSE** (the same course sat in two terms is one
   course — 10 enrolments, 4 distinct courses). Corrected to count distinct courses.

---

## §F — Open for the client

1. **Does a `W/F` count as an F in the GPA?** This system says **no** — a withdrawal is
   excluded entirely, on the same principle as transfer credit: a number nobody at BAJC
   awarded should not enter the average. **Some institutions score W/F as 0.00**, which
   pulls the GPA down, and that is a real policy difference BAJC should confirm. Flipping it
   is a one-line change at `_WITHDRAWN` in `students/academics.py` plus a `GpaEntry` with
   `grade_point=0`.
2. **A grade already entered is not erased by a withdrawal.** The mark stays in the
   gradebook and stops counting; it does not print on the transcript, where the notation
   replaces it. That is the conservative reading — nothing is destroyed — but if BAJC wants
   the mark cleared on withdrawal, say so, because that is not reversible.
3. **`courses.coursestatus` itself was NOT added to the catalog.** It is an enrolment fact;
   putting it back on `courses` would mean one student auditing marks the whole class.
   §A explains why, and `005_tertiary.sql` §8 made the same call.
4. **Carried over from D34 and still open:** the `programs` code sets disagree
   (`BAG/ASM/ASB/…` vs live `AGRI/BIOL/BMAD/…`), and `educationbg_id` / `doc_id` remain
   inert.
