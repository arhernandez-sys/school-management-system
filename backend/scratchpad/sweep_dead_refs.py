"""Find references to ORM attributes that D31 deleted — the check that MISSED them.

The earlier D31 sweep grepped for `CourseOffering.<attr>`, which only matches CLASS-level
(query) references. It reported clean while 20+ INSTANCE-level reads (`offering.name`) and
constructor kwargs (`AttendanceRecord(class_id=...)`) were still live. SQLAlchemy raises
those at runtime only, and the tests that would catch them were themselves broken — so the
defects were invisible from both directions.

So this checks the two shapes a grep cannot:

  1. constructor kwargs   Model(no_such_column=...)     — exact, from the mapper
  2. attribute reads      offering.name / cs.subject_id — heuristic, by variable name

usage: python sweep_dead_refs.py [app|tests|both]
"""

from __future__ import annotations

import ast
import os
import pathlib
import sys

os.environ.setdefault(
    "DATABASE_URL", "mysql+pymysql://root:Argo%40web1234@127.0.0.1:3306/sims_d31"
)


BACKEND = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.db import models  # noqa: E402,F401 - imports every module's models
from app.db.base import Base  # noqa: E402

MAPPED: dict[str, set[str]] = {
    m.class_.__name__: {a.key for a in m.attrs} for m in Base.registry.mappers
}

#: Columns `008` dropped with the homeroom. A read of any of these on a variable that
#: looks like an offering is a live 500.
DEAD_ATTRS = {
    "name",
    "grade_level",
    "homeroom_label",
    "numStudents",
    "classStaffID",
    "academic_year_id",
    "subject_id",
    "is_active",
    "class_id",
}
#: Variable names that hold a `CourseOffering` somewhere in this codebase.
OFFERING_VARS = {
    "offering", "section", "sec", "cs", "cls", "klass", "the_offering",
    "other_cs", "old_cs", "archived_cs", "other_section", "older_section",
    "archived_section", "math1", "math2", "bio", "eng",
}


def scan(root: pathlib.Path) -> list[str]:
    hits: list[str] = []
    for path in sorted(root.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), str(path))
        rel = path.relative_to(BACKEND)
        for node in ast.walk(tree):
            # 1. constructor kwargs — exact
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id in MAPPED
            ):
                for kw in node.keywords:
                    if kw.arg and kw.arg not in MAPPED[node.func.id]:
                        hits.append(
                            f"{rel}:{node.lineno}: {node.func.id}({kw.arg}=...) "
                            f"- not a mapped attribute"
                        )
            # 2. attribute reads on offering-shaped variables — heuristic
            if (
                isinstance(node, ast.Attribute)
                and node.attr in DEAD_ATTRS
                and isinstance(node.value, ast.Name)
                and node.value.id in OFFERING_VARS
            ):
                hits.append(
                    f"{rel}:{node.lineno}: {node.value.id}.{node.attr} "
                    f"- dropped by 008"
                )
    return hits


def main() -> int:
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    roots = {"app": [BACKEND / "app"], "tests": [BACKEND / "tests"]}
    roots["both"] = roots["app"] + roots["tests"]
    hits: list[str] = []
    for root in roots[which]:
        hits += scan(root)
    print("\n".join(hits) if hits else "clean - no dead D31 references")
    print(f"\n{len(hits)} hit(s)")
    return 1 if hits else 0


if __name__ == "__main__":
    raise SystemExit(main())
