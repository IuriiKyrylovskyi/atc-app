# 🚀 ATC-APP — Team Onboarding

## Quick Start

```bash
git clone https://github.com/IuriiKyrylovskyi/atc-app.git
cd atc-app
pnpm setup:dev   # install deps, verify env, sync Capacitor
pnpm dev         # web + Electron dev servers
```

Navigate in browser: **Intro → Menu → Play Fields → Airfields → select airport → play**

## Tech Stack at a Glance

| Layer           | Technology                |
| --------------- | ------------------------- |
| UI / Navigation | Vue 3 + TypeScript        |
| Game engine     | **Phaser 3** (WebGL)      |
| State           | Pinia                     |
| Build           | Vite                      |
| Desktop         | Electron                  |
| Mobile          | Capacitor (iOS + Android) |
| Package manager | PNPM workspaces           |
| CI/CD           | GitHub Actions            |

## Repository Layout

```
atc-app/
├── packages/
│   ├── app/       # Vue + Phaser web application (shared by all platforms)
│   ├── electron/  # Electron desktop wrapper
│   └── mobile/    # Capacitor iOS + Android projects
├── scripts/       # Environment verification
└── .github/       # CI / release / security workflows
```

## Workflow

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Use Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
3. Run `pnpm lint && pnpm format:check` before pushing
4. Open a PR — CI runs automatically (lint, type-check, build)
5. Merge when all checks are green ✅

## Key Docs

| Doc                                   | What it covers                                                   |
| ------------------------------------- | ---------------------------------------------------------------- |
| `README.md`                           | Full project overview, scripts, project structure                |
| `DEVELOPER_ONBOARDING_GUIDE.md`       | Architecture deep-dive, current status, debugging                |
| `GAME_ARCHITECTURE_README.md`         | Phaser scene lifecycle, collision system, event flow             |
| `LevelBackground_PositioningGuide.md` | How to add new level backgrounds and configure runways/waypoints |

## Common Commands

```bash
pnpm dev              # Web + Electron (default)
pnpm dev:app          # Web only
pnpm dev:electron     # Electron only
pnpm dev:mobile       # Auto-detect mobile platform
pnpm build            # Production build
pnpm dist:electron    # Electron installer
pnpm android:release  # Android APK
pnpm ios:release      # iOS IPA
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm verify:env       # Check all required tools
pnpm mobile:clean     # Remove build artifacts
```

## Releases

Maintainers trigger releases via git tag or GitHub Actions workflow dispatch:

```bash
git tag v1.0.0
git push origin v1.0.0
# → CI builds all platforms and publishes to GitHub Releases
```

## Questions / Issues

- Open a [GitHub Issue](https://github.com/IuriiKyrylovskyi/atc-app/issues)
- Check existing docs in the repo root before asking
- For game-logic questions, start with `GAME_ARCHITECTURE_README.md`
