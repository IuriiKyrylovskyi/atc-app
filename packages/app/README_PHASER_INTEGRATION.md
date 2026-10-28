# README_PHASER_INTEGRATION.md — RETIRED

> **This document is out of date and should not be used as a reference.**
> It described the game immediately after the initial Phaser 3 migration,
> before significant architecture work was done. Most of what it says is
> now wrong.

---

## What was wrong

| Topic              | What this file said                                                          | What is actually true                                                                                      |
| ------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| File structure     | `game/core/GameCore.ts`, `game/config/phaser.config.ts`                      | Neither file exists. `game_config.ts` is a tombstone. See `GameScene.ts`.                                  |
| Systems            | No systems mentioned                                                         | Six standalone systems now exist (see below)                                                               |
| Lives              | "Change starting lives: `maxLives: 5`"                                       | Lives were removed. One collision ends the level immediately.                                              |
| Collision distance | Described as `PLANE_SIZE = 40`                                               | Controlled by `collisionRadius` / `warningRadius` in `planes_config.ts`, compared via `CollisionSystem.ts` |
| Level config shape | Old `LevelConfig` with `difficulty`, `maxPlanes`, `targetScore`, `timeLimit` | Current shape uses fractional `centerX/Y` coords, no time limit, no target score                           |
| `GameCore.ts`      | Described as "Phaser wrapper for Vue"                                        | File does not exist. Vue↔Phaser integration lives in `useGame.ts` composable.                              |
| Last updated       | 2025-01-02                                                                   | Written before the architecture stabilised                                                                 |

---

## Where to look instead

| Topic                         | Current document                      |
| ----------------------------- | ------------------------------------- |
| Full project overview         | `README.md`                           |
| Architecture deep-dive        | `GAME_ARCHITECTURE_README.md`         |
| Onboarding for new developers | `DEVELOPER_ONBOARDING_GUIDE.md`       |
| Adding levels / backgrounds   | `LevelBackground_PositioningGuide.md` |
| Quick start + repo layout     | `TEAM_ONBOARDING.md`                  |

---

## Current systems (as of 2026-02-26)

```
src/game/systems/
├── CollisionSystem.ts   — RA/TA detection, collision circles
├── PathProcessor.ts     — path normalisation, smoothing, closest-index
├── SpawnSystem.ts       — type/colour selection, runway departure, edge spawn
├── WorldTransform.ts    — world↔screen coordinate conversions, viewport bounds
├── InputSystem.ts       — pointer drag, path processing, per-plane dot rendering
└── DrawSystem.ts        — entry-zone overlay, collision circle drawing
```

All systems are stateless objects that receive a context interface (`this` from `GameScene`).
`GameScene` is now orchestration-only — no spawn logic, no input handling, no path maths inline.

---

_Retired: 2026-02-26_
