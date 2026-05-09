# Automatic Versioning & Release Strategy

This project uses **semantic-release** with GitHub Actions for automatic versioning. All workflows are **completely free** on GitHub's free tier.

## How It Works

### 1. **Semantic Versioning**

Versions follow [Semantic Versioning 2.0.0](https://semver.org/):
- `MAJOR.MINOR.PATCH` (e.g., `1.2.3`)
- **MAJOR**: Breaking changes (`feat!: ...` or `BREAKING CHANGE:`)
- **MINOR**: New features (`feat: ...`)
- **PATCH**: Bug fixes (`fix: ...`)

### 2. **Conventional Commits**

All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) standard:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Valid types:**
- `feat` — New feature (bumps MINOR)
- `fix` — Bug fix (bumps PATCH)
- `docs` — Documentation only
- `style` — Code style (no functional change)
- `refactor` — Code refactor
- `perf` — Performance improvement
- `test` — Test additions/changes
- `chore` — Build, deps, etc.
- `ci` — CI/CD pipeline changes
- `revert` — Revert a previous commit

**Examples:**
```
feat(paste): add Windows nircmd fallback for Ctrl+V
fix(ui): resolve platform-specific accessibility button rendering
chore: update dependencies
feat!: breaking change in API
```

### 3. **Branches & Release Flows**

#### **`main` branch → Production Release**
- Triggered: On push or merge to `main`
- Action: Runs `.github/workflows/release.yml`
- Output:
  - ✅ Version bumped in `package.json`
  - ✅ Git tag created (e.g., `v1.2.3`)
  - ✅ GitHub Release published
  - ✅ `CHANGELOG.md` updated automatically
  - ✅ Commit pushed back with version bump

#### **Feature branches (`feature/*`, `feat/*`, `fix/*`, `chore/*`, `hotfix/*`) → Pre-Release**
- Triggered: On push to one of those branches
- Action: Runs `.github/workflows/pre-release.yml`
- Output:
  - ✅ Pre-release version (e.g., `v1.2.3-rc.1`)
  - ✅ GitHub Pre-Release published
  - ✅ Tagged as pre-release, not production

### 4. **Local Commit Validation**

Before committing, `commitlint` via **Husky** validates your commit message.

```bash
# ✓ Valid commits
git commit -m "feat: add Windows support"
git commit -m "fix(paste): improve fallback chain"
git commit -m "docs: update README"

# ✗ Invalid commits (rejected)
git commit -m "Added Windows support"  # Missing type
git commit -m "feat: Add Windows Support"  # Subject capitalization
git commit -m "feat: update dependencies."  # Period at end
```

## Workflow

### For feature branch pushes (Pre-release testing)

1. Create feature branch from `main`:
   ```bash
   git checkout main
   git pull
   git checkout -b feature/my-feature
   ```

2. Make commits with conventional format:
   ```bash
   git commit -m "feat(overlay): add new animation mode"
   ```

3. Push to GitHub:
   ```bash
   git push origin feature/my-feature
   ```

4. Open a PR to `main` when ready
   - Reviewers check code
   - CI runs (lint, tests, etc.)
   - Merge when approved

5. **Automatic pre-release created!**
   - Version bumped: e.g., `v0.2.0-rc.1`
   - GitHub Pre-Release published
   - Can be used for testing/beta distribution

### For feature branch → `main` (Production release)

1. Create PR from your feature branch to `main`
   - Include summary of changes
   - Label: `release` (optional, for clarity)

2. Code review & approval

3. Merge PR to `main`

4. **Automatic production release created!**
   - Version bumped based on commits: e.g., `v0.2.0`
   - GitHub Release published
   - Changelog auto-generated
   - Ready for distribution

## Examples

### Scenario 1: Bug fix

```bash
git checkout main
git pull
git checkout -b fix/paste-timeout

# Fix the bug
echo "// Fixed timing issue" >> src/main/services/paste.ts

git commit -m "fix(paste): increase timeout to prevent premature exit"
git push origin fix/paste-timeout
```

**On push to `fix/paste-timeout`:**
- Pre-release created: `v0.1.1-rc.1`

**On merge to `main`:**
- Release created: `v0.1.1` (PATCH bumped)

### Scenario 2: New feature

```bash
git checkout -b feat/new-transcriber

# Implement new transcriber backend
git commit -m "feat(transcribe): add local LLM inference backend"
git commit -m "feat(transcribe): add model selection UI"
git push origin feat/new-transcriber
```

**On merge to `main`:**
- Release created: `v0.2.0` (MINOR bumped)

### Scenario 3: Breaking change

```bash
git commit -m "feat!: rename overlay IPC events to new schema"
# or
git commit -m "feat: migrate API

BREAKING CHANGE: IPC event names changed from dictation:* to recording:*"
```

**On merge to `main`:**
- Release created: `v1.0.0` (MAJOR bumped)

## Configuration Files

| File | Purpose |
|------|---------|
| `.releaserc.json` | Semantic-release configuration (branches, plugins, git commit rules) |
| `.commitlintrc.json` | Commit message validation rules |
| `.husky/commit-msg` | Local pre-commit hook (validates before push) |
| `.github/workflows/release.yml` | Production release workflow (main branch) |
| `.github/workflows/pre-release.yml` | Pre-release workflow (feature-style branches) |

## Git & GitHub Setup

### First time setup (after clone)

```bash
npm install
```

This automatically:
1. Installs dependencies
2. Sets up Husky hooks in `.husky/`
3. Enables commit message validation

### Verify setup

```bash
# Try an invalid commit (should be rejected)
git commit -m "update dependencies"

# Error message:
# ✖   subject may not be empty [subject-empty]
# ✖   type may not be empty [type-empty]
```

### Bypass validation (not recommended)

```bash
# Only in emergencies
git commit -m "..." --no-verify
```

## Free Tier Usage

- **GitHub Actions**: Free public/unlimited private minutes
- **Semantic-release**: Free, open-source
- **Husky + commitlint**: Free, locally installed
- **No external services needed** ✓

All versioning is self-contained within your repository.

## Troubleshooting

### Commit rejected for invalid message

**Error:**
```
✖   subject may not be empty [subject-empty]
✖   type may not be empty [type-empty]
```

**Fix:** Use conventional format:
```bash
git commit -m "feat(component): description of change"
```

### Husky hook not running

**Solution:**
```bash
npm install  # Reinstalls hooks
npx husky install
```

### Release workflow didn't create a release

**Reasons:**
- No commits on main since last release
- Commits don't follow conventional format (e.g., no `feat:` or `fix:`)

**Check workflow logs** in GitHub: `Settings → Actions → Workflow runs`

### Want to manually trigger release?

Use `workflow_dispatch` (requires code change):

```yaml
# In .github/workflows/release.yml
on:
  push:
    branches: [main]
  workflow_dispatch:  # ← Add this
```

Then trigger manually from GitHub: `Actions → Release → Run workflow`

---

**Questions?** Check `.releaserc.json` or `.commitlintrc.json` for detailed configuration options.
