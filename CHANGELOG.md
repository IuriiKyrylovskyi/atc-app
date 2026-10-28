# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## 0.0.0 (2026-10-28)

Initial atc-app baseline, ported from skymess (skymess commit `3f553ce`). Earlier history lives in the skymess repository.

### Features

* **app:** monorepo structure — `packages/app` (Vue 3 + Vite + Vuetify + Pinia), `packages/electron`, `packages/mobile` (Capacitor config) ([bde5520](https://github.com/IuriiKyrylovskyi/atc-app/commit/bde5520))
* **pages:** Intro splash and Home strip page; Paywall modal ([bde5520](https://github.com/IuriiKyrylovskyi/atc-app/commit/bde5520))
* **auth:** Supabase anonymous sign-in with alias + password restore, recovery word, claim purchase and unlink device ([bde5520](https://github.com/IuriiKyrylovskyi/atc-app/commit/bde5520))
* **router:** Intro and Home routes, splash back-guard, auth init guard, premium gate opening the paywall ([bde5520](https://github.com/IuriiKyrylovskyi/atc-app/commit/bde5520))
* **store:** monetization (auth, purchases, ads), settings, debug, api and auth stores ([bde5520](https://github.com/IuriiKyrylovskyi/atc-app/commit/bde5520))
* **tooling:** report skymess changes to ported files on every launch (`pnpm check:skymess`) ([bde5520](https://github.com/IuriiKyrylovskyi/atc-app/commit/bde5520))
* **tooling:** `pnpm typecheck` across app, electron and mobile ([bde5520](https://github.com/IuriiKyrylovskyi/atc-app/commit/bde5520))

### Bug Fixes

* **paywall:** debug panel read `navigator` from the template ([bde5520](https://github.com/IuriiKyrylovskyi/atc-app/commit/bde5520))
* **update:** Electron download/install buttons never ran (`isElectron.value` on a boolean) ([bde5520](https://github.com/IuriiKyrylovskyi/atc-app/commit/bde5520))
* **electron:** cancel an update download through a `CancellationToken` ([bde5520](https://github.com/IuriiKyrylovskyi/atc-app/commit/bde5520))
* **update:** automatic update checks read a settings field that did not exist ([bde5520](https://github.com/IuriiKyrylovskyi/atc-app/commit/bde5520))
* **auth:** unknown restore errors no longer log the device out ([bde5520](https://github.com/IuriiKyrylovskyi/atc-app/commit/bde5520))
