# What documentation should stay, and why

_My recommendation, applied on 10 September 2026. Read this first if you are wondering
where something went._

---

## Start here

| Document | Read it when |
|---|---|
| [`complete-work.md`](complete-work.md) | You want to know what has been built and why it is shaped that way |
| [`project-now.md`](project-now.md) | You want to know what the system IS today — stack, layout, how to run it |
| [`needs-attention.md`](needs-attention.md) | You want to know what is open and who owns it |
| [`../RUNBOOK.md`](../RUNBOOK.md) | You are setting up, deploying, or something is broken |
| [`cpanel-deployment.md`](cpanel-deployment.md) | You are deploying to **cPanel shared hosting** (Passenger). RUNBOOK §10 covers the VPS/nginx target instead |

These four replace `progress-tracker.md` and fifteen per-cycle plan documents.

---

## The reference set — kept, and worth keeping

These describe **what the system must do** rather than what was done to it, so they stay
useful as long as the system exists.

| Document | Why it stays |
|---|---|
| `requirements.md` | The functional requirements every feature is traced to. The contract |
| `api-specification.md` | The endpoint surface. Large, and the thing you check before adding a route |
| `database-schema.md` | Table-by-table reference. ⚠️ Still says Postgres in places — see below |
| `architecture.md` | How the layers fit. ⚠️ Same Postgres caveat |
| `ui-design-system.md` | Palette, type scale, component inventory, density stance. The redesign work leaned on §1.1–1.4 heavily |
| `roles-access-and-flows.md` | The permission matrix per module, and the flows each role walks |
| `bajc-blueprint-conformance.md` | Section-by-section §1–§77 conformance against the client's blueprint. **This is what you take to a meeting** |
| `testing-plan.md` | The testing strategy the 2,161 tests follow |
| `frontend-implementation.md` | Frontend conventions and module structure |

⚠️ **`database-schema.md` and `architecture.md` predate the MariaDB pivot** and still
mention Postgres/Supabase in places. They are accurate about *structure* and stale about
*engine*. Worth a pass; not urgent, and not worth deleting over.

---

## Deleted, and where it went

| Deleted | Where the content is now |
|---|---|
| `progress-tracker.md` (195kb) | [`complete-work.md`](complete-work.md) — the work; [`needs-attention.md`](needs-attention.md) — the open items |
| `d33`…`d44` plan docs (11 files) | Summarised in `complete-work.md` §5 |
| `d45-meeting4-yellow-plan.md` (112kb) | `complete-work.md` §5, and every open question in `needs-attention.md` |
| `tertiary-refactor-plan.md`, `tertiary-offerings-refactor-plan.md` (231kb) | `complete-work.md` §2 — the two structural refactors |
| `midterm-revision-reports-plan.md` | `complete-work.md` §3 |
| `project-overview.md` | Folded into `project-now.md` |
| `security-review.md` | A 151-byte stub that had never been written. Recorded as a gap in `needs-attention.md` |

**Nothing is really gone.** Everything above is in git history, and the whole cycle was
committed before the clean-up (`58c2803`, `b1ede94`). To read a deleted document:

```bash
git show 58c2803:docs/d45-meeting4-yellow-plan.md | less
git log --oneline --all -- docs/tertiary-refactor-plan.md
```

---

## What I would keep doing

**Write the reasoning down where the code is.** The most valuable documentation in this
project is not in `docs/` — it is the docstrings. `offerings/models.py` explains why
`classes` became `course_offerings`; `audit/narrative.py` explains why an auditor never
sees a table name; `institutional.py` explains why a failure rate's denominator is
resolved grades and not enrolments. Those survive refactors, get read at the moment they
matter, and cannot drift from the code the way a separate document can.

**One plan document per client cycle, deleted when the cycle closes.** The pattern worked
— each cycle had a document that tracked contradictions, decisions and phases, and it was
genuinely useful *while the cycle was open*. What it was not useful for was the twelve
cycles that had already closed. Keep writing them; fold them into `complete-work.md` and
delete them when the cycle ends.

**Keep `bajc-blueprint-conformance.md` current.** It is the only document that answers
"have we built what the client asked for", section by section, and it is the one to open
in front of them.
