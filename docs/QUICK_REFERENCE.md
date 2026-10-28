# 🚀 ATC-APP CI/CD Quick Reference

## 📋 Essential Commands

### Development

```bash
# Setup project (first time)
pnpm setup:dev

# Start development
pnpm dev                   # Web + Electron
pnpm dev:app               # Web only
pnpm dev:electron          # Electron only
pnpm dev:mobile            # Auto-detect platform

# Build
pnpm build                 # Web + Electron
pnpm build:app            # Web only
pnpm build:electron       # Electron only
```

### Quality Checks

```bash
# Run all checks
pnpm verify:env           # Check environment
pnpm format:check         # Check formatting
pnpm format               # Fix formatting
pnpm lint                 # Run ESLint
pnpm exec tsc -b --noEmit # TypeScript check
```

### Release Management

```bash
# 1. Bump version (reads commits, updates package.json + CHANGELOG.md, creates git tag)
pnpm run release

# 2. Push branch and tags
#    First time on a new branch:
git push --set-upstream origin dev && git push --tags
#    Subsequent pushes:
git push && git push --tags

# 3. Build Android AAB (versionCode auto-read from package.json)
pnpm android:bundle       # ← use this for store submission (AAB)
pnpm android:release      # APK only (sideloading/testing)

# 4. Build iOS — archive in Xcode
#    Product → Archive → Distribute App → App Store Connect → Upload

# Build Electron
pnpm dist:electron        # Desktop installer (.dmg / .exe)
pnpm mobile:build:release # Auto-detect mobile platform
```

> **Version code:** auto-derived from `package.json` — `0.0.31` → versionCode `31`.
> Never manually edit `versionCode` in `build.gradle`.

### Maintenance

```bash
# Clean builds
pnpm mobile:clean         # Remove mobile builds

# Regenerate app icons (after updating packages/mobile/assets/icon.png)
pnpm --filter @atc-app/app build && pnpm --filter @atc-app/mobile exec cap sync
pnpm --filter @atc-app/mobile run assets:generate

# Update dependencies
pnpm update               # Update all packages
pnpm audit                # Security audit
pnpm outdated             # Check outdated packages
```

---

## 🔄 GitHub Actions Workflows

### Automatic Triggers

| Workflow     | Trigger                   | Purpose                |
| ------------ | ------------------------- | ---------------------- |
| **CI**       | Push to `main`/`dev`, PRs | Quality checks, builds |
| **Release**  | Push tag `v*.*.*`         | Multi-platform release |
| **Security** | Weekly Monday 00:00 UTC   | Security scans         |

### Manual Triggers

```bash
# Via GitHub UI: Actions → [Workflow] → Run workflow

Version Bump:
  1. Go to Actions → Version Bump
  2. Select: patch/minor/major
  3. Click "Run workflow"

Security Scan:
  1. Go to Actions → Security Scan
  2. Click "Run workflow"
```

---

## 🏷️ Version Bump Types

| Command | Example       | Use When         |
| ------- | ------------- | ---------------- |
| `patch` | 1.0.0 → 1.0.1 | Bug fixes        |
| `minor` | 1.0.0 → 1.1.0 | New features     |
| `major` | 1.0.0 → 2.0.0 | Breaking changes |

---

## 📦 Release Artifacts

### Desktop (via GitHub Releases)

- 🪟 `ATC-APP-{version}-win.exe` - Windows installer
- 🍎 `ATC-APP-{version}-mac.dmg` - macOS disk image
- 🍎 `ATC-APP-{version}-mac.zip` - macOS archive
- 🐧 `ATC-APP-{version}-linux.AppImage` - Linux app

### Mobile (via GitHub Releases)

- 🤖 `app-release.aab` - Android App Bundle (for Google Play — required)
- 🤖 `app-release.apk` - Android APK (for sideloading/testing only)
- 📱 `App.app` - iOS bundle (requires signing for device)

> **Google Play requires AAB, not APK.** Use `pnpm android:bundle` for store submission.

---

## 🔐 Code Signing Setup

### Quick Setup Checklist

#### Android (Easiest)

```bash
# 1. Generate keystore
keytool -genkeypair -v -storetype PKCS12 \
  -keystore release.keystore -alias atc-app \
  -keyalg RSA -keysize 2048 -validity 10000

# 2. Encode to Base64
base64 -i release.keystore > keystore-base64.txt

# 3. Add GitHub Secrets:
# - ANDROID_KEYSTORE_BASE64 (content of keystore-base64.txt)
# - ANDROID_KEYSTORE_PASSWORD
# - ANDROID_KEY_ALIAS (e.g., "atc-app")
# - ANDROID_KEY_PASSWORD
```

#### Windows

```bash
# 1. Purchase certificate ($100-500/year)
# 2. Export as .pfx with password
# 3. Encode: certutil -encode cert.pfx cert-base64.txt
# 4. Add GitHub Secrets:
#    - WIN_CSC_LINK (Base64 content)
#    - WIN_CSC_KEY_PASSWORD
```

#### macOS

```bash
# 1. Apple Developer Account ($99/year)
# 2. Generate Developer ID Application certificate
# 3. Create app-specific password
# 4. Add GitHub Secrets (5 total - see SIGNING_GUIDE.md)
```

---

## 🛠️ Troubleshooting

### CI Fails

```bash
# 1. Check workflow logs
Go to: Actions → Failed workflow → View logs

# 2. Run locally
pnpm verify:env      # Check environment
pnpm format:check    # Check formatting
pnpm lint            # Check linting
pnpm exec tsc -b --noEmit  # Check types

# 3. Common fixes
pnpm format          # Auto-fix formatting
pnpm install         # Reinstall dependencies
```

### Build Fails

```bash
# Clean and rebuild
pnpm mobile:clean
pnpm install --frozen-lockfile
pnpm build

# Check Node version
node -v  # Should be >=20

# Check PNPM version
pnpm -v  # Should be >=9
```

### Release Not Created

```bash
# Verify pnpm release created the tag
git tag --list | grep v  # should show e.g. v0.0.31

# Verify tag was pushed (pnpm release creates tag, but you must push it)
git push --tags

# If tag was created but push failed, push it manually
git push origin v0.0.31  # replace with your version

# Verify tag format (must be v*.*.*)
git tag v1.0.0  # ✅ Correct
git tag 1.0.0   # ❌ Wrong — won't trigger release workflow

# Verify workflow file exists
ls .github/workflows/release.yml
```

---

## 📊 Monitoring

### Check CI Status

```
https://github.com/IuriiKyrylovskyi/atc-app/actions
```

### Check Security

```
https://github.com/IuriiKyrylovskyi/atc-app/security
```

### Check Releases

```
https://github.com/IuriiKyrylovskyi/atc-app/releases
```

### Check Dependencies

```
https://github.com/IuriiKyrylovskyi/atc-app/network/updates
```

---

## 🎯 Daily Workflow

### Feature Development

```bash
# 1. Create feature branch
git checkout -b feature/my-feature

# 2. Make changes
# ... code ...

# 3. Check quality locally
pnpm format
pnpm lint
pnpm exec tsc -b --noEmit

# 4. Commit (use conventional commits)
git commit -m "feat: add my feature"

# 5. Push and create PR (--set-upstream needed first time on new branch)
git push --set-upstream origin feature/my-feature
# or configure once globally to avoid this:
# git config --global push.autoSetupRemote true
# CI runs automatically on PR
```

### Creating Release

```bash
# Option A: Locally (recommended — version syncs to Android build.gradle automatically)
# 1. Bump version
pnpm run release

# 2. Push branch + tags (first time on branch needs --set-upstream)
git push --set-upstream origin dev && git push --tags
# or if upstream already set:
git push && git push --tags

# 3. Build stores
pnpm android:bundle       # Android AAB for Google Play
# Then archive in Xcode for iOS App Store

# Option B: Via GitHub Actions
# 1. Go to Actions → Version Bump
# 2. Select bump type → Run workflow
# 3. Wait for release workflow to complete
```

---

## 🔗 Important Links

### Documentation

- [README.md](../README.md) - Project overview and release workflow
- [ATC_APP_COMPLETE_README.md](../ATC_APP_COMPLETE_README.md) - Full system guide (game + backend + stores)
- [REVENUECAT_SETUP.md](../REVENUECAT_SETUP.md) - RC + App Store + Google Play setup
- [SUPABASE_SETUP.md](../SUPABASE_SETUP.md) - Backend setup
- [PlaneIcons.md](../packages/app/src/assets/PlaneIcons.md) - Plane sprite spec
- [LevelBackgrounds.md](../docs/LevelBackgrounds.md) - Level art spec
- [SIGNING_GUIDE.md](./SIGNING_GUIDE.md) - Code signing

### External Resources

- [Electron Builder](https://www.electron.build/)
- [Capacitor Docs](https://capacitorjs.com/docs)
- [GitHub Actions](https://docs.github.com/en/actions)
- [Standard Version](https://github.com/conventional-changelog/standard-version)

---

## 💡 Tips & Tricks

### Speed Up Builds

```bash
# Use PNPM cache
pnpm install --frozen-lockfile

# Clean before rebuild
pnpm mobile:clean
```

### Debug Workflow Locally

```bash
# Install act (GitHub Actions local runner)
# https://github.com/nektos/act

# Run CI workflow locally
act -j quality
```

### Skip CI on Commit

```bash
# Add [skip ci] to commit message
git commit -m "docs: update README [skip ci]"
```

### Force Re-run Failed Jobs

```bash
# In GitHub Actions UI:
Actions → Failed workflow → Re-run failed jobs
```

---

## 📞 Getting Help

1. **Check Documentation**: Start with [ATC_APP_COMPLETE_README.md](../ATC_APP_COMPLETE_README.md)
2. **Search Issues**: Someone might have faced same issue
3. **Check Logs**: Actions tab → Failed workflow → Logs
4. **Ask for Help**: Open GitHub issue with:
   - Error message
   - Workflow run link
   - Steps to reproduce

---

**Last Updated**: March 2026
**Quick Links**:

- [Actions](https://github.com/IuriiKyrylovskyi/atc-app/actions)
- [Releases](https://github.com/IuriiKyrylovskyi/atc-app/releases)
- [Security](https://github.com/IuriiKyrylovskyi/atc-app/security)
