"""The BAJC course catalog, programmes and curriculum — D30 Phase 2D.

GENERATED from `BAJC ALL PROGRAMME COURSE SEQUENCE 2026.pdf` (8 pages, one per
programme, sequence 26/27) and then hand-corrected. Checked in rather than parsed at
run time so the seed is reproducible without the PDF, and so every departure from the
source is reviewable in a diff.

VERIFIED: every term block sums to its printed `Total Credits`, and every programme's
blocks sum to its printed `Total Programme Credits`. A transcription that does not
reconcile is a transcription that is wrong.

CORRECTIONS APPLIED TO THE SOURCE — all flagged for BAJC (plan §G):

  1. `AGR12110` -> `AGRI2110` (Crop Production 2, Applied Agriculture Semester 3).
     Three letters and five digits where every other code is four and four. The
     block total is the proof: without this row Semester 3 sums to 18 against a
     printed 21.
  2. `ITEC 2118` -> `ITEC2118` (Systems Analysis) — stray space.
  3. `Pinciples of Accounting 1` -> `Principles of Accounting 1`. Misspelled on two
     of the three pages it appears on; the Religion page has it right.
  4. `Life & Teachings of Jesus` -> `Life & Teaching of Jesus` (Primary Education).
     Seven of eight pages use the singular.
  5. **`THEO1110` NAMES TWO DIFFERENT COURSES** — `Life & Teaching of Jesus`
     (GEC, 3 cr, all eight programmes) and `Science & Religion` (CEC, 3 cr,
     Religion only). `courses.code` is unique and one of them has to move. The GEC
     course keeps the code; Science & Religion is seeded under the deliberately
     PROVISIONAL `THEO1110-B` so it cannot be mistaken for a real BAJC code.
     **BAJC must assign a real one.**

OPEN QUESTIONS, seeded as-is and flagged (plan §G):

  * **`component` is a PER-PROGRAMME fact, and the schema stores it per COURSE.**
    9 of 114 codes carry different components in different
    programmes — MATH1110 is SEC in five programmes and CEC in Mathematics;
    MGMT1106 is CEC, SEC and GEC depending on the plan. That is what the word
    means: a course's role WITHIN a programme. `courses.component` therefore holds
    the majority value and the minority is lost on screen. The natural fix is
    additive — `program_courses.component`, falling back to the course — but it is
    a design change, not a seeding decision, so it is raised rather than taken.
    The divergences are listed in `COMPONENT_DIVERGENCES` below.
  * **Four Mathematics courses carry a `*` footnote** whose text is not in the PDF:
    MATH1103, MATH1208, MATH2214, MATH2216.
  * **`EDUC1214` requires `EDUC1210` and both sit in Primary Education Semester 2.**
    A prerequisite cannot be met in the same term as the course it gates (§D4), so
    as written this course is un-enrollable in its own block.
"""

from __future__ import annotations

#: code -> (name, credits, component, prerequisites_text-from-the-PDF)
COURSES: tuple[tuple[str, str, int, str, str | None], ...] = (
    ("ACCT1102", "Principles of Accounting 1", 3, "CEC", None),
    ("ACCT1214", "Principles of Accounting 2", 3, "CEC", "ACCT1102"),
    ("AGRI1102", "Plant Physiology & Morphology", 3, "GEC", None),
    ("AGRI1108", "Crop Production 1", 3, "CEC", "AGRI1122"),
    ("AGRI1109", "Livestock Production 1", 3, "CEC", "AGRI1120"),
    ("AGRI1120", "Principles of Livestock Production", 3, "CEC", None),
    ("AGRI1122", "Principles of Crop Production", 3, "CEC", None),
    ("AGRI1212", "Fundamentals of Soil", 3, "CEC", None),
    ("AGRI2110", "Crop Production 2", 3, "CEC", "AGRI1108"),
    ("AGRI2114", "Livestock Nutrition", 3, "CEC", "AGRI1109"),
    ("AGRI2116", "Livestock Production 2", 3, "CEC", "AGRI1109"),
    ("AGRI2118", "Agriculture Field Experience", 6, "CEC", "AGRI1108, AGRI1109"),
    ("AGRI2222", "Value Added Products", 3, "CEC", "AGRI2118"),
    ("AGRI2224", "Applied Agro-Forestry", 3, "CEC", "AGRI2118"),
    ("BFIN1208", "Business Finance", 3, "CEC", None),
    ("BIOL1102", "Foundations of Biology", 3, "CEC", None),
    ("BIOL1102L", "Foundations of Biology Lab", 1, "CEC", None),
    ("BIOL1204", "Reproduction Growth & Development", 3, "CEC", "BIOL1102"),
    ("BIOL1204L", "Reproduction Growth & Development Lab", 1, "CEC", "BIOL1102L"),
    ("BIOL1212", "Genetics & Creation", 3, "CEC", "BIOL1102"),
    ("BIOL1212L", "Genetics & Creation Lab", 1, "CEC", "BIOL1102L"),
    ("BIOL2101", "Cytology", 3, "CEC", "BIOL1102"),
    ("BIOL2101L", "Cytology Lab", 1, "CEC", "BIOL1102L"),
    ("BIOL2114", "Human Anatomy & Physiology 1", 3, "CEC", "BIOL1204"),
    ("BIOL2114L", "Human Anatomy & Physiology 1 Lab", 1, "CEC", "BIOL1204L"),
    ("BIOL2216", "Human Anatomy & Physiology 2", 3, "CEC", "BIOL2114"),
    ("BIOL2216L", "Human Anatomy & Physiology 2 Lab", 1, "CEC", "BIOL2114L"),
    ("BIOL2220", "Ecology", 3, "CEC", None),
    ("BIOL2220L", "Ecology Lab", 1, "CEC", None),
    ("BIOL2222", "Biodiversity", 3, "CEC", "CHEM2110"),
    ("BIOL2222L", "Biodiversity Lab", 1, "CEC", "CHEM2110L"),
    ("BUSS1210", "Marketing", 3, "CEC", "MGMT1106"),
    ("BUSS2116", "Business Law", 3, "CEC", None),
    ("BUSS2122", "Small Business Management", 3, "CEC", "BUSS1210"),
    ("BUSS2124", "Business Ethics", 3, "CEC", None),
    ("BUSS2224", "Business English", 3, "CEC", "ENGL1204"),
    ("BUST1104", "Business Statistics", 3, "CEC", "MATH1110"),
    ("CHEM1100", "Fundamentals of Chemistry", 3, "CEC", None),
    ("CHEM1100L", "Fundamentals of Chemistry Lab", 1, "CEC", None),
    ("CHEM2110", "Organic Chemistry & Biochemistry", 3, "CEC", "CHEM1100"),
    ("CHEM2110L", "Organic Chemistry & Biochemistry Lab", 1, "CEC", "CHEM1100L"),
    ("CRTH1010", "Critical Thinking", 3, "GEC", None),
    ("ECON1212", "Principles of Microeconomics", 3, "CEC", None),
    ("ECON2118", "Principles of Macroeconomics", 3, "CEC", None),
    ("EDUC1102", "Nature of the Learner", 4, "CEC", None),
    ("EDUC1104", "Introduction to Education", 3, "SEC", None),
    ("EDUC1208", "College Math for Prim. Sch. Trs. 1", 3, "CEC", None),
    ("EDUC1210", "Teaching Mtd. for Primary Curriculum", 4, "CEC", "EDUC1102, EDUC1104"),
    ("EDUC1212", "Science Content for Primary School", 3, "CEC", None),
    ("EDUC1214", "Social Studies Content", 3, "CEC", "EDUC1210"),
    ("EDUC2110", "Music Education & Instrument", 3, "CEC", None),
    ("EDUC2116", "Health & Family Life Education", 3, "CEC", "EDUC1210"),
    ("EDUC2118", "Phys. Educ. for the Prim. Curriculum", 3, "CEC", "EDUC1210"),
    ("EDUC2222", "College Math for Prim. School. Trs 2", 3, "CEC", "EDUC1208"),
    ("EDUC2224", "Fundamentals of Linguistics", 3, "CEC", None),
    ("EDUC2226", "Managing the Regular & Multigrade Class", 3, "CEC", "EDUC1210"),
    ("EDUC2228", "Language Arts Mtds for the Prim. Class 1", 3, "CEC", "EDUC1210"),
    ("EDUC2305", "Teaching Practicum", 3, "CEC", "EDUC1210, 2226, 2228, 2330, 2334, 2336"),
    ("EDUC2330", "Social Studies Mtds. for the Prim. Class", 3, "CEC", "EDUC1210"),
    ("EDUC2332", "Lang. Arts Mtds. for the Prim. Class 2", 3, "CEC", "EDUC2228"),
    ("EDUC2334", "Math Conc. & Mtds. for the Prim. Grade", 4, "CEC", "EDUC1210"),
    ("EDUC2336", "Science Conc. & Mtds for the Prim. Grades", 3, "CEC", "EDUC1210"),
    ("EDUC3101", "Spanish Mtds for the Prim. Classroom", 3, "CEC", "EDUC1210, SPAN2112"),
    ("EDUC3201", "Internship", 9, "CEC", "ALL COURSES"),
    ("ENGL1102", "College English 1", 3, "SEC", None),
    ("ENGL1103", "Research Methods", 3, "SEC", None),
    ("ENGL1106", "Fundamentals of English", 3, "SEC", None),
    ("ENGL1204", "College English 2", 3, "SEC", "ENGL1102"),
    ("ENGL2105", "Language & Communication", 3, "SEC", None),
    ("HIST2102", "Belizean History", 3, "GEC", None),
    ("ITEC1104", "Introduction to Computers", 3, "GEC", None),
    ("ITEC1108", "Introduction to Computing", 3, "CEC", None),
    ("ITEC1110", "Principles of Programming 1", 3, "CEC", None),
    ("ITEC1202", "Principles of Programming 2", 3, "CEC", "ITEC1110"),
    ("ITEC1206", "Web Development", 3, "CEC", "ITEC1108"),
    ("ITEC1208", "Object Oriented Programming", 3, "CEC", "ITEC1108"),
    ("ITEC1214", "Basic PC Repair", 3, "CEC", None),
    ("ITEC2111", "Database Design and Implementation", 3, "CEC", None),
    ("ITEC2116", "Data Structures", 3, "CEC", None),
    ("ITEC2118", "Systems Analysis", 3, "CEC", None),
    ("ITEC2210", "Computer Application for Administrators", 3, "CEC", "ITEC1104"),
    ("ITEC2212", "Networking 1", 3, "CEC", None),
    ("ITEC2222", "Graphical User Interface Programming", 3, "CEC", "ITEC1208"),
    ("ITEC2224", "Operating Systems Analysis", 3, "CEC", None),
    ("MATH1103", "Plane Geometry", 3, "CEC", None),
    ("MATH1104", "Trigonometry", 3, "CEC", None),
    ("MATH1110", "Intermediate Algebra", 3, "SEC", None),
    ("MATH1206", "Calculus 1", 3, "CEC", "MATH1210"),
    ("MATH1208", "Statistics 1", 3, "CEC", "MATH1110"),
    ("MATH1210", "Pre-Calculus", 3, "SEC", "MATH1110"),
    ("MATH2110", "Calculus 2", 3, "CEC", "MATH1206"),
    ("MATH2214", "Statistics 2", 3, "CEC", "MATH1208"),
    ("MATH2216", "Counting, Matrices & Complex Numbers", 3, "CEC", "MATH1110"),
    ("MGMT1106", "Business Management", 3, "SEC", None),
    ("PHIL1110", "Ethics", 3, "SEC", None),
    ("PHIL2211", "Philosophy of Education", 3, "GEC", None),
    ("PSYC2108", "Introduction to Psychology", 3, "SEC", None),
    ("SOCI1212", "Introduction to Sociology", 3, "SEC", None),
    ("SOWK2201", "Introduction to Social Work & Community Resource", 3, "CEC", None),
    ("SPAN2112", "Intermediate Spanish", 3, "GEC", None),
    ("THEO1104", "Personal Evangelism", 2, "CEC", None),
    ("THEO1108", "Daniel", 3, "CEC", None),
    ("THEO1110", "Life & Teaching of Jesus", 3, "GEC", None),
    ("THEO1110-B", "Science & Religion", 3, "CEC", None),
    ("THEO1210", "Christian Beliefs", 3, "GEC", None),
    ("THEO1212", "Revelation", 3, "CEC", None),
    ("THEO1218", "SDA Church History & Prophetic Orientation", 3, "CEC", None),
    ("THEO2114", "Homiletics 1", 2, "CEC", None),
    ("THEO2118", "Propaedeutic & Hermeneutics", 3, "CEC", None),
    ("THEO2201", "Health Principles", 3, "GEC", None),
    ("THEO2210", "Public Evangelism", 2, "CEC", None),
    ("THEO2224", "Practicum", 3, "CEC", "THEO1104, THEO2114"),
    ("THEO2226", "Church Administration", 3, "CEC", None),
    ("THEO2228", "Homiletics 2", 2, "CEC", "THEO2114"),
)

#: code, name, award, total credits, min passing grade point.
#: Primary Education passes at C (2.00); every other programme at C+ (2.50) — the
#: brief's per-programme rule (§D5).
PROGRAMS: tuple[tuple[str, str, str, int, str], ...] = (
    ("BMAD", "Business Management", "Associate of Social Science", 87, "2.50"),
    ("GNST", "General Studies", "Associate of Social Science", 87, "2.50"),
    ("BIOL", "Biology", "Associate of Science", 88, "2.50"),
    ("AGRI", "Applied Agriculture", "Associate of Science", 86, "2.50"),
    ("ITEC", "Information Technology", "Associate of Science", 90, "2.50"),
    ("MATH", "Mathematics", "Associate of Science", 87, "2.50"),
    ("EDUC", "Primary Education", "Associate of Arts", 102, "2.00"),
    ("RELG", "Religion", "Associate of Arts", 86, "2.50"),
)

#: programme code -> ((term_label, term_order, (course codes...)), ...)
#:
#: `term_label` is a CURRICULUM POSITION, not a calendar term (§D3). Seven
#: programmes run Summer 1 + Semesters 1-4; Primary Education runs eight blocks
#: including Spring 1 and Spring 2, and `term_order` is what keeps Spring 1 between
#: Semester 2 and Semester 3 — alphabetically it would sort before Summer 1.
CURRICULUM: dict[str, tuple[tuple[str, int, tuple[str, ...]], ...]] = {
    "BMAD": (
        ("Summer 1", 1, ("CRTH1010", "ITEC1104",)),
        ("Semester 1", 2, ("ACCT1102", "ENGL1102", "ENGL2105", "MATH1110", "MGMT1106", "THEO1110", "THEO2201",)),
        ("Semester 2", 3, ("ACCT1214", "BUSS1210", "ECON1212", "ENGL1204", "MATH1210", "THEO1210",)),
        ("Semester 3", 4, ("BUSS2116", "BUSS2124", "BUST1104", "ECON2118", "ENGL1103", "HIST2102", "PSYC2108",)),
        ("Semester 4", 5, ("BFIN1208", "BUSS2122", "BUSS2224", "ITEC2210", "PHIL1110", "PHIL2211", "SPAN2112",)),
    ),
    "GNST": (
        ("Summer 1", 1, ("CRTH1010", "ITEC1104",)),
        ("Semester 1", 2, ("EDUC1104", "ENGL1102", "ENGL2105", "MATH1110", "MGMT1106", "PSYC2108", "THEO1110",)),
        ("Semester 2", 3, ("ECON1212", "ENGL1204", "MATH1210", "PHIL1110", "SOCI1212", "THEO1210",)),
        ("Semester 3", 4, ("ACCT1102", "BUSS2124", "BUST1104", "EDUC2110", "ENGL1103", "HIST2102", "THEO2201",)),
        ("Semester 4", 5, ("BUSS1210", "BUSS2224", "EDUC2224", "ITEC2210", "PHIL2211", "SOWK2201", "SPAN2112",)),
    ),
    "BIOL": (
        ("Summer 1", 1, ("CRTH1010", "ITEC1104",)),
        ("Semester 1", 2, ("BIOL1102", "BIOL1102L", "CHEM1100", "CHEM1100L", "ENGL1102", "MATH1110", "MGMT1106", "THEO1110",)),
        ("Semester 2", 3, ("AGRI1102", "BIOL1204", "BIOL1204L", "BIOL1212", "BIOL1212L", "ENGL1204", "PHIL1110", "THEO1210",)),
        ("Semester 3", 4, ("BIOL2101", "BIOL2101L", "BIOL2114", "BIOL2114L", "CHEM2110", "CHEM2110L", "ENGL1103", "HIST2102", "PSYC2108",)),
        ("Semester 4", 5, ("BIOL2216", "BIOL2216L", "BIOL2220", "BIOL2220L", "BIOL2222", "BIOL2222L", "PHIL2211", "SOCI1212", "SPAN2112",)),
    ),
    "AGRI": (
        ("Summer 1", 1, ("CRTH1010", "ITEC1104",)),
        ("Semester 1", 2, ("AGRI1120", "AGRI1122", "CHEM1100", "CHEM1100L", "ENGL1102", "MATH1110", "THEO1110",)),
        ("Semester 2", 3, ("AGRI1102", "AGRI1108", "AGRI1109", "AGRI1212", "ECON1212", "ENGL1204", "THEO1210",)),
        ("Semester 3", 4, ("AGRI2110", "AGRI2114", "AGRI2116", "AGRI2118", "ENGL1103", "PSYC2108",)),
        ("Semester 4", 5, ("AGRI2222", "AGRI2224", "BIOL2220", "BIOL2220L", "PHIL1110", "PHIL2211", "SPAN2112",)),
    ),
    "ITEC": (
        ("Summer 1", 1, ("CRTH1010", "ITEC1104",)),
        ("Semester 1", 2, ("ENGL1102", "ITEC1108", "ITEC1110", "ITEC1214", "MATH1104", "MATH1110", "THEO1110",)),
        ("Semester 2", 3, ("ENGL1204", "ITEC1202", "ITEC1206", "ITEC2111", "MATH1210", "SOCI1212", "THEO1210",)),
        ("Semester 3", 4, ("ENGL1103", "HIST2102", "ITEC1208", "ITEC2116", "ITEC2118", "MATH1206", "MGMT1106",)),
        ("Semester 4", 5, ("ITEC2212", "ITEC2222", "ITEC2224", "MATH2110", "PHIL1110", "PHIL2211", "SPAN2112",)),
    ),
    "MATH": (
        ("Summer 1", 1, ("CRTH1010", "ITEC1104",)),
        ("Semester 1", 2, ("ENGL1102", "HIST2102", "ITEC1110", "MATH1103", "MATH1104", "MATH1110", "THEO1110",)),
        ("Semester 2", 3, ("ECON1212", "ENGL1204", "ITEC1202", "MATH1210", "PHIL1110", "THEO1210",)),
        ("Semester 3", 4, ("ENGL1103", "ENGL2105", "MATH1206", "MATH1208", "MGMT1106", "PSYC2108", "THEO2201",)),
        ("Semester 4", 5, ("EDUC1104", "MATH2110", "MATH2214", "MATH2216", "PHIL2211", "SOCI1212", "SPAN2112",)),
    ),
    "EDUC": (
        ("Summer 1", 1, ("CRTH1010", "ITEC1104",)),
        ("Semester 1", 2, ("EDUC1102", "EDUC1104", "ENGL1106", "HIST2102", "MGMT1106", "THEO1110",)),
        ("Semester 2", 3, ("EDUC1208", "EDUC1210", "EDUC1212", "EDUC1214", "PHIL2211", "THEO1210",)),
        ("Spring 1", 4, ("EDUC2116", "EDUC2118",)),
        ("Semester 3", 5, ("EDUC2110", "EDUC2222", "EDUC2226", "EDUC2330", "EDUC2336", "ENGL1102",)),
        ("Semester 4", 6, ("EDUC2224", "EDUC2228", "EDUC2305", "EDUC2334", "ENGL1204", "SPAN2112",)),
        ("Spring 2", 7, ("EDUC2332", "EDUC3101",)),
        ("Semester 5", 8, ("EDUC3201",)),
    ),
    "RELG": (
        ("Summer 1", 1, ("CRTH1010", "ITEC1104",)),
        ("Semester 1", 2, ("ACCT1102", "ENGL1102", "ENGL2105", "HIST2102", "THEO1104", "THEO1110", "THEO1110-B",)),
        ("Semester 2", 3, ("AGRI1102", "ENGL1204", "SOCI1212", "THEO1108", "THEO1210", "THEO1212", "THEO1218",)),
        ("Semester 3", 4, ("EDUC1104", "EDUC2110", "ENGL1103", "PSYC2108", "THEO2114", "THEO2118", "THEO2201",)),
        ("Semester 4", 5, ("PHIL1110", "PHIL2211", "SPAN2112", "THEO2210", "THEO2224", "THEO2226", "THEO2228",)),
    ),
}

#: (gated course, required course). Global — the source never scopes a course
#: prerequisite to one programme.
COURSE_PREREQUISITES: tuple[tuple[str, str], ...] = (
    ("ACCT1214", "ACCT1102"),
    ("AGRI1108", "AGRI1122"),
    ("AGRI1109", "AGRI1120"),
    ("AGRI2110", "AGRI1108"),
    ("AGRI2114", "AGRI1109"),
    ("AGRI2116", "AGRI1109"),
    ("AGRI2118", "AGRI1108"),
    ("AGRI2118", "AGRI1109"),
    ("AGRI2222", "AGRI2118"),
    ("AGRI2224", "AGRI2118"),
    ("BIOL1204", "BIOL1102"),
    ("BIOL1204L", "BIOL1102L"),
    ("BIOL1212", "BIOL1102"),
    ("BIOL1212L", "BIOL1102L"),
    ("BIOL2101", "BIOL1102"),
    ("BIOL2101L", "BIOL1102L"),
    ("BIOL2114", "BIOL1204"),
    ("BIOL2114L", "BIOL1204L"),
    ("BIOL2216", "BIOL2114"),
    ("BIOL2216L", "BIOL2114L"),
    ("BIOL2222", "CHEM2110"),
    ("BIOL2222L", "CHEM2110L"),
    ("BUSS1210", "MGMT1106"),
    ("BUSS2122", "BUSS1210"),
    ("BUSS2224", "ENGL1204"),
    ("BUST1104", "MATH1110"),
    ("CHEM2110", "CHEM1100"),
    ("CHEM2110L", "CHEM1100L"),
    ("EDUC1210", "EDUC1102"),
    ("EDUC1210", "EDUC1104"),
    ("EDUC1214", "EDUC1210"),
    ("EDUC2116", "EDUC1210"),
    ("EDUC2118", "EDUC1210"),
    ("EDUC2222", "EDUC1208"),
    ("EDUC2226", "EDUC1210"),
    ("EDUC2228", "EDUC1210"),
    ("EDUC2305", "EDUC1210"),
    ("EDUC2305", "EDUC2226"),
    ("EDUC2305", "EDUC2228"),
    ("EDUC2305", "EDUC2330"),
    ("EDUC2305", "EDUC2334"),
    ("EDUC2305", "EDUC2336"),
    ("EDUC2330", "EDUC1210"),
    ("EDUC2332", "EDUC2228"),
    ("EDUC2334", "EDUC1210"),
    ("EDUC2336", "EDUC1210"),
    ("EDUC3101", "EDUC1210"),
    ("EDUC3101", "SPAN2112"),
    ("ENGL1204", "ENGL1102"),
    ("ITEC1202", "ITEC1110"),
    ("ITEC1206", "ITEC1108"),
    ("ITEC1208", "ITEC1108"),
    ("ITEC2210", "ITEC1104"),
    ("ITEC2222", "ITEC1208"),
    ("MATH1206", "MATH1210"),
    ("MATH1208", "MATH1110"),
    ("MATH1210", "MATH1110"),
    ("MATH2110", "MATH1206"),
    ("MATH2214", "MATH1208"),
    ("MATH2216", "MATH1110"),
    ("THEO2224", "THEO1104"),
    ("THEO2224", "THEO2114"),
    ("THEO2228", "THEO2114"),
)

#: (gated course, programme). `EDUC3201` (Internship) <- literally 'ALL COURSES'
#: on the Primary Education sequence. A list of course ids could not say that: the
#: gate has to keep meaning 'everything the programme requires' as the curriculum
#: changes.
ALL_PROGRAM_COURSE_GATES: tuple[tuple[str, str], ...] = (
    ("EDUC3201", "EDUC"),
)

#: course code -> {component: how many programmes say so}. Reference for the open
#: question above; nothing reads it at run time.
COMPONENT_DIVERGENCES: dict[str, dict[str, int]] = {
    "ACCT1102": {"CEC": 2, "SEC": 1},
    "ECON1212": {"CEC": 3, "SEC": 1},
    "EDUC1104": {"GEC": 1, "SEC": 2, "CEC": 1},
    "ITEC1110": {"CEC": 1, "SEC": 1},
    "ITEC1202": {"CEC": 1, "SEC": 1},
    "MATH1110": {"SEC": 5, "CEC": 1},
    "MATH1210": {"SEC": 3, "CEC": 1},
    "MGMT1106": {"CEC": 2, "SEC": 3, "GEC": 1},
    "PHIL1110": {"SEC": 6, "CEC": 1},
}
