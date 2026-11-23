"""Subjects catalog slice (api-spec §5 Module 5b).

The school-wide, year-independent course catalog that feeds
`course_offerings.course_id`. The `Course` ORM model itself lives in
`app/modules/classes/models.py` (its natural home with the section model, D23);
this slice owns only the catalog CRUD endpoints + service. Documented placement
choice per the 7.2 brief.
"""
