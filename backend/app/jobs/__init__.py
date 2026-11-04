"""Runnable maintenance commands (`python -m app.jobs.<name>`).

Jobs live outside the request path: they take their own Session, own their own
transactions, and print a human-readable report to stdout rather than returning
an API envelope. Nothing in here is scheduled by the application — see each
module's docstring.
"""
