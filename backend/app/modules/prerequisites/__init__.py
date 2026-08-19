"""Course prerequisites and the enrolment gate (D30 §D4, brief §17).

Before D30 a prerequisite was `courses.prerequisites varchar(50)` — free text, with
no FK, unqueryable, and too short to hold the real values. `AGRI2118 ← AGRI1108,
AGRI1109` fitted; `EDUC2305 ← EDUC1210, 2226, 2228, 2330, 2334, 2336` did not, and
`EDUC3201 ← ALL COURSES` could not be expressed at all.

`course_prerequisites` is the real relation. `courses.prerequisites_text` survives as
the human-readable source from the PDF, but **validation reads the relation** — the
text is documentation, never a rule.

THE RULE THIS ENFORCES: a prerequisite is satisfied only by SUCCESSFUL COMPLETION,
judged against the PROGRAMME's pass mark. Having sat the course is never enough, and
sitting it in the same term as the course it gates is never enough either.
"""
