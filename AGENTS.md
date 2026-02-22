# AGENTS.md

## Guidelines

- After accomplishing a task remove the corresponding TODO/FIXME item from `TODO.md`.
  (Also remove the empty line before or after the item.)

- Never run `npm install` in subfolders (`backend/` and `frontend/`), but only in the main project folder,
  because we have one central `node_modules/` used by both `backend/` and `frontend/`.