"""Drive the REAL service write paths against sims inside an outer transaction.

The services call db.commit() internally, so the Session joins the outer
connection transaction as a SAVEPOINT -- their commits release the savepoint
but the outer rollback still discards everything.
"""
import uuid
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from app.db.session import engine
from app.common.enums import Role, GradeStatus, AttendanceStatus, AssessmentType
from app.modules.users.models import User
from app.modules.offerings.models import Course, CourseOffering, ClassEnrollment
from app.modules.assessments.models import Assessment
from app.modules.grades.models import AssessmentGrade
from app.modules.attendance.models import AttendanceRecord

conn = engine.connect()
outer = conn.begin()
db = Session(bind=conn, join_transaction_mode="create_savepoint")
results = []

def report(label, obj, extra=""):
    at, by = getattr(obj, "created_at", None), getattr(obj, "created_by", None)
    results.append((label, at is not None, by is not None))
    print(f"\n[{label}]{extra}")
    print(f"   created_at = {at}  -> {'STAMPED' if at else 'NULL'}")
    print(f"   created_by = {by}  -> {'STAMPED' if by else 'NULL'}")
    print(f"   updated_by = {getattr(obj,'updated_by',None)}")

pick = db.execute(text("""
    SELECT o.id, tp.user_id, e.student_id
    FROM course_offerings o
    JOIN class_teachers ct   ON ct.offering_id = o.id
    JOIN teacher_profiles tp ON tp.id = ct.teacher_id
    JOIN class_enrollments e ON e.offering_id = o.id AND e.enrollment_status='enrolled'
    JOIN semesters s ON s.id = o.semester_id
    JOIN academic_years y ON y.id = s.academic_year_id AND y.archived_at IS NULL
    LIMIT 1""")).first()
o_id, teacher_uid, student_id = pick
teacher = db.get(User, teacher_uid)
print(f"offering={o_id}  teacher={teacher.email}  student={student_id}")

# ---------- 1. assessment create (expected: both stamped) -----------------
from app.modules.assessments import service as asmt_svc
from app.modules.assessments.schemas import AssessmentCreateRequest, AssessmentStatusRequest
a_detail = asmt_svc.create_assessment(db, actor=teacher, payload=AssessmentCreateRequest(
    offering_id=o_id, title="ZZ Probe Quiz", type=AssessmentType.QUIZ, max_score=100))
a = db.get(Assessment, a_detail.id)
report("assessments.create_assessment -> assessments", a, f"  actor={teacher.email}")

# Fixture, inside the savepoint: the seeded term's grade deadline has passed,
# which 409s the write before it can reach the insert. Push it out so the real
# code path runs. Rolled back with everything else.
db.execute(text("UPDATE semesters SET grade_submission_deadline=NULL WHERE id=:s"),
           {"s": a.semester_id})

# ---------- 2. grade entry (the question) ---------------------------------
from app.modules.grades import service as gsvc
from app.modules.grades.schemas import GradeEntryRequest
try:
    gsvc.upsert_grades(db, actor=teacher, assessment_id=a.id,
        payload=GradeEntryRequest(entries=[{"student_id": student_id,
                                            "status": GradeStatus.GRADED, "score": 77}]))
    g = db.scalar(select(AssessmentGrade).where(AssessmentGrade.assessment_id == a.id))
    report("grades.upsert_grades -> assessment_grades", g, f"  actor={teacher.email}")
except Exception as e:
    print(f"\n[grade entry] {type(e).__name__}: {e}")

# ---------- 3. attendance ------------------------------------------------
from app.modules.attendance import service as att_svc
from app.modules.attendance.schemas import AttendanceUpsertRequest
free = db.execute(text("""
    SELECT d.dt FROM (SELECT CURDATE() - INTERVAL n DAY AS dt FROM
      (SELECT 1 n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5) x) d
    WHERE NOT EXISTS (SELECT 1 FROM attendance_records r
                      WHERE r.offering_id=:o AND r.attendance_date=d.dt) LIMIT 1"""),
    {"o": o_id}).scalar()
try:
    att_svc.upsert_register(db, actor=teacher, payload=AttendanceUpsertRequest(
        offering_id=o_id, date=free,
        entries=[{"student_id": student_id, "status": AttendanceStatus.PRESENT}]))
    r = db.scalar(select(AttendanceRecord).where(
        AttendanceRecord.offering_id == o_id, AttendanceRecord.attendance_date == free,
        AttendanceRecord.student_id == student_id))
    report("attendance.upsert_register -> attendance_records", r, f"  date={free}")
except Exception as e:
    print(f"\n[attendance] {type(e).__name__}: {e}")

# ---------- 4. control: course create ------------------------------------
from app.modules.courses import service as csvc
from app.modules.courses.schemas import CourseCreateRequest
principal = db.scalar(select(User).where(User.role == Role.PRINCIPAL).limit(1))
try:
    csvc.create_course(db, actor=principal, payload=CourseCreateRequest(
        name="ZZ Probe Course", code="ZZPR9999", credits=3, component="GEC"))
    c = db.scalar(select(Course).where(Course.code == "ZZPR9999"))
    report("courses.create_course -> courses (CONTROL)", c, f"  actor={principal.email}")
except Exception as e:
    print(f"\n[course create] {type(e).__name__}: {e}")

db.close()
outer.rollback()
conn.close()

print("\n" + "=" * 70)
print(f"{'write path':50s} created_at  created_by")
for label, ok_at, ok_by in results:
    print(f"{label[:50]:50s} {'OK  ':10s}  {'OK' if ok_by else '** NULL **'}")
print("=" * 70)

with engine.connect() as cx:
    for t in ("assessments", "assessment_grades", "attendance_records", "courses", "audit_log"):
        print(f"   {t:20s} {cx.execute(text(f'SELECT COUNT(*) FROM `{t}`')).scalar()}")
