# Contributing to ATC-APP

Thank you for your interest in contributing to ATC-APP! This document provides guidelines and workflows for contributors.

---

## 🚀 Quick Start

### Prerequisites

- Node.js >= 20
- PNPM >= 9
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/IuriiKyrylovskyi/atc-app.git
cd atc-app

# Install dependencies and setup
pnpm setup:dev

# Start development
pnpm dev
```

---

## 📋 Development Workflow

### 1. Create a Feature Branch

```bash
# Always branch from main
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

### 2. Make Your Changes

- Write clean, maintainable code
- Follow existing code style
- Add comments for complex logic
- Test your changes locally

### 3. Commit Your Changes

We use **Conventional Commits**:

```bash
# Format: <type>: <description>

# Types:
feat: Add new feature
fix: Bug fix
docs: Documentation changes
style: Code style changes (formatting, etc.)
refactor: Code refactoring
test: Add or update tests
chore: Maintenance tasks
ci: CI/CD changes
perf: Performance improvements
```

**Examples:**

```bash
git commit -m "feat: add dark mode toggle"
git commit -m "fix: resolve navigation bug on mobile"
git commit -m "docs: update API documentation"
```

### 4. Push and Create Pull Request

```bash
# Push your branch
git push origin feature/your-feature-name

# Create PR on GitHub
# CI will run automatically
```

---

## ✅ Pull Request Guidelines

### Before Submitting

Run these checks locally:

```bash
# Format code
pnpm format

# Run linter
pnpm lint

# Type check
pnpm exec tsc -b --noEmit

# Build test
pnpm build
```

### PR Title

Use conventional commit format:

- ✅ `feat: add user authentication`
- ✅ `fix: resolve login issue`
- ❌ `Updated files`
- ❌ `bug fix`

### PR Description

Include:

- **What**: What changes did you make?
- **Why**: Why were these changes needed?
- **How**: How did you implement them?
- **Testing**: How did you test the changes?

**Template:**

```markdown
## Changes

- Added feature X
- Fixed bug Y

## Why

This addresses issue #123 and improves user experience.

## Testing

- [ ] Tested locally
- [ ] All CI checks pass
- [ ] Tested on multiple browsers/devices (if UI changes)
```

---

## 🔍 Code Review Process

1. **CI Checks**: All checks must pass (✅ green)
2. **Code Review**: At least 1 approval required
3. **Resolve Comments**: Address all review feedback
4. **Merge**: Squash and merge when approved

---

## 🏗️ Project Structure

```
atc-app/
├── packages/
│   ├── app/           # Vue 3 web application
│   ├── electron/      # Electron desktop wrapper
│   └── mobile/        # Capacitor mobile apps
├── docs/              # Documentation
├── .github/
│   └── workflows/     # CI/CD pipelines
└── scripts/           # Build and utility scripts
```

---

## 🧪 Testing

### Run Tests

```bash
# Unit tests
pnpm test

# E2E tests (if available)
pnpm test:e2e

# Coverage
pnpm test:coverage
```

---

## 📦 Building

### Development Build

```bash
pnpm build
```

### Platform-Specific Builds

```bash
# Desktop
pnpm dist:electron

# Android
pnpm android:release

# iOS
pnpm ios:release
```

---

## 🐛 Reporting Issues

### Before Creating an Issue

1. Search existing issues
2. Check if it's already fixed in `main`
3. Gather reproduction steps

### Issue Template

```markdown
**Description**
Clear description of the issue

**Steps to Reproduce**

1. Go to...
2. Click on...
3. See error

**Expected Behavior**
What should happen

**Actual Behavior**
What actually happens

**Environment**

- OS: [e.g., Windows 11]
- Browser: [e.g., Chrome 120]
- Version: [e.g., v1.0.0]

**Screenshots**
If applicable
```

---

## 🔒 Security

If you discover a security vulnerability:

1. **DO NOT** open a public issue
2. Email: [your-security-email@example.com]
3. Include details and steps to reproduce
4. Allow time for patching before disclosure

---

## 📚 Additional Resources

- [Quick Reference](docs/QUICK_REFERENCE.md) - Common commands
- [CI/CD Overview](docs/CI_CD_OPTIMIZATION_SUMMARY.md) - Pipeline details
- [Code Signing Guide](docs/SIGNING_GUIDE.md) - Release signing

---

## ❓ Questions?

- Check documentation in `docs/`
- Search closed issues
- Ask in discussions
- Contact maintainers

---

## 🙏 Thank You!

Your contributions make ATC-APP better for everyone!

---

**Happy coding!** 🚀
