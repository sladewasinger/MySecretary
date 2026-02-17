# Project Agent Notes

## Framework

- Use Angular `latest`.
- Prefer standalone APIs and signals.

## Coding style

- Prefer self-documenting names and structure.
- Do not add comments unless strictly necessary.
- Break logic into focused components/services when it improves clarity.
- Follow functional SOLID principles as closely as practical.
- Keep units single-purpose.
- Keep UI, state, and side effects in explicit boundaries.
- Prefer composable functions and predictable data flow.
- When the user says `goodnight`, append a new timestamped entry to `SESSION_RESUME.md` using the existing session format.
- `goodnight` updates must include summary, completed work, exact user run commands for next session, codex next steps, and blockers.
- Keep session entries in chronological order (oldest to newest).
