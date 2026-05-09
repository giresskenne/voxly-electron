#!/bin/bash
# Quick reference for semantic versioning

echo "
╔════════════════════════════════════════════════════════════════════════════╗
║                    COMMIT MESSAGE QUICK REFERENCE                          ║
╚════════════════════════════════════════════════════════════════════════════╝

Format: type(scope): subject

📋 TYPES:
  feat       → New feature (bumps MINOR version)
  fix        → Bug fix (bumps PATCH version)
  docs       → Documentation
  style      → Code style changes (no logic change)
  refactor   → Code refactor
  perf       → Performance improvement
  test       → Test changes
  chore      → Build, deps, tooling
  ci         → CI/CD pipeline
  revert     → Revert previous commit

📌 SCOPE (optional):
  paste, overlay, transcribe, ui, hotkey, ipc, etc.

🚀 EXAMPLES:

  ✓ feat(paste): add Windows nircmd fallback
  ✓ fix(overlay): resolve z-index stacking issue
  ✓ docs: update Windows setup instructions
  ✓ test(paste): add Windows fallback chain tests
  ✓ chore: update electron to 39.2.6

❌ INVALID:

  ✗ Update UI components        (no type)
  ✗ feat: add UI Components     (capital S)
  ✗ feat: add UI components.    (period)
  ✗ feat: updated dependencies  (vague scope)

🔄 WORKFLOW:

  1. git checkout main && git pull
  2. git checkout -b feature/my-feature
  3. Make changes
  4. git commit -m \"feat(scope): description\"    ← Validated!
  5. git push origin feature/my-feature
  6. Push updates → auto pre-release (v0.1.0-rc.1)
  7. Create PR feature/my-feature → main
  8. Merge PR → auto release (v0.1.0)

📚 Full guide: see VERSIONING.md
"
