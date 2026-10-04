"""Programmes / studies and their curriculum (D30 §D3, plan §A1).

The eight BAJC Associate-degree programmes, and — in `program_courses` — the course
sequence each one prescribes. Before D30 neither existed in any usable form:
`programs` and `courses` had **no relationship at all**, so the whole structure of the
institution's course-sequence PDF had nowhere to live.

Unlike `Subject` (which lives in `classes/models.py` for historical reasons), the
models here live in this slice: nothing else owns them, and `program_courses` is
meaningless outside it.
"""
