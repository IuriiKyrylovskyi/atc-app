# ATC-APP — Implementation TODO

Main tasks for building the simulator described in
[ATC_ARCHITECTURE.md](ATC_ARCHITECTURE.md). Section numbers (§) point there.
`docs/TODO.md` is the old skymess arcade backlog.

Workflow: every task gets its own branch `task/<name>` cut from `dev` and its own
worktree in `.claude/worktrees/<name>`. When the task is done and tests pass, it is
merged back into `dev` and the worktree is removed.

Legend: `[ ]` todo · `[x]` done · **⛔ Dn** blocked until decision n in §18 is made

---

## Decisions to make (§18)

**Policy (2026-10-28): free first.** Build everything on free sources; paid options are
documented in `PAID-ALT:` comments in code (`grep -rn "PAID-ALT" packages`). This settles
the defaults below; the open items are only about paid upgrades or permissions.

- [x] D1 Launch region — USA (FAA CIFP/NASR/d-TPP + OurAirports, free, public domain)
- [ ] D1b First airport / TMA for Phase 1 (one busy US Class B approach)
- [ ] D2 Navigraph bring-your-own — email dev@navigraph.com to confirm an ATC sim qualifies
- [ ] D3 Non-US packs — per-state licence review, EAD B2B quote
  - [ ] Ukraine: ask UkSATSE (pubs@uksatse.aero) for terms to use eAIP / ARINC 424 data in a commercial sim; Academy can use a school's own subscription ($1,200/yr non-resident)
- [x] D4 Live traffic default = adsb.lol (ODbL; our flight DB is shared under ODbL)
- [ ] D5 Premium live traffic — FR24 via Navigraph or direct licence quote
- [x] D6 STT models — Moonshine EN + Whisper (MIT), Vosk fallback (Apache-2.0), own fine-tune
- [x] D7 TTS — Kokoro (Apache-2.0) + Web Speech fallback, no cloud TTS
- [ ] D8 Online engine hosting — free: self-hosted open models on our own server (infra cost only); PAID-ALT Groq / cloud GPU later
- [ ] D9 Pricing — plans in §13.6; plan a price test
- [ ] D10 Academy — first pilot school, cloud tenant first
- [ ] D11 Scenario intent input — form + grammar parser first

---

## Phase 0 — Foundations (no blockers, can start now)

- [x] Add workspace packages `sim` (full), `atc-data`, `voice`, `traffic`, `scenario` (stubs with free stack + `PAID-ALT` notes)
- [x] Add root `pnpm test` and CI step running tests + typecheck
- [x] Geodesy: distance / bearing / destination on WGS-84 (geographiclib) + tests against reference values
- [x] Stereographic projection (geodetic ↔ local metres, proj4 `sterea`) + tests
- [x] Magnetic variation (WMM-2025 via `geomagnetism`) true ↔ magnetic + tests
- [x] Atmosphere: ISA, CAS ↔ TAS ↔ Mach, crossover altitude + tests
- [x] TypeScript types: `AirspacePack`, `Aircraft`, `Clearance`, `Message`, `Snapshot`, `SimEvent`
- [x] JSON schema for packs (zod in `atc-data`, synced with sim types at compile time, JSON Schema export)
- [ ] `ScenarioSpec` type — with the scenario generator (Phase 7)
- [x] Sim clock: fixed step 0.5 s, carry-over of fractional time (sweep timing, pause and time compression are the driver's job — Phase 1 scope loop)
- [x] Seeded RNG + event log (every clearance / alert / event timestamped)
- [x] Snapshot / restore of full sim state (needed for wind, reset, branch)
- [x] Bridge: typed request/response over any port (`PortLike`) + in-memory port pair
- [x] Browser `Worker` adapter (`app/src/workers/sim.worker.ts`, main-thread fallback)
- [ ] Node `worker_threads` adapter (Electron / Academy server)
- [x] Minimal aircraft: heading hold, standard-rate / bank-limited turns, altitude change, speed change, 250 kt < FL100, direct-to, uniform wind
- [x] Headless test: fly heading + direct-to, assert positions/times
- [x] Determinism test: same seed + same clearances ⇒ identical state and event log

## Phase 1 — US data + scope MVP + text commands

- [x] Importer: OurAirports (airports + both runway directions, displaced thresholds, filters)
- [x] Importer: FAA CIFP (ARINC 424) — airports, runways + ILS, waypoints, navaids, airways, SID/STAR/IAP legs (all 23 path terminators); `pnpm data:cifp` fetches the AIRAC file into `db/`
- [ ] CIFP: controlled / restrictive airspace (UC / UR boundaries with arcs), MSA, holds (EP)
- [ ] Importer: FAA NASR (frequencies, airspace classes, MVA charts)
- [x] Pack builder CLI `pnpm pack:build <id>|--all`: definitions in `packs/*.pack.json`, CIFP + OurAirports, AIRAC-versioned output + manifest (size, sha256, counts, sources)
- [x] Pack validation: schema, publishable licences, unique ids, runway length/heading geometry, references, areas
- [x] Runway cross-check CIFP ↔ OurAirports (NY TMA: median 3.8 m) + diff vs. previous AIRAC build
- [x] Packs served with the app: `/packs/manifest.json` + pack files (dev middleware, copied into builds), validated on load
- [ ] Pack hosting in Supabase Storage + manifest/hash download in the app
- [ ] ⛔ D1b First pack for the chosen TMA
- [x] `ScopeView` (`packages/scope`): pan / zoom at cursor / pinch / range presets / north-up
- [x] Scope static layers (Canvas 2D): airways, fixes, navaids, airports, runways, ILS extended centrelines with 1 NM ticks, declutter by range, non-overlapping labels
- [ ] Scope layers: SID/STAR/approach paths, airspace areas, MVA
- [x] Traffic on scope: sim in a Web Worker, one advance per radar sweep (4.8 s, ASR-9), pause / ×1 ×2 ×4 ×8
- [x] Targets: symbol, history dots, speed vector (0/1/2/4 min), leader line, click to select + info panel
- [x] Full data block: callsign / altitude, trend, assigned level, ground speed / type, destination; numpad leader direction
- [ ] Data blocks: configurable fields, limited blocks, drag, auto-deconflict
- [x] Sim: route following (fix sequence), vectors keep the route, direct-to shortcuts it, resume own navigation; scheduled spawns
- [x] Scripted scenarios (`packages/scenario`): STAR routes from the pack, NY arrivals (7 aircraft on CAMRN5 / PARCH4 / PAWLN1 / PUCKY1 / MIP4 / PHLBO4 / FLOSI4), `?scenario=<id>|none`
- [x] Range rings, scale bar, cursor lat/lon + bearing/distance readout
- [ ] Range/bearing tool, day/night palette
- [ ] OpenAP export to JSON for ~15 types + type-to-reference mapping
- [ ] Flight model v1: climb/descent by type, accel/decel, 250 kt < FL100, wind triangle
- [x] Text command syntax (`DAL123 FL120 H240 S220`) → `Message` + validation (`packages/voice` command.ts): FL/A/C/D, H/L/R, TL/TR, S/M, DCT, SQ, RON; callsign by unique ending or selection; climb/descend sanity check
- [x] Scope command line: live phraseology preview, ↑/↓ history, comms log (instruction, readback, pilot "unable" from sim rejections); click a target to command it
- [ ] Command line: Tab-complete callsigns / fixes, approach clearances (ILS, visual), "expedite", vertical rate
- [x] Separation monitor in the sim (3 NM / 1 000 ft terminal, configurable) + STCA: linear prediction with cleared-level cut-off, 120 s look-ahead, events (alert, lost, restored with min distance/duration, ended), conflicts in every snapshot
- [x] Scope: red targets/data blocks with blinking "CA", pair line (dashed predicted / solid lost) with time-to-loss or distance label, CA count, CA/LOS/SEP lines in the comms log
- [x] Conflict drill scenario over COL (head-on, crossing, 1 000 ft control pair) + scenario picker on the scope
- [ ] Wake turbulence separation on final, 5 NM enroute minima per sector, turn-aware STCA prediction
- [ ] MSAW (needs MVA data) and area infringement (needs UC/UR airspace)
- [x] Route `/scope/:packId` behind a feature flag (dev builds or `VITE_FEATURE_SCOPE=true`), no account needed
- [ ] Open the scope from Control Center
- [ ] Performance check: 100 aircraft at 60 fps on a mid-range laptop

## Phase 2 — Phraseology + readback

- [ ] Chevrotain grammar: altitude, heading, turn, speed, direct, squawk, contact, approach/landing clearance
- [ ] Number normaliser (FL, thousands, "niner", decimals, NATO alphabet)
- [x] Telephony designators: starter table (23 operators) + NATO / digit spelling for registrations
- [ ] Full ICAO telephony table (import) + abbreviated callsigns
- [ ] Multi-clearance transmissions → `Message`; out-of-grammar ⇒ "say again"
- [ ] Phrase corpus ≥ 500 tests (text → expected `Message`)
- [x] Readback generator v0: FAA phraseology, callsign last, text + spoken (TTS) forms, "unable"
- [ ] Readback rules per region (ICAO Doc 4444 wording), wrong-readback injection
- [ ] `TextToSpeech` interface: Kokoro (kokoro-js) + Web Speech fallback
- [ ] Per-aircraft voice/accent + VHF radio effect
- [ ] Pilot model: reaction delay, "unable", requests

## Phase 3 — Voice engines

- [ ] Push-to-talk UX (space bar, on-screen hold button) + mic permissions (web, Electron, iOS, Android)
- [ ] Audio capture 16 kHz mono + VAD trimming
- [ ] `SpeechToText` interface + embedded engine (Moonshine / Whisper via transformers.js, whisper.cpp in Electron)
- [ ] Model tiers + lazy download + caching (OPFS / Cache Storage / app files)
- [ ] Device capability detection → tier A/B/C/D (§11.2)
- [ ] Context biasing (live callsigns, fixes, runways, frequencies)
- [ ] Grammar re-scoring of n-best results
- [ ] ⛔ D8 Online engine: voice gateway in `packages/server` + GPU inference (faster-whisper + Kokoro), Groq fallback
- [ ] Per-user online-voice quotas + budget alarms + fallback to embedded/text
- [ ] ASR benchmark set (real voices) + WER report on callsigns/numbers
- [ ] Synthetic fine-tune dataset: grammar sentences → Kokoro voices/accents → radio augmentation
- [ ] First fine-tuned model + benchmark gate
- [ ] Latency targets: < 1.0 s tier A, < 1.5 s online

## Phase 4 — Procedures, approaches, charts

- [ ] FMS: ARINC 424 legs (IF, TF, CF, DF, RF, CA, VA, VM, VI, FA, HM), fly-by/fly-over
- [ ] Altitude / speed constraints (VNAV), holds
- [ ] ILS / LOC / GS capture, approach clearance, landing
- [ ] SIDs / STARs / approaches drawn on the scope (toggleable)
- [ ] Chart PDF: pdf.js render, upload, storage
- [ ] Georeferencing UI: control points, least-squares fit, residual in NM
- [ ] Chart underlay layer (opacity, toggle), ≤ 0.2 NM alignment test
- [ ] Digitising editor: trace fixes / areas / MVA into a pack
- [ ] AIRAC scheduled rebuild job + client delta update

## Phase 5 — Traffic

- [ ] adsb.lol live adapter + server-side poller per region + fan-out
- [ ] Seed sim aircraft from live data (type, callsign, position, FL, speed)
- [ ] Filters: ground clutter, military/blocked aircraft, privacy block lists
- [ ] 7-day flight DB job: ingest daily dump → segment flights → ADEP/ADES → type/airline
- [ ] Route inference (map-matching to airways / SID / STAR) → inferred flight plan
- [ ] Parquet on R2 + query layer; rolling 7 days; ODbL attribution + DB publication
- [ ] Replay picker: airport + date/time from the last 7 days
- [ ] `TrafficDirector`: target intensity, synthetic top-up, realistic airline/type mix
- [ ] Conflict injection for training
- [ ] Real METAR/TAF (aviationweather.gov) → wind, QNH, runway in use

## Phase 6 — Training Center, scoring, any-device polish

- [ ] Lesson format + runner + objectives
- [ ] Scoring from the event log; debrief screen with replay
- [ ] First lesson track (6–8 lessons); wire Training Center strips to lessons
- [ ] Progress sync to Supabase
- [ ] PWA: install, offline packs + models, Service Worker
- [ ] Touch UX: pinch/pan, tap select, PTT button, quick-command radial menu, landscape layout
- [ ] Mid-range phone performance pass
- [ ] ⛔ D9 New plans in RevenueCat (Cadet / Controller / Supervisor) + entitlements + fair-use quotas

## Phase 7 — Academy MVP

- [ ] Server-authoritative sim in Node + WebSocket clients
- [ ] Multi-seat sectors (APP / TWR / ACC) + handoffs
- [ ] Roles: trainee, instructor, pseudo-pilot, observer
- [ ] Instructor station: pause, inject, take over aircraft, annotate timeline
- [ ] Session timeline: snapshots per sweep, wind / rewind / reset / branch
- [ ] ⛔ D11 Scenario generator (§14.4): spec form + text parser
- [ ] Conflict planner (back-propagation from conflict point/time)
- [ ] Monte Carlo validator (requested conflicts happen, none unplanned, solvable)
- [ ] Difficulty ranker + 3–5 proposals with ghost-track preview + re-roll
- [ ] Infeasibility explanation + nearest feasible spec
- [ ] Live re-plan + scenario library versioning
- [ ] Event library: volume, conflicts, TCAS, MAYDAY / PAN PAN, 7500/7600/7700, weather, restrictions, equipment
- [ ] Assessment rubrics (ATCO competencies) + PDF reports
- [ ] ⛔ D10 Dedicated tenant template (own Supabase, SSO, EU region)
- [ ] On-prem Docker bundle + offline licence activation

## Phase 8 — Expansion

- [ ] ⛔ D2 Navigraph bring-your-own (navdata + charts)
- [ ] ⛔ D3 Licensed non-US packs
- [ ] ⛔ D5 Premium live traffic
- [ ] More aircraft types, voices, languages (national phraseology)
- [ ] ATIS generation, CPDLC
- [ ] Retire the skymess arcade engine

## Cross-cutting (any time)

- [ ] Disclaimer: not for real-world navigation or operational use
- [ ] Privacy: voice consent flow, no audio stored by default, GDPR notes, DPA for Academy
- [ ] Accessibility: text-only mode, colour-blind palettes, scalable data blocks, captions
- [ ] Opt-in telemetry for recognition failures and device performance
- [ ] Golden replays + visual regression tests for the scope
- [ ] Update `.skymess-sync.json` after pulling skymess fixes
