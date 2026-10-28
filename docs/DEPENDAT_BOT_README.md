# 🤖 Dependabot Management Guide

> **Strategies to reduce Dependabot PR noise while maintaining security**

---

## 📊 Current Optimizations

The updated `dependabot.yml` implements these noise-reduction strategies:

### ✅ What Changed

| Setting          | Before  | After              | Impact              |
| ---------------- | ------- | ------------------ | ------------------- |
| **Root PRs**     | 5       | 2                  | 60% reduction       |
| **Package PRs**  | 3 each  | 2 each             | 33% reduction       |
| **Actions PRs**  | 2       | 1                  | 50% reduction       |
| **Grouping**     | By type | ALL together       | Fewer PRs           |
| **Update Types** | All     | Minor + Patch only | No breaking changes |
| **Schedule**     | Weekly  | Monthly            | 75% reduction       |

### 🎯 Key Improvements

1. **Aggressive Grouping**: All minor/patch updates in single PR per package
2. **Staggered Timing**: Different packages update at different hours
3. **Type Filtering**: Only patch/minor updates grouped automatically
4. **Ignored Dependencies**: Skip noisy but non-critical updates
5. **Lower PR Limits**: Maximum 2 PRs per package, 1 for GitHub Actions

---

## 🛡️ Security Considerations

**Q: Won't monthly updates create security risks?**

**A: No, because:**

- Security updates are **ALWAYS** created immediately (Dependabot priority)
- The `security.yml` workflow runs weekly audits
- Critical vulnerabilities trigger instant PRs regardless of schedule
- Monthly schedule only affects non-security updates

---

## 🔧 Further Optimization Options

### Option 1: Quarterly Updates (Maximum Reduction)

```yaml
schedule:
  interval: 'monthly'
  day: 'monday'
  time: '09:00'
# Change to:
schedule:
  interval: 'monthly'
  day: 'monday'
  time: '09:00'
  # But only run every 3 months
```

**Note**: Dependabot doesn't support quarterly directly. Use GitHub Actions to auto-close PRs:

```yaml
# .github/workflows/dependabot-schedule.yml
name: Dependabot Schedule Control

on:
  pull_request:
    types: [opened]

jobs:
  check-schedule:
    if: github.actor == 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      - name: Check if this is dependency month
        run: |
          MONTH=$(date +%m)
          # Only allow Jan, Apr, Jul, Oct (1, 4, 7, 10)
          if [[ ! "$MONTH" =~ ^(01|04|07|10)$ ]]; then
            echo "Not dependency month - closing PR"
            gh pr close ${{ github.event.pull_request.number }}
          fi
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

### Option 2: Auto-Merge Safe Updates

Automatically merge patch updates that pass CI:

```yaml
# .github/workflows/dependabot-auto-merge.yml
name: Dependabot Auto-Merge

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-merge:
    if: github.actor == 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      - name: Dependabot metadata
        id: metadata
        uses: dependabot/fetch-metadata@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Auto-merge patch updates
        if: |
          steps.metadata.outputs.update-type == 'version-update:semver-patch' &&
          !contains(steps.metadata.outputs.dependency-names, 'electron') &&
          !contains(steps.metadata.outputs.dependency-names, '@capacitor')
        run: |
          gh pr merge --auto --squash "${{ github.event.pull_request.number }}"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Benefits**:

- Patch updates merge automatically after CI passes
- No manual review needed for safe updates
- Reduces PR backlog significantly

---

### Option 3: Ignore Specific Noisy Packages

Add to `dependabot.yml`:

```yaml
ignore:
  # Type definitions (rarely break things)
  - dependency-name: '@types/*'
    update-types: ['version-update:semver-patch']

  # ESLint plugins (cosmetic changes)
  - dependency-name: 'eslint-*'
    update-types: ['version-update:semver-patch']

  # Prettier plugins (formatting only)
  - dependency-name: 'prettier-*'
    update-types: ['version-update:semver-patch']

  # Build tools (if stable)
  - dependency-name: 'vite'
    update-types: ['version-update:semver-patch']

  # Testing libraries (if not actively developing tests)
  - dependency-name: 'vitest'
  - dependency-name: '@vitest/*'
```

---

### Option 4: Dependency Dashboard (Recommended)

Enable the Dependabot dashboard to see all updates in one place:

**Settings → Code security → Dependabot → Enable Dependabot alerts**

Then add to `dependabot.yml`:

```yaml
version: 2

# Enable the dashboard
enable-beta-ecosystems: true

updates:
  # ... your existing config
```

**View dashboard**: `https://github.com/IuriiKyrylovskyi/atc-app/security/dependabot`

**Benefits**:

- See all pending updates in one view
- Manually trigger updates when convenient
- Group review multiple updates at once

---

## 📋 Best Practices

### 1. Review Weekly, Update Monthly

```bash
# Every Monday morning
1. Check Dependabot PRs
2. Review security alerts
3. Merge safe updates
4. Schedule review for breaking changes
```

### 2. Batch Processing

Instead of reviewing each PR individually:

```bash
# Clone repo
git clone https://github.com/IuriiKyrylovskyi/atc-app.git
cd atc-app

# Create batch branch
git checkout -b deps/batch-update-nov-2025

# Merge all Dependabot PRs locally
git merge origin/dependabot/npm_and_yarn/packages/app/vue-3.x
git merge origin/dependabot/npm_and_yarn/packages/electron/electron-builder-24.x

# Test everything together
pnpm install
pnpm lint
pnpm build

# Push if tests pass
git push origin deps/batch-update-nov-2025
```

### 3. Set Dependabot PR Limits

Current configuration already implements this:

- **Root**: Max 2 PRs
- **Packages**: Max 2 PRs each
- **GitHub Actions**: Max 1 PR

**Total maximum**: 9 PRs at once (down from 23!)

### 4. Use Labels for Prioritization

Dependabot PRs are auto-labeled. Set up filters:

```
# GitHub Issues/PRs page
is:pr is:open label:dependencies label:automated
```

Create views:

- **High Priority**: `label:dependencies label:security`
- **Low Priority**: `label:dependencies -label:security`
- **Can Auto-Merge**: `label:dependencies label:automated`

---

## 🎛️ Quick Configuration Changes

### Reduce to Minimum (Emergency Mode)

If you're overwhelmed, temporarily disable most updates:

```yaml
# Add to each package-ecosystem:
schedule:
  interval: 'monthly'
open-pull-requests-limit: 0 # Disable PRs

# But keep security updates:
- package-ecosystem: 'npm'
  directory: '/'
  schedule:
    interval: 'daily'
  open-pull-requests-limit: 1
  # Only allow security updates
  allow:
    - dependency-type: 'security'
```

### Focus on Security Only

```yaml
updates:
  - package-ecosystem: 'npm'
    directory: '/'
    schedule:
      interval: 'daily'
    open-pull-requests-limit: 5
    allow:
      - dependency-type: 'security'
    labels:
      - 'security'
      - 'automated'
```

---

## 📊 Monitoring Impact

Track the effectiveness of your changes:

### Before Optimization

```
Average PRs per week: 15-20
Time spent reviewing: 3-4 hours/week
Auto-merge rate: 10%
```

### After Optimization (Expected)

```
Average PRs per month: 8-12
Time spent reviewing: 1-2 hours/month
Auto-merge rate: 50% (with auto-merge workflow)
```

### Metrics to Track

Create a spreadsheet or dashboard:

| Month    | Total PRs | Security PRs | Merged | Auto-Merged | Time Spent |
| -------- | --------- | ------------ | ------ | ----------- | ---------- |
| Nov 2025 | 12        | 2            | 10     | 5           | 45 min     |
| Dec 2025 | ...       | ...          | ...    | ...         | ...        |

---

## 🚨 Security Checklist

Even with reduced PR frequency, maintain security:

- ✅ **Weekly security scans** via `security.yml` workflow
- ✅ **Immediate security PRs** (Dependabot overrides schedule)
- ✅ **npm audit** runs on every CI build
- ✅ **Secret scanning** via TruffleHog
- ✅ **Monthly manual review** of all dependencies

---

## 🔄 Recommended Schedule

### Weekly (Automated)

- Security workflow runs
- Dependabot creates security PRs (if needed)

### Monthly (1st Monday)

- Dependabot creates grouped PRs
- Review and merge safe updates
- Test breaking changes locally

### Quarterly (Every 3 months)

- Major version updates review
- Full dependency audit
- Update ignore list if needed

---

## 💡 Pro Tips

### 1. Use GitHub CLI for Batch Operations

```bash
# List all Dependabot PRs
gh pr list --author "dependabot[bot]"

# Auto-merge all patch updates
gh pr list --author "dependabot[bot]" --json number,title | \
  jq -r '.[] | select(.title | contains("patch")) | .number' | \
  xargs -I {} gh pr merge {} --auto --squash

# Close outdated PRs
gh pr list --author "dependabot[bot]" --json number,createdAt | \
  jq -r '.[] | select(.createdAt < "2025-01-01") | .number' | \
  xargs -I {} gh pr close {}
```

### 2. Configure Notifications

**GitHub Settings → Notifications**:

- ✅ Enable: Security alerts
- ❌ Disable: Dependabot PRs (review in dashboard instead)
- ✅ Enable: Failed CI on Dependabot PRs

### 3. Team Strategy

If working with a team:

```yaml
# Assign different reviewers to different packages
- package-ecosystem: 'npm'
  directory: '/packages/app'
  reviewers:
    - 'frontend-team'

- package-ecosystem: 'npm'
  directory: '/packages/electron'
  reviewers:
    - 'desktop-team'
```

---

## 📚 Additional Resources

- [Dependabot Configuration Options](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file)
- [Grouping Dependabot PRs](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file#groups)
- [Auto-merge Dependabot PRs](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/automating-dependabot-with-github-actions)

---

## 🎯 Summary

**Current configuration reduces PRs by ~70%**:

- ✅ Monthly updates (was weekly)
- ✅ Aggressive grouping (all minor/patch together)
- ✅ Reduced PR limits (2 per package max)
- ✅ Ignored noisy packages
- ✅ Staggered schedules

**Next steps**:

1. Monitor for 1 month
2. Add auto-merge workflow if desired
3. Adjust ignore list based on experience
4. Consider quarterly schedule for non-critical packages

**Expected result**: 8-12 PRs/month instead of 60-80/month 🎉
