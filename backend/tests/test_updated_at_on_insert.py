"""D39 / `015` — a newly created row leaves `updated_at` EMPTY.

`updated_at` answers "when was this EDITED", and a record nobody has edited has no
answer. Before `015` the column was `NOT NULL DEFAULT current_timestamp()` on 37 tables,
so an INSERT that never mentioned it still got the creation instant — and the UI reported
"Last updated <creation date>" on records nobody had touched. It also disagreed with
`updated_by`, which has always been NULLable and which no insert sets: one half of the
same fact said "never edited" while the other gave a date.

**Why this file exists rather than an assertion bolted onto an existing suite.** The old
behaviour came from a column DEFAULT, not from application code, so nothing in Python
mentioned it and nothing could pin it. The rule now lives in three places that can drift
apart — the mixin, the 36 converted columns, and the readers that must coalesce — so each
is tested here directly.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import inspect, select, text

# `app.db.models` is the AGGREGATOR that imports all 28 ORM models. Importing it is not
# optional housekeeping here: without it `Base.metadata.tables` holds only the handful of
# tables this module happens to import, and `test_every_updated_at_is_nullable_in_the_orm`
# would sweep three tables and pass vacuously while thirty-three went unchecked.
import app.db.models  # noqa: F401
from app.db.base import Base
from app.modules.offerings.models import Course
from app.modules.settings.models import AcademicYear

pytestmark = pytest.mark.requires_db


class TestTheModel:
    def test_the_mixin_declares_updated_at_nullable(self) -> None:
        """The ORM half. A NOT NULL mapping would make SQLAlchemy send the column."""
        col = Course.__table__.c.updated_at
        assert col.nullable is True
        # The default is what stamped it on insert; `onupdate` is what still stamps a
        # real edit and must survive.
        assert col.server_default is None
        assert col.default is None
        assert col.onupdate is not None

    def test_created_at_is_untouched(self) -> None:
        """Only `updated_at` changed. `created_at` must stay NOT NULL with its default —
        every fallback added for this change reads it, so a null there breaks them all."""
        col = Course.__table__.c.created_at
        assert col.nullable is False
        assert col.server_default is not None


class TestInsertLeavesItEmpty:
    def test_a_new_course_has_no_updated_at(self, db_session) -> None:
        c = Course(name=f"Probe {uuid.uuid4().hex[:6]}", code=f"P{uuid.uuid4().hex[:6]}")
        db_session.add(c)
        db_session.commit()
        db_session.refresh(c)
        assert c.created_at is not None
        assert c.updated_at is None
        # The pair now agrees: nobody has edited this, by nobody, at no time.
        assert c.updated_by is None

    def test_an_edit_stamps_it(self, db_session) -> None:
        c = Course(name=f"Probe {uuid.uuid4().hex[:6]}", code=f"P{uuid.uuid4().hex[:6]}")
        db_session.add(c)
        db_session.commit()
        assert c.updated_at is None

        c.name = f"Edited {uuid.uuid4().hex[:6]}"
        db_session.commit()
        db_session.refresh(c)
        assert c.updated_at is not None, "an actual edit must still stamp it"
        assert c.updated_at >= c.created_at

    def test_a_raw_sql_insert_also_leaves_it_empty(self, db_session) -> None:
        """The column DEFAULT, not the ORM, is what used to stamp it — so the fix has to
        hold for a hand-run INSERT too. The chain writes SQL by hand often."""
        year_name = f"probe-{uuid.uuid4().hex[:8]}"
        db_session.execute(
            text(
                "INSERT INTO academic_years (id, name, start_date, end_date, status, "
                # 'archived', not 'active': `uq_academic_years_one_active` permits
                # exactly one active year and the seeded one already holds it.
                "created_at) VALUES (:id, :name, '2030-09-01', '2031-06-30', 'archived', "
                "now())"
            ),
            {"id": str(uuid.uuid4()), "name": year_name},
        )
        db_session.commit()
        row = db_session.scalar(select(AcademicYear).where(AcademicYear.name == year_name))
        assert row is not None
        assert row.updated_at is None

    def test_a_raw_sql_update_still_stamps_it(self, db_session) -> None:
        """MariaDB's own `ON UPDATE current_timestamp()` is kept as the backstop behind
        SQLAlchemy's `onupdate`, precisely so a hand-run fix does not go unrecorded."""
        year_name = f"probe-{uuid.uuid4().hex[:8]}"
        db_session.execute(
            text(
                "INSERT INTO academic_years (id, name, start_date, end_date, status, "
                # 'archived', not 'active': `uq_academic_years_one_active` permits
                # exactly one active year and the seeded one already holds it.
                "created_at) VALUES (:id, :name, '2030-09-01', '2031-06-30', 'archived', "
                "now())"
            ),
            {"id": str(uuid.uuid4()), "name": year_name},
        )
        db_session.commit()
        db_session.execute(
            text("UPDATE academic_years SET name = CONCAT(name, '-edited') "
                 "WHERE name = :name"),
            {"name": year_name},
        )
        db_session.commit()
        stamped = db_session.scalar(
            text("SELECT updated_at FROM academic_years WHERE name = :name").bindparams(
                name=f"{year_name}-edited"
            )
        )
        assert stamped is not None


class TestTheWholeSchemaWasConverted:
    """One column left NOT NULL is one table that silently keeps the old behaviour."""

    #: The deliberate exceptions, and they are the same exception twice. A COUNTER is not
    #: a record: its only purpose is to be UPDATEd to hand out the next number, so its
    #: `updated_at` means "when was a number last issued" — real information about a row
    #: that is only ever written by being updated. The 015 convention (NULL until edited)
    #: says nothing useful about a row like that.
    #:
    #: `number_sequences` is D44's generalisation of `student_number_sequences` and
    #: inherits the exemption for the identical reason. The old table is still on disk
    #: holding pre-D44 provenance, so both are listed.
    EXEMPT = {"student_number_sequences", "number_sequences"}

    def test_every_updated_at_is_nullable_in_the_orm(self) -> None:
        offenders = sorted(
            t.name
            for t in Base.metadata.tables.values()
            if "updated_at" in t.c
            and not t.c.updated_at.nullable
            and t.name not in self.EXEMPT
        )
        assert offenders == [], f"still NOT NULL in the ORM: {offenders}"

    def test_every_updated_at_is_nullable_in_the_database(self, db_session) -> None:
        """Against the real `sims`, because the ORM and the database are maintained
        separately here — Alembic is not the migration path, so a model can say nullable
        while the column a hand-run migration created is not."""
        rows = db_session.execute(
            text(
                "SELECT TABLE_NAME FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'updated_at' "
                "AND IS_NULLABLE = 'NO' ORDER BY TABLE_NAME"
            )
        ).scalars().all()
        offenders = sorted(set(rows) - self.EXEMPT)
        assert offenders == [], f"still NOT NULL in the database: {offenders}"

    def test_the_counter_table_is_still_not_null(self, db_session) -> None:
        """Pinned so the exemption is a decision someone has to undo on purpose.

        D44 — checks the LIVE counter table (`number_sequences`) as well as the retired
        one. Pinning only `student_number_sequences` would have kept passing forever
        against a table nothing writes to any more, which is a pin that has stopped
        holding anything down."""
        insp = inspect(db_session.get_bind())
        for table in ("student_number_sequences", "number_sequences"):
            cols = {c["name"]: c for c in insp.get_columns(table)}
            assert cols["updated_at"]["nullable"] is False, table
