"""Physical rooms (D44, from the client's `sims_10` dump).

BAJC teaches in named rooms across a small number of buildings, and until D44 the system
had no idea any of them existed: `class_meetings.room` was free text typed per meeting, so
"Room A", "room a" and "A" were three rooms, none of them capacity-checked and none of
them listable.

⚠️ THIS DOES NOT YET REPLACE `class_meetings.room`. Both exist after D44, and the offering
is what carries the new FK. See `docs/d44-sims10-and-meeting3.md` for why the free-text
column is still the one the timetable renders, and what has to happen before it is not.
"""
