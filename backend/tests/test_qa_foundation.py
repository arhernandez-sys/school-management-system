"""Guards on the TEST HARNESS itself (Phase 8 — QA foundation).

Everything else in `tests/` asserts on the application. This file asserts on the
scaffolding, because Phase 8 made the harness meaningfully faster (~18 min → ~2 min)
and each of those speedups is a trade that could silently turn into a real defect:

  1. Argon2id runs at a REDUCED work factor inside the suite. If that reduction ever
     leaked into the production defaults, every stored password in the school would
     be cheap to crack — and no other test would notice, because every test would
     still pass. So the production numbers are pinned here, read from a `Settings`
     built with the environment explicitly excluded.

  2. The FastAPI app is built ONCE per session and shared. If a future change makes
     the app carry per-test state, tests would start passing or failing depending on
     what ran before them — the worst failure mode a suite can have. So the sharing
     is asserted directly, along with the invariant that actually keeps it safe: no
     `get_db` override survives a test.

These tests are DB-FREE on purpose (no `requires_db`): a harness guard that only
runs when a database happens to be reachable is not a guard.
"""

from __future__ import annotations

import os

from app.config import Settings
from app.core import security

# The production posture, restated as literals rather than imported from the code
# under test. Importing `Settings().argon2_memory_cost` and comparing it to itself
# would pass no matter what the value became; the point of this test is to make a
# change to those defaults require a deliberate edit HERE too.
PROD_ARGON2_TIME_COST = 3
PROD_ARGON2_MEMORY_COST = 65_536  # KiB = 64 MiB
PROD_ARGON2_PARALLELISM = 4


def _pristine_settings() -> Settings:
    """Settings as a fresh deployment would construct them.

    `_env_file=None` and an emptied env are both required: the suite exports
    ARGON2_* (conftest) and a real `backend/.env` also sets them, so a plain
    `Settings()` here would read back the reduced test values and the assertion
    would be vacuous.
    """
    saved = {k: v for k, v in os.environ.items() if k.upper().startswith("ARGON2_")}
    for key in saved:
        del os.environ[key]
    try:
        return Settings(_env_file=None)  # type: ignore[call-arg]
    finally:
        os.environ.update(saved)


class TestProductionHashingIsUnchanged:
    """The test-lane cost reduction must not become the shipped configuration."""

    def test_production_argon2_defaults_are_still_strong(self) -> None:
        cfg = _pristine_settings()
        assert cfg.argon2_time_cost == PROD_ARGON2_TIME_COST
        assert cfg.argon2_memory_cost == PROD_ARGON2_MEMORY_COST
        assert cfg.argon2_parallelism == PROD_ARGON2_PARALLELISM

    def test_production_memory_cost_is_at_least_the_owasp_floor(self) -> None:
        """OWASP's Argon2id guidance is 19 MiB minimum. Asserted as an inequality
        as well as the exact value above, so that a deliberate future re-tune has a
        floor to stay above rather than just a number to update."""
        assert _pristine_settings().argon2_memory_cost >= 19 * 1024

    def test_suite_runs_at_a_reduced_cost(self) -> None:
        """The speedup is real and active.

        Without this, a refactor that moved `app.core.security`'s import earlier
        than conftest's env block would restore the ~96ms-per-hash cost, adding
        minutes back to the suite with nothing failing to say so.
        """
        if os.environ.get("SIS_TEST_FULL_ARGON2"):
            # Explicit opt-in to production cost — the escape hatch is working.
            assert security._hasher.memory_cost == PROD_ARGON2_MEMORY_COST
            return
        assert security._hasher.memory_cost < PROD_ARGON2_MEMORY_COST, (
            "Argon2 is running at production cost inside the suite. conftest's "
            "ARGON2_* block must execute before anything imports app.core.security."
        )

    def test_reduction_changes_only_the_work_factor_not_the_algorithm(self) -> None:
        """Cheap hashes are fine; a DIFFERENT hash format is not — the login,
        rehash and password-reset paths must exercise the same primitive that
        production uses."""
        hashed = security.hash_password("Sup3rSecret!pw")
        assert hashed.startswith("$argon2id$")
        assert security.verify_password("Sup3rSecret!pw", hashed) is True
        assert security.verify_password("wrong-password", hashed) is False


class TestSharedAppFixture:
    """The session-scoped app must stay stateless between tests."""

    def test_app_is_the_same_object_across_tests(self, app) -> None:  # noqa: ANN001
        """Records the identity for the companion test below to compare against."""
        type(self)._first_app_id = id(app)  # type: ignore[attr-defined]
        assert app is not None

    def test_app_identity_is_stable(self, app) -> None:  # noqa: ANN001
        """Same app object in a second test → `create_app()` ran once, not twice.

        Ordering-dependent by construction (it needs the test above to have run),
        so it asserts nothing when run in isolation rather than failing.
        """
        first = getattr(type(self), "_first_app_id", None)
        if first is None:
            return
        assert id(app) == first

    def test_no_db_override_leaks_out_of_a_test(self, app) -> None:  # noqa: ANN001
        """`get_db` must be the ONLY override, and it must belong to this test.

        A leaked override from a previous test would point at a closed session, and
        the resulting failures would look like application bugs in whichever test
        happened to run next.
        """
        from app.core.deps import get_db

        assert set(app.dependency_overrides) <= {get_db}
