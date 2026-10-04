"""`requirements*.txt` must agree with `pyproject.toml` (D36).

**Why this test exists.** `pyproject.toml` already declared every dependency, so adding
`requirements.txt` created a SECOND pinned list of the same packages. Two hand-maintained
copies of the same facts drift — silently, and in the worst possible place: the version you
deploy stops being the version you tested. The usual outcome is a container built from
`requirements.txt` running a different SQLAlchemy from the one the suite passed against.

So the mirror is enforced rather than trusted. Add a dependency to `pyproject.toml` first,
copy the line into the right requirements file, and this test tells you if you forget
either half.

It is a pure file-parsing test: no database, no app, no network. `tomllib` is stdlib from
Python 3.11, which this project already requires, so it adds no dependency of its own.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
PYPROJECT = BACKEND / "pyproject.toml"
RUNTIME_TXT = BACKEND / "requirements.txt"
DEV_TXT = BACKEND / "requirements-dev.txt"


def _parse_requirements(path: Path) -> set[str]:
    """The pinned requirement lines of a requirements file, normalised.

    Skips comments, blank lines and `-r` includes — the include is what makes
    `requirements-dev.txt` a superset, and following it here would make the two
    assertions below indistinguishable.
    """
    out: set[str] = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        out.add(_normalise(line))
    return out


def _normalise(spec: str) -> str:
    """`Email-Validator[foo] == 2.2.0` -> `email-validator[foo]==2.2.0`.

    PEP 503 name normalisation (lowercase, `_`/`.` -> `-`) plus whitespace removal, so a
    cosmetic difference between the two files is not reported as drift. Extras are KEPT:
    `uvicorn` and `uvicorn[standard]` are genuinely different installs, and dropping the
    extra is exactly the kind of change this test should catch.
    """
    spec = re.sub(r"\s+", "", spec)
    match = re.match(r"^([A-Za-z0-9._-]+)(\[[^\]]*\])?(.*)$", spec)
    if match is None:  # pragma: no cover - a malformed line is a test failure below
        return spec.lower()
    name, extras, rest = match.groups()
    name = re.sub(r"[-_.]+", "-", name).lower()
    return f"{name}{extras or ''}{rest}"


def _pyproject() -> dict:
    with PYPROJECT.open("rb") as fh:
        return tomllib.load(fh)


# ════════════════════════════════════════════════════════════════════════════
class TestTheFilesExist:
    def test_both_requirements_files_are_present(self) -> None:
        """The RUNBOOK's first-time setup instructs `pip install -r requirements-dev.txt`.
        If either file goes missing, that instruction breaks for a new machine."""
        assert RUNTIME_TXT.is_file(), f"missing {RUNTIME_TXT}"
        assert DEV_TXT.is_file(), f"missing {DEV_TXT}"

    def test_dev_includes_the_runtime_file(self) -> None:
        """`requirements-dev.txt` must be a SUPERSET, not a parallel list. The `-r`
        include is what guarantees that; without it, installing the dev file alone would
        give you pytest and no FastAPI."""
        body = DEV_TXT.read_text(encoding="utf-8")
        assert "-r requirements.txt" in body


# ════════════════════════════════════════════════════════════════════════════
class TestRuntimeDependencies:
    def test_they_match_pyproject_exactly(self) -> None:
        expected = {_normalise(d) for d in _pyproject()["project"]["dependencies"]}
        actual = _parse_requirements(RUNTIME_TXT)

        missing = expected - actual
        extra = actual - expected
        assert not missing, (
            "in pyproject.toml but NOT in requirements.txt — a deployment built from "
            f"requirements.txt would be missing them: {sorted(missing)}"
        )
        assert not extra, (
            "in requirements.txt but NOT in pyproject.toml — either it belongs in "
            f"pyproject or it should not be installed at all: {sorted(extra)}"
        )

    def test_every_dependency_is_pinned_to_an_exact_version(self) -> None:
        """`==` on everything, deliberately.

        A floating pin means the suite passes on one machine's resolution and fails on
        another's, and the difference is invisible in the diff. This repo has no
        lockfile and no CI, so the pins ARE the lockfile.
        """
        unpinned = [
            spec for spec in _parse_requirements(RUNTIME_TXT) if "==" not in spec
        ]
        assert not unpinned, f"not pinned with `==`: {unpinned}"

    def test_the_uvicorn_standard_extra_is_not_dropped(self) -> None:
        """Named explicitly because losing the extra is silent and slow to notice:
        without `watchfiles`, `uvicorn --reload` falls back to a stat-polling loop
        instead of failing, so it looks like it works and just reloads badly."""
        assert "uvicorn[standard]==0.34.0" in _parse_requirements(RUNTIME_TXT)

    def test_tzdata_is_present(self) -> None:
        """Not optional on Windows, which ships no IANA tz database. Without it
        `ZoneInfo("America/Belize")` in `app/core/timeutil.py` raises
        `ZoneInfoNotFoundError` and every school-local date resolution fails."""
        assert any(
            spec.startswith("tzdata==") for spec in _parse_requirements(RUNTIME_TXT)
        )


# ════════════════════════════════════════════════════════════════════════════
class TestDevDependencies:
    def test_they_match_the_pyproject_dev_extra_exactly(self) -> None:
        expected = {
            _normalise(d)
            for d in _pyproject()["project"]["optional-dependencies"]["dev"]
        }
        actual = _parse_requirements(DEV_TXT)

        missing = expected - actual
        extra = actual - expected
        assert not missing, f"in pyproject [dev] but not in requirements-dev.txt: {sorted(missing)}"
        assert not extra, f"in requirements-dev.txt but not in pyproject [dev]: {sorted(extra)}"

    def test_the_dev_file_does_not_repeat_the_runtime_pins(self) -> None:
        """It includes them with `-r`; listing them again would be a third copy to keep
        in step, and the two could then disagree with each other."""
        overlap = _parse_requirements(DEV_TXT) & _parse_requirements(RUNTIME_TXT)
        assert not overlap, f"duplicated from requirements.txt: {sorted(overlap)}"


# ════════════════════════════════════════════════════════════════════════════
class TestTheInstalledEnvironmentMatches:
    def test_every_pinned_runtime_package_is_importable_at_that_version(self) -> None:
        """The pins are only worth anything if the venv actually holds them.

        Uses `importlib.metadata`, so it checks the INSTALLED distribution rather than
        re-reading a file — which is the difference between "the list says 2.0.36" and
        "the suite you just ran used 2.0.36".
        """
        from importlib.metadata import PackageNotFoundError, version

        mismatched: list[str] = []
        for spec in sorted(_parse_requirements(RUNTIME_TXT)):
            name, _, pinned = spec.partition("==")
            name = name.split("[")[0]
            try:
                installed = version(name)
            except PackageNotFoundError:
                mismatched.append(f"{name}: NOT INSTALLED (pinned {pinned})")
                continue
            if installed != pinned:
                mismatched.append(f"{name}: installed {installed}, pinned {pinned}")
        assert not mismatched, (
            "the venv does not match requirements.txt — reinstall with "
            "`pip install -r requirements-dev.txt`: " + "; ".join(mismatched)
        )
