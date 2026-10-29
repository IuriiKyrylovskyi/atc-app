# ATC-APP — Architecture & Implementation Plan

> Status: **draft v2** (2026-10-28). Supersedes the game-layer parts of
> `docs/GAME_ARCHITECTURE_README.md`, which describes the skymess arcade engine
> (pixel world, bitmap backgrounds, drag-a-path control). App shell, auth,
> monetization and stores stay as they are.
>
> v2 adds: chart data sourcing/licensing/updates (§5), precise drawing (§6),
> on-device vs. online voice engines (§8), real + augmented traffic and the
> 7-day flight DB (§9), any-device/browser support (§11), cost model and
> subscription pricing (§13), Flight School edition (§14) with the automated
> scenario generator (§14.4), further topics (§15).
>
> Prices and licence terms below were checked in Oct 2026 from public sources
> (see §19). Several vendors publish no price list — those are marked
> **"quote"** and must be confirmed before committing.

---

## 1. What we are building

An **air traffic control simulator** played on a radar scope that looks and
behaves like a real ATC working position.

| Mode | Who | What |
|---|---|---|
| **Training Center** | Trainee controller | Graded sessions with a defined goal (e.g. "vector 4 arrivals to ILS 27", "resolve a crossing conflict"). Scripted traffic, instructor rules, score. |
| **Working Position** | Qualified controller | Open-ended shift on a real sector/approach. Traffic from scenarios, from real-world flights, or both. |
| **Academy (B2B)** | Flight / ATC schools | Isolated deployment, instructor station, scenario service, multi-trainee sessions (§14). |

Core differences from the current arcade game:

1. **Real charts** — approach / en-route areas drawn precisely from real data; a chart PDF can be added and overlaid on the scope.
2. **Real aircraft performance.**
3. **Voice control** — speech → text → command → aircraft, with spoken pilot readbacks.
4. **Phraseology first** — release 1 accepts only standard ICAO phraseology.
5. **Real-world traffic** — seeded from live ADS-B data and topped up with simulated traffic when it is quiet.

---

## 2. Design principles

- **The simulation is the source of truth; the scope only draws it.** Sim code is plain TypeScript with no Phaser, Vue or DOM imports, so the same code runs in a Web Worker (single player), in Node (multi-seat / Academy server) and in tests.
- **Geodetic world.** Everything is WGS-84 lat/lon + altitude (ft) + time. Screen pixels exist only in the renderer.
- **Commands, not gestures.** Aircraft change only through `Clearance` objects. Voice, keyboard and mouse are three ways to produce one.
- **Deterministic and replayable.** Fixed timestep, seeded randomness, every clearance logged ⇒ any session can be replayed and graded.
- **Data packs, not code, per airport/sector.** Adding an airport means adding data.
- **Capability tiers, not platform forks.** One web codebase; features switch by detected device capability (§11).
- **Free first.** The first complete implementation uses only free, commercially usable
  data, models and libraries. Wherever a paid option would be better, the code says so in a
  `PAID-ALT:` comment at the point it would plug in (what it is, why it is better, price),
  so `grep -rn "PAID-ALT" packages` lists every upgrade path.
- **Licence-clean by construction.** Every dataset carries its source and licence in the pack metadata; the build refuses to publish a pack whose licence does not allow it.

---

## 3. System overview

```
┌──────────────────────────────── Vue app (existing shell) ───────────────────────────────┐
│  Intro · Home strips · Training Center · Working Position · System Config · Paywall      │
│  Pinia stores (monetization, settings, progress, session)                                │
└───────────────┬───────────────────────────────────────────────────────────┬─────────────┘
                │ UI events / session control                               │ state snapshots
                ▼                                                           │
┌──────────────────────── Scope renderer (main thread, Phaser/WebGL) ──────────────────────┐
│  Video map · targets · data blocks · leader lines · history dots · range rings ·         │
│  RBL tool · STCA highlights · chart PDF underlay                                         │
└───────────────┬──────────────────────────────────────────────────────────────────────────┘
                │ select target / quick commands
                ▼
┌──────────────────────── Command layer (main thread) ─────────────────────────────────────┐
│  PTT → STT engine (on-device | online) → phraseology parser → Clearance[] → validation   │
│  Keyboard / mouse quick-commands ─────────────────────────────▶ Clearance[]              │
│  Readback generator → TTS engine (on-device | online) + radio FX                         │
└───────────────┬──────────────────────────────────────────────────────────────────────────┘
                │ Clearance                                  ▲ Snapshot (per radar sweep)
                ▼                                            │
┌───────── Simulation core (Web Worker locally, or Node on the Academy/session server) ────┐
│  SimClock · Aircraft[] (performance + FMS + pilot model) · Airspace · Separation (STCA,  │
│  MSAW, TCAS model) · Traffic driver (real + synthetic) · Event injector · Event log      │
└───────────────┬──────────────────────────────────────────────────────────────────────────┘
                │ load
                ▼
┌──────────────────────── Data layer ──────────────────────────────────────────────────────┐
│  Airspace packs (AIRAC-versioned) · Aircraft performance DB · Chart store (PDF+georef) · │
│  Traffic service (live + 7-day DB) · Scenario service · Weather (METAR/TAF) · Supabase   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

Target package layout:

```
packages/
  app/            Vue shell + scope renderer + command layer (existing)
  sim/            NEW — pure TS simulation core (Worker + Node), unit-tested
  atc-data/       NEW — pack schemas, importers (CIFP / NASR / AIXM / OurAirports),
                  chart georeferencing, AIRAC pack builder CLI
  voice/          NEW — phraseology grammar, parser, readback generator,
                  STT/TTS engine adapters (on-device + online)
  traffic/        NEW — live feed adapters, 7-day flight DB builder, route inference,
                  synthetic traffic generator
  scenario/       NEW — intent → spec parser, conflict planner, Monte Carlo validator,
                  difficulty ranker, scenario library (§14.4)
  server/         NEW (replaces the empty skymess one) — session server for multi-seat /
                  Academy, online voice gateway, traffic fan-out
  electron/ mobile/ (existing)
```

---

## 4. Domain model

### 4.1 Coordinates

| Space | Units | Used by |
|---|---|---|
| Geodetic | lat/lon (deg, WGS-84), altitude ft (MSL / FL), time s | storage, sim |
| Local tangent plane | metres east/north of the sector reference point (float64) | sim math |
| Scope | screen px | renderer only |

Projection: **stereographic** centred on the sector reference point (what radar
displays use). `WorldTransform` is replaced by `Projection` (geodetic ↔ local)
and `ScopeView` (local ↔ screen with pan/zoom/rotation and NM range).

### 4.2 Airspace (static, from packs)

```ts
Airport   { icao, iata, name, arp: LatLon, elevationFt, magVar, transitionAlt, transitionLevel }
Runway    { id, airport, threshold: LatLon, end: LatLon, headingTrue, lengthM, widthM,
            thresholdElevFt, displacedM, ils?: { course, gsAngle, faf, tch } }
Fix       { id, kind: 'waypoint'|'vor'|'ndb'|'dme'|'rnav', pos: LatLon }
Airway    { id, segments: { from, to, minAlt, maxAlt }[] }
Procedure { id, kind: 'SID'|'STAR'|'IAP', runway?, transition?, legs: Leg[] }
Leg       ARINC 424 path/terminator (IF, TF, CF, DF, RF, VA, VM, VI, CA, FA, HM, …)
          + altitude/speed constraints + fly-over/fly-by
Area      { id, kind: 'CTR'|'TMA'|'sector'|'restricted'|'danger'|'prohibited'|'TRA'|'TSA',
            polygon, floorFt, ceilingFt, schedule? }
Mva       { polygon, minAltFt }
VideoMap  { layers: { id, style, geometry }[] }
PackMeta  { id, airac: '2611', sources: { name, licence, url, retrieved }[] }
```

### 4.3 Aircraft (sim)

```ts
Aircraft {
  callsign, icaoType, wake, squawk, origin: 'live'|'history'|'synthetic'|'scenario',
  pos, altFt, headingTrue, trackTrue, cas, tas, gs, mach, vsFpm,
  target: { altFt?, headingMag?, turnDir?, cas?, mach?, vsFpm?, direct?, procedure?, approach?, hold? },
  mode: { lateral: 'HDG'|'LNAV'|'LOC'|'HOLD', vertical: 'ALT'|'FLCH'|'VS'|'VNAV'|'GS' },
  fms: { route: Leg[], activeLeg, constraints },
  flightPlan: { adep, ades, route, rfl, cruiseTas, sid?, star?, source: 'filed'|'inferred'|'synthetic' },
  phase, tcas: { state: 'clear'|'TA'|'RA', sense? },
  emergency?: { kind, declared: 'MAYDAY'|'PAN PAN', squawk? },
  pilot: { reactionDelayS, readbackStyle, voiceId, accent }
}
```

### 4.4 Clearance

```ts
Clearance =
  | { kind: 'altitude', mode: 'climb'|'descend'|'maintain', altFt | fl, rate? }
  | { kind: 'heading', heading, turn?: 'left'|'right' } | { kind: 'turn', degrees, direction }
  | { kind: 'speed', cas? | mach?, qualifier? } | { kind: 'direct', fix }
  | { kind: 'procedure', proc, transition? } | { kind: 'approach', type, runway, cleared }
  | { kind: 'hold', fix, inbound?, turns?, legNm? } | { kind: 'squawk', code }
  | { kind: 'contact' | 'monitor', station, freq } | { kind: 'landing' | 'takeoff', runway, wind? }
  | { kind: 'resume_own_navigation' } | { kind: 'cancel', of }
Message = { to: callsign, clearances: Clearance[], spokenText, confidence, recognisedAt }
```

---

## 5. Issue 1 — Chart data: source, licensing, updates

### 5.1 What "chart data" means here

Two different things, handled separately:

| Need | Form | Used for |
|---|---|---|
| **Navigation data** | Coordinates of fixes, runways, procedures, airways, airspace | Precise drawing on the scope + flying the aircraft |
| **Chart images** | The published PDF (approach plate, STAR, enroute chart) | Visual reference / underlay, digitising missing items |

Precision comes only from navigation data. A PDF is a picture; it is never the
source of truth for coordinates.

### 5.2 Sources and licences

| Source | Content | Cost | Licence / use in a paid game |
|---|---|---|---|
| **FAA CIFP** (ARINC 424) + **NASR** | All US procedures, fixes, airways, airspace, runways | Free | US Government work, public domain — OK |
| **FAA d-TPP** (chart PDFs) | US approach/SID/STAR plates | Free | Public domain — OK to display |
| **OurAirports** | Airports + runway thresholds worldwide | Free | Public domain — OK (quality varies; verify) |
| National eAIPs (EU/UK/other) | Full national data + chart PDFs | Free to view | Per state; Eurocontrol EAD Basic allows **non-commercial** redistribution only; commercial access via paid EAD B2B or per-state agreement — **quote** |
| **OpenAIP** | Airspace, navaids, airports worldwide | Free | CC BY-NC — commercial use needs a licence — **quote** |
| **Navigraph** (bring-your-own subscription) | Worldwide navdata via API; charts | €0 for us; user pays Navigraph | Navigraph licenses the **end user**, not the developer. Navdata via their API; charts allowed only inside a "virtual environment" app — we must confirm an ATC sim qualifies (dev@navigraph.com) |
| Jeppesen / Lufthansa Systems (Lido) | Worldwide, commercial grade | **quote** (enterprise) | Commercial licence |
| **Customer-supplied** (Academy) | School's own AIP/charts | €0 | School's own licence; data stays in their tenant (§14) |
| **AIS of Ukraine** (UkSATSE, aisukraine.net) | eAIP (+ AMDT/SUP/AIC/NOTAM list), charts, **ARINC 424 database download** (login-gated) | Annual subscription: eAIP **$1,200/yr** non-resident (UAH 32,400 resident), VFR guide $186, PIB $150 (AIC A 03/25) | "All rights reserved"; subscription is an access licence, not redistribution — consumer use needs a written agreement (pubs@uksatse.aero). Academy: school's own subscription as customer-supplied data. ARINC 424 format fits our CIFP importer. Civil airspace closed since 2022 ⇒ no live traffic there, synthetic/recorded scenarios only |
| aip.aero (AIP:Aero) | Aggregator: links to official AIP/charts; JSON API with aerodrome data (coords, runways, frequencies, chart links, METAR/NOTAM) | API €0 / €29 / €99 / from €249 per month | Publishes no AIP data itself and states no data licence; no fixes, airways or procedure geometry ⇒ not a navdata source; at most a chart-link index |

**Decision (proposal):**

1. **Launch content = United States** (CIFP + NASR + d-TPP + OurAirports): free, legal, global-quality, fully automatable.
2. **Worldwide for consumers = Navigraph bring-your-own** (user links their Navigraph account; we render navdata + charts in-session, nothing redistributed). Confirm eligibility first.
3. **Europe/other in-house packs** only after a per-state licence check (Ukraine: UkSATSE agreement needed, §5.2); start with states whose eAIP terms allow commercial reuse, budget for EAD B2B if needed.
4. **Academy** customers bring their own charts/AIP into their isolated tenant.

### 5.3 Updates (AIRAC)

- Navigation data changes on the **28-day AIRAC cycle**. Packs are versioned by AIRAC id (`KJFK@2611`).
- `pack:build` runs as a scheduled job per cycle: download CIFP/NASR → import → validate (schema + geometry checks + diff report vs. previous cycle) → publish to Supabase Storage → clients fetch only changed packs (manifest + hashes).
- Scenarios reference fix names; the builder flags scenarios broken by a cycle change.
- Navigraph-linked data refreshes automatically on the user's account cycle.
- Chart georeferences are tied to the PDF hash; a new chart edition requires re-georeferencing (control points are re-suggested automatically from fix positions).

---

## 6. Issue 2 — Drawing the ATC area precisely

Precision budget: **≤ 10 m** for fixes/thresholds against published coordinates; **≤ 0.2 NM** for chart underlay alignment.

- **Geodesy:** Karney algorithms (`geographiclib`, MIT) for distance/bearing/destination on WGS-84 — no flat-earth shortcuts.
- **Magnetic variation:** World Magnetic Model (public domain coefficients) to convert published magnetic courses/headings to true, per epoch.
- **Procedure geometry:** ARINC 424 leg builder — TF/CF/DF straight legs, RF arcs (centre + radius), course-to-altitude legs computed with the aircraft's own climb performance, fly-by turn anticipation, holding patterns from published inbound course/leg time.
- **Runways:** threshold/end coordinates from CIFP/NASR (or OurAirports fallback), extended centrelines with range marks every 1 NM, ILS feather.
- **Projection:** stereographic per sector; float64 in the sim; the renderer draws relative to the view centre to avoid float32 jitter in WebGL at high zoom.
- **Static layers** (video map, fixes, procedures, areas, MVA) are tessellated once per zoom band into cached render textures; only targets/data blocks redraw per sweep.
- **Chart underlay:** pdf.js render → georeference with ≥ 3 control points (least-squares affine/projective, residual shown in NM) → underlay layer with opacity control → digitising editor writes traced items back into the pack.
- **Automated verification:** every pack build compares drawn positions with source coordinates and fails above tolerance; screenshot tests render reference views.

---

## 7. Aircraft performance and flight dynamics

- **Performance data: OpenAP** (TU Delft, open source) exported to JSON per ICAO type; types without data map to a same-class reference type. BADA needs a Eurocontrol licence — revisit for Academy if customers require it.
- **Model:** point-mass kinematic — ISA (+ deviation), CAS/TAS/Mach conversions, standard-rate turns bank-limited at high TAS, wind triangle, altitude-dependent climb/descent rates, accel/decel limits, 250 kt below FL100, LNAV/VNAV over ARINC 424 legs, holds, LOC/GS capture.
- **Pilot model:** reaction delay 2–6 s, readback, occasional "unable"/requests, TCAS RA behaviour (§14.3).
- **Loop:** fixed step dt = 0.5 s; radar sweep 4 s (snapshot to UI); time compression ×1/×2/×4 in training.

---

## 8. Issue 3 — Communication engines (STT / TTS)

### 8.1 Requirements

Free (no per-use licence fee), commercially usable licence, good on aviation
English with accents and radio noise, low latency (target **< 1.0 s** from PTT
release to readback start), runs on any device — either locally or via our server.

### 8.2 Model choice

| Role | Model | Licence | Size (approx.) | Notes |
|---|---|---|---|---|
| STT, on-device default | **Moonshine** (English) | MIT (English models) | tens of MB | Built for edge/real-time; claims ≥ Whisper accuracy at a fraction of size. Other languages use a non-commercial community licence — English only |
| STT, on-device alt / desktop | **Whisper base.en / small.en / large-v3-turbo** (quantised) | MIT | 75 MB – 800 MB | transformers.js + WebGPU in browser; whisper.cpp / faster-whisper natively in Electron |
| STT, low-end fallback | **Vosk** with a restricted phrase list | Apache-2.0 | ~40 MB | Very fast; constrained vocabulary suits closed phraseology. Grammar support in the browser build must be verified |
| STT, online | **Our fine-tuned Whisper large-v3-turbo** on our GPU service; Groq as burst fallback | MIT (model) | server | Best accuracy; no download |
| TTS, on-device + online | **Kokoro-82M** | Apache-2.0 | ~80–330 MB by quantisation | Runs in browser (kokoro-js, WASM/WebGPU) and on server; multiple voices/accents |
| TTS, zero-download fallback | Web Speech API / OS voices | platform | 0 | Robotic, but always available |

Avoid: Piper's current releases (GPL) for bundling; public ATC fine-tunes trained
on UWB-ATCC (CC BY-NC-SA) or other non-commercial corpora.

### 8.3 Making it "perfect" for ATC

Generic models are not tuned for phraseology. Our edge:

1. **Context biasing:** pass live callsigns, fixes, runways and frequencies as the prompt / hot-words.
2. **Grammar-constrained decoding:** the phraseology grammar (§8.5) generates the set of valid utterances; ASR n-best output is re-scored against it (fuzzy match on callsign + clearance). Out-of-grammar ⇒ "say again".
3. **Own fine-tuning data, licence-clean:** generate tens of thousands of phraseology sentences from the grammar → synthesize them with many Kokoro voices/accents/speeds → add radio noise, clipping, VHF band-pass → fine-tune Moonshine/Whisper. Add opt-in, consented player recordings later. All data owned by us ⇒ commercial use safe.
4. **Benchmark set** of real-voice test recordings (team + volunteers) gating every model release (WER on callsigns and numbers, not just overall WER).

### 8.4 Two engines, one interface

```ts
interface SpeechToText { transcribe(audio: Float32Array, ctx: AsrContext): Promise<AsrResult> }
interface TextToSpeech { speak(text: string, voice: VoiceId, fx: RadioFx): Promise<AudioBuffer> }
```

| | **Embedded engine (on-device)** | **Online engine (remote)** |
|---|---|---|
| First download | + 60–400 MB (model tier chosen by device) | none |
| Works offline | yes | no |
| Running cost for us | €0 | GPU time (§13) |
| Latency | depends on device | ~300–700 ms network + inference |
| Privacy | audio never leaves device | audio sent to our server (consent, not stored by default) |
| Default for | desktop (Electron/web with WebGPU), Academy offline | phones, low-end devices, quick start |

The app picks automatically (§11) and the player can switch in System Config.
Models download lazily (only when voice is first enabled) and are cached
(OPFS / Cache Storage / app files).

### 8.5 Phraseology parser (release 1: closed grammar)

- Grammar (Chevrotain) from ICAO Doc 4444 ch. 12 and Doc 9432; numbers ("flight level three four zero", "niner"), NATO alphabet, ICAO telephony designators, abbreviated callsigns after first contact.
- Multiple clearances per transmission; output is a `Message`; anything outside the grammar ⇒ pilot "say again".
- An LLM normaliser for loose speech is a later opt-in feature and always ends in the same validation.

### 8.6 Readback

Readback rules (altitudes, headings, speeds, runway, squawk, frequency; callsign
last); stable per-aircraft voice + accent; VHF radio effect; blocked/stepped-on
transmissions in later releases.

---

## 9. Issue 4 — Traffic data: real, recorded and augmented

### 9.1 Three traffic sources, one model

| Source | Use | Provider options |
|---|---|---|
| **Live** | "Now" in a sector | **adsb.lol** (ODbL, free, community, no SLA) — default; **FR24 via Navigraph platform** (licensed for sim products, user needs Navigraph) — premium option; OpenSky / ADS-B Exchange / FR24 direct only with a commercial licence (**quote**) |
| **Recorded (1–7 days, global)** | Replay any airport at any time in the last week; Training scenarios | Built by us from **adsb.lol daily globe history** (ODbL) |
| **Synthetic** | Fill quiet sectors, scripted conflicts, Academy | Our generator (§9.4) |

Real aircraft cannot be controlled; real data only **seeds** sim aircraft,
which are then simulated locally and answer only to the player.

### 9.2 Live traffic service

- One server-side poller per active region (not per user) → cache → fan-out to clients over our CDN/WebSocket. Cost scales with regions, not players.
- Refresh 5–20 s (sim interpolates between updates until the aircraft is "taken" into the sim).
- Filtering: drop on-ground clutter outside the airport, military/blocked aircraft, and honour privacy block lists (e.g. FAA LADD) where the feed provides them.

### 9.3 The 7-day flight DB ("FPL DB")

Public ADS-B gives positions, not filed flight plans. We reconstruct
**inferred flight plans**:

1. Daily job ingests the adsb.lol dump (one file per day = the whole sky).
2. Segment traces into flights (take-off/landing detection, gaps).
3. Resolve **ADEP/ADES** from first/last positions near airports; aircraft type from the ICAO hex registry; airline from callsign prefix.
4. Infer **route**: snap the track to airways and to the SID/STAR/approach of the pack (map-matching); store as an ICAO-style route string + the raw simplified track.
5. Store per airport/hour: `flights(id, callsign, type, adep, ades, off_time, on_time, route, track_simplified, source='adsb.lol')` as Parquet on object storage (R2), query with DuckDB in the job/Edge Function. Keep a rolling 7 days.

ODbL is share-alike for the **database**: our derived flight DB must be offered
under ODbL (attribution "© adsb.lol contributors, ODbL") — the game itself is
not affected. Optional enrichment with real filed routes: FlightAware AeroAPI
(usage-based, Standard tier from ~$100/month minimum) or FAA SWIM SFDPS (US;
access terms to confirm).

### 9.4 Augmentation (when real traffic is too light)

- Each session has a **target intensity** (movements/hour, or "realistic / busy / extreme").
- `TrafficDirector` compares real flow to the target every few minutes and spawns synthetic flights to fill the gap.
- Synthetic flights are statistically realistic: airline/type/destination mix sampled from that airport's 7-day DB; they enter at real entry points/STARs with valid inferred routes; callsigns never collide with real ones.
- Optional **conflict injection** (training): spawn pairs with a chosen geometry (crossing/head-on/catch-up) and closest point of approach.

---

## 10. Scope (radar display)

- Target symbol by state, history dots, speed vector (1/2/3/5 min), leader line.
- Configurable data block: callsign + flags / actual FL + trend + cleared FL / GS + assigned heading/speed + exit or next fix; full/limited, drag, auto-deconflict.
- Video map: coastline, sector borders, airways, fixes, extended centrelines, areas, MVA; range rings, RBL/measure tool, range presets 5–250 NM, day/night palettes.
- STCA / MSAW / area-infringement colouring; TCAS RA indication from pilot reports.
- Electronic flight strips (reuse existing strip UI), synced with selection.
- **Canvas 2D** (`packages/scope`), not Phaser: a radar picture is thin vector lines and small
  monospace text, which Canvas 2D draws crisply at any pixel ratio with no texture handling.
  The full NY TMA (~1 300 fixes, ~100 airways) draws in 1–2 ms. The renderer reads snapshots only.
  Phaser stays for the legacy arcade game until it is retired.
- **ATC system profiles** (`packages/scope/src/systems.ts`): the controller picks the display
  system they train on — *Generic* (our default, STARS-like data block), *Selex (Alenia)*
  (modelled on a Selex ES / Leonardo en-route display in service in Ukraine: grey map, white
  "+" tracks, `CALLSIGN / AFL CFL / G<gs>` labels, cyan incoming, boxed extended label of the
  selected track) and *Indra* (modelled on an iTEC / SACTA screenshot: navy map on slate, teal
  unit boundary, diamond fixes, green own traffic `NEXT / CALLSIGN GS / AFL CFL`, white two-line
  others). A profile is data only: map palette, sector / area styling, track symbol, ownership
  colours and label layouts — adding a system (Thales TopSky, Frequentis…) is one object.
- **Sectors and ownership:** packs carry control sectors (lateral polygon + floor / ceiling);
  the controller selects the active sector, which is filled and outlined, and traffic is
  coloured *owned* (inside its volume), *incoming* (predicted to enter within 5 min, cleared
  level respected) or *other*. Ownership is geometric until handoffs / track assumption arrive
  with multi-sector sessions (Phase 3). The NY pack ships synthetic wedges.
- **Official sector boundaries:** where a state publishes them, ACC sectors are in **AIP ENR 2.1**
  (ATS airspace): name, lateral limits (coordinate chain, DME arcs, "along FIR boundary"),
  vertical limits, unit, call sign, frequencies — e.g. Thailand lists all 12 Bangkok ACC sectors
  (1N–6N, 1S–6S), including multi-volume sectors (6S = GND–FL460 area + GND–FL270 area). Many
  states (incl. the USA for TRACON / ARTCC sectors) do not publish sectors; the FAA publishes
  ARTCC boundaries (NASR) only. Importer needs: coordinate / arc / FIR-boundary-following
  parser, FIR boundaries from the same ENR 2.1, sectors as several volumes, and the state's AIP
  copyright terms checked before shipping (AIP text is state copyright, not open data).
- **Track tools:** speed vectors are drawn one dash per minute; clicking a track symbol shows
  its remaining route (direct fix, route fixes, runway when cleared for an approach) with ETOs
  at the current ground speed.

---

## 11. Issue 5 — Any device and any browser

### 11.1 Delivery

| Target | How |
|---|---|
| Any modern browser | Web app / **PWA** (install, offline packs + models via Service Worker, OPFS) |
| Windows / macOS / Linux | Electron (existing) — native whisper.cpp / onnxruntime for speed |
| iOS / Android | Capacitor (existing) — native mic, background audio; native inference plugins later |

### 11.2 Capability tiers (detected at runtime)

| Tier | Detected when | Voice | Scope |
|---|---|---|---|
| **A — High** | WebGPU + ≥ 8 GB RAM (desktop, recent Mac/PC, Electron) | Embedded: Whisper small/turbo or Moonshine + Kokoro (WebGPU) | Full effects, 100+ aircraft |
| **B — Mid** | WebGPU or fast WASM, 4–8 GB (recent phones/tablets) | Embedded Moonshine + Kokoro q8, or Online | Reduced effects |
| **C — Low** | No WebGPU / low memory / iOS memory pressure | Online engine; Vosk fallback; Web Speech TTS | Simplified rendering |
| **D — No mic** | Permission denied / no audio | Text + quick-command input | Any |

Notes: WebGPU is available in current Chrome/Edge and recent Safari versions but
must be feature-detected per device; iOS limits tab memory, so large models run
only in the native app or via the online engine.

### 11.3 UX for small screens and touch

Pinch/pan scope, tap target to select, large PTT button (hold), quick-command
radial menu, landscape-first layout with collapsible strip bay; keyboard
shortcuts on desktop (space = PTT).

---

## 12. Game layer

- **Training Center:** `Lesson { objectives, pack, scenario, allowedCommands, rules, scoring }`; phraseology drills, single arrival, sequencing, conflict resolution, emergencies. Feedback from the event log.
- **Working Position:** sector + traffic source (live / recorded / synthetic / mixed) + intensity; simulated neighbour sectors and handoffs.
- **Scoring:** separation losses, STCA time, MVA/area infringements, delay/track miles, phraseology accuracy, readback errors caught, workload handled — all from the event log, so replays grade identically.
- Reuse existing auth, monetization (RevenueCat), progress sync.

---

## 13. Issue 6 — Cost of paid data/services and subscription prices

### 13.1 Unit prices used (Oct 2026, public sources)

| Item | Price |
|---|---|
| STT Groq Whisper large-v3-turbo | ≈ $0.00067 / audio-min |
| STT OpenAI gpt-4o-mini-transcribe | ≈ $0.003 / audio-min (model deprecation reported — verify) |
| STT Deepgram Nova-3 | ≈ $0.0043–0.0077 / audio-min |
| TTS Google Neural2 / Chirp 3 HD / Standard | $16 / $30 / $4 per 1 M chars |
| TTS Azure Neural | ≈ $15 per 1 M chars |
| Self-hosted GPU (L4-class, on-demand) | ≈ $0.6–0.8 / hour (provider-dependent — verify) |
| FR24 API | Explorer $9 / Essential ≈ $90–99 / Advanced $900 per month (redistribution rights need a licence) |
| FlightAware AeroAPI | Personal: pay-per-use; Standard ≥ $100/month minimum; Premium ≥ $1,000 |
| OpenSky, ADS-B Exchange, Jeppesen, EAD B2B, OpenAIP commercial | **quote** |
| adsb.lol, FAA CIFP/NASR/d-TPP, OurAirports, OpenAP, Moonshine (EN), Whisper, Kokoro | $0 |
| Navigraph | $0 for us (user subscription ≈ €10/month or ≈ $95/year) |
| Apple / Google store fee | 15 % (Small Business Program / subscriptions) |
| Paddle (web) | 5 % + $0.50 per transaction |
| RevenueCat | free up to $2.5k monthly tracked revenue, then ~1 % |
| Supabase Pro | $25/month + usage |
| Cloudflare R2 (packs, models, flight DB) | ~$0.015 / GB-month, free egress |

### 13.2 Usage assumptions per active subscriber / month

15 h of play; controller speaks ~15 % of the time ⇒ **135 audio-minutes STT**;
pilot readbacks of similar duration ⇒ **~120 k characters TTS**.

### 13.3 Variable cost per subscriber / month

| Voice setup | STT | TTS | Total voice |
|---|---|---|---|
| Embedded engine (on-device) | $0 | $0 | **$0** |
| Online, our GPU (fine-tuned Whisper + Kokoro), at load | ~$0.05 | ~$0.02 | **~$0.07** + fixed GPU |
| Online, Groq STT + on-device Kokoro | $0.09 | $0 | **$0.09** |
| Online, Groq STT + Google Neural2 TTS | $0.09 | $1.94 | **$2.03** ← avoid cloud TTS by default |
| Online, Deepgram + Azure Neural | $0.65 | $1.80 | **$2.45** |

Plus data/infra share ≈ $0.05–0.30 per user. A heavy user (60 h) is 4× — hence
fair-use caps on online voice for the base plan.

### 13.4 Fixed monthly cost scenarios

| Item | Launch (≤ 500 subs) | Growth (~5,000 subs) |
|---|---|---|
| Supabase | $25–50 | $150–300 |
| Flight-DB job (VM) + R2 storage | $25–40 | $40–80 |
| Online voice GPU (1 warm L4, else Groq) | $0 (Groq only) | $450–600 |
| Live traffic premium feed (optional) | $0 (adsb.lol) | $90–900 or licence **quote** |
| Route enrichment (AeroAPI, optional) | $0 | $100–300 |
| Monitoring, CDN, misc | $0–30 | $50–100 |
| Apple dev ($99/yr) | ~$8 | ~$8 |
| **Total fixed** | **≈ $60–130** | **≈ $900–2,300** |
| Chart/navdata licences outside US | not at launch | **quote** per state / provider |

### 13.5 Contribution per subscriber

At $9.99/month: store fee 15 % → $8.49; EU prices include VAT (~20 %) → ~$7.08
for EU buyers; RevenueCat ~1 % → −$0.10; variable cost ~$0.10–0.40 →
**≈ $6.6–8.0 net per subscriber**. Break-even: launch ≈ **20 subscribers**,
growth ≈ **150–350 subscribers**.

### 13.6 Proposed plans

Reference points: SayIntentions.AI ≈ $23.95/month, LearnATC ≈ €19/month,
BeyondATC $29.99 one-time + voice packs.

| Plan | Price | Includes |
|---|---|---|
| **Cadet** (free) | $0 | Tutorial + first lessons, 2 US airports, synthetic traffic, text input + embedded voice (if device supports), 30 min online voice/month, ads (existing AdMob) |
| **Controller** | **$9.99/month · $79.99/year** | All published packs, full Training Center, live traffic (adsb.lol), 7-day replay, online voice 20 h/month fair use, score history, no ads |
| **Supervisor** | **$17.99/month · $149.99/year** | Everything + online voice 60 h/month, premium voices/accents, personal scenario editor, Navigraph link (worldwide data with the user's Navigraph), FR24 live traffic where licensed |
| **Academy Cloud** (B2B) | **$29/seat/month**, annual, min. 10 seats | Isolated tenant, instructor station, scenario service, multi-trainee sessions, reports, SSO, support |
| **Academy On-Prem / Offline** (B2B) | **from €12,000/year** (≤ 20 seats) + setup €3–5k | Self-hosted LAN server, fully offline embedded engines, customer airspace import, SLA |
| Custom sector/scenario development | day rate (e.g. €600–800/day) | Building a school's airspace and syllabus scenarios |

Prices are proposals; validate with a pricing test (two price points) at launch.

---

## 14. Issue 7 — Academy edition: isolated flight-school deployments

### 14.1 Isolation

| Option | What the school gets |
|---|---|
| **Dedicated cloud tenant** | Own Supabase project + own session server + own voice endpoint, data residency (EU region), SSO (SAML/OIDC), no data shared with the consumer app |
| **On-prem / offline** | Docker bundle (session server, pack server, scenario service, optional GPU voice) on the school LAN; clients are browsers or the desktop app; works with no internet; licence key with offline activation |

Customer data (charts, AIP, recordings, results) never leaves the tenant.

### 14.2 Sessions and roles

- **Server-authoritative sim** (`packages/sim` in Node) with WebSocket clients ⇒ several trainees share one airspace (e.g. APP + TWR + ACC positions with handoffs).
- **Roles:** Trainee (controller position), Instructor (control + inject), Pseudo-pilot (optional human pilot voice instead of TTS), Observer/Assessor.
- **Instructor station:** pause, rewind, time compression, inject events live, take over an aircraft, annotate the timeline, end-of-session debrief with replay.

### 14.3 Scenario service (our additional service)

Scenario = sector + time + traffic plan + event timeline + assessment rubric.
Scenarios are normally **generated from an instructor's intent** (§14.4); a
manual editor and a template library per training phase cover the rest.

| Category | Events |
|---|---|
| **Traffic volume** | Intensity curve over the session (movements/hour), arrival/departure mix, bunching, wake mix |
| **Conflicts** | Generated by geometry (crossing / head-on / catch-up / climbing-through) with chosen CPA and time to conflict |
| **TCAS** | TA/RA modelled from aircraft geometry; pilot reports "TCAS RA", follows RA, reports "clear of conflict"; scoring checks no contradictory clearance during RA |
| **Emergencies** | MAYDAY (engine failure, depressurisation → emergency descent, fire, fuel), PAN PAN (medical, minor technical), radio failure (7600, lost-comm procedure), unlawful interference (7500), squawk 7700 handling |
| **Weather** | Real METAR/TAF (aviationweather.gov) or scripted: wind shifts, QNH changes, runway change, CB cells with deviation requests, turbulence reports, low-visibility procedures |
| **Restrictions** | Activate restricted/TRA/TSA areas, runway/taxiway closures, NOTAMs, flow restrictions (MIT/MINIT) |
| **Equipment** | Radar degradation, frequency failure, ILS outage, data-block loss |
| **Pilot behaviour** | Wrong readback, non-compliance, requests (higher level, direct, shortcut), level busts |

### 14.4 Automated scenario generator (instructor intent → playable scenarios)

The instructor states **what should happen**, not where each aircraft starts.
The generator computes traffic that produces it, proposes several variants,
and keeps the session controllable (wind, reset, re-plan).

Example request:

> "4 conflicts within 4 min over SLV in layer FL170–200, approaching traffic"

**1. Intent → spec.** The request is entered in a structured form or as free
text. Free text is parsed into a `ScenarioSpec` (grammar first; optional LLM
for loose wording) and always shown back as an editable form before
generation — the spec, not the sentence, is what runs.

```yaml
sector: <pack id>
start: now + 2 min          # first conflict no earlier than this
window: 4 min               # all conflicts fall inside it
conflicts:
  count: 4
  area: { around: SLV, radiusNm: 10 }
  layer: [FL170, FL200]
  traffic: arrivals          # "approaching traffic" → STAR / descending flows
  geometry: mixed            # crossing | head-on | catch-up | level-change | mixed
  severity: { cpaNm: [0, 3], minTimeToActS: 90 }
background: { intensity: realistic }   # or movements/hour
constraints: { noUnplannedConflicts: true, realisticTypesAndAirlines: true }
```

**2. Planning (backwards from the conflict).** For each conflict the planner
picks a conflict point and time inside the area/window, chooses two flows that
can meet there (e.g. two STARs through SLV, or an arrival descending through a
level occupied by an overflight), then **back-propagates** each aircraft along
its route with its own performance (speed, descent profile) to find where it
must be at session start. It samples many candidates and searches over timing,
speeds within the type envelope, levels, types and airlines (drawn from the
7-day DB for realism).

**3. Validation (forward simulation).** Every candidate is run headless with no
ATC action, many times faster than real time, with randomised pilot/wind
variation (Monte Carlo):
- each requested conflict must occur (loss of separation at the CPA if nobody acts);
- no unplanned conflicts (unless allowed);
- each conflict is solvable — enough time and room to act (`minTimeToActS`, no terrain/area trap);
- background traffic stays realistic.

**4. Proposals.** The instructor gets 3–5 ranked variants with a difficulty
score (simultaneity, time-to-conflict, geometry, workload, phraseology load)
and a **preview**: ghost tracks fast-forwarded on the scope plus a timeline
with conflict markers. Pick one, tweak, or "re-roll" for a variant with the
same spec but different aircraft (prevents trainees memorising).

If the request is impossible (e.g. only one arrival flow through SLV, or 4
arrival conflicts cannot physically fit in 4 min), the generator says why and
offers the nearest feasible spec ("4 conflicts in 6 min" / "3 arrival + 1
overflight").

**5. Running and controlling the session.** The sim is deterministic and
snapshots state every radar sweep, so the instructor can:
- **wind** — fast-forward to the next marker, or rewind to any point;
- **reset** — restart from the scenario start;
- **branch** — rewind and let the trainee try again from that moment;
- **re-plan live** — "add another conflict in 2 min", "make it busier", "remove the
  head-on": the generator re-plans only the future from the current state;
- **update** — save the adjusted scenario back to the library as a new version.

**6. Adaptive follow-up.** After the debrief, the generator proposes the next
scenario from the trainee's results (e.g. weak on catch-up conflicts → more
catch-ups, shorter time-to-act). The same engine builds consumer Training
Center lessons, so it is not Academy-only.

**Components:** `packages/scenario` — `SpecParser` (form + NL), `Planner`
(constraint sampling + back-propagation), `Validator` (headless `packages/sim`,
Monte Carlo), `Ranker` (difficulty model), `Library` (versioned specs and
generated scenarios). Runs in a worker for single players and on the session
server for Academy. Generation target: proposals in **< 10 s** for a
single-sector spec.

### 14.5 Assessment

Rubrics mapped to ATCO competencies (situational awareness, traffic & capacity
management, separation and conflict resolution, communication, coordination,
workload management, emergency handling); automatic metrics from the event log
+ instructor marks; exportable PDF reports and progress tracking per trainee.

### 14.6 Positioning

Sold as **supplementary training** (part-task practice). Use inside an approved
ATCO training course as a formal device would require approval by the national
supervisory authority — a later, separate track if customers ask for it.

---

## 15. Issue 8 — Further topics to plan for

- **Legal / disclaimer:** "Not for real-world navigation or operational use". Trademark-neutral naming (airline telephony designators are fine; no airline logos without licence).
- **Privacy & GDPR:** voice audio processed on-device by default; online engine requires consent; recordings not stored unless the player opts in to "help improve recognition"; data-processing agreement for Academy tenants; children/age rating for app stores.
- **ADS-B privacy:** honour block lists, drop private registration display for blocked GA, no personal data shown.
- **Accessibility:** text input mode, colour-blind palettes, scalable data blocks, captions for pilot speech.
- **Languages:** ICAO English first; later national phraseology (FR, ES, RU, …) — the engines are multilingual, grammars are per language.
- **Real weather:** METAR/TAF from aviationweather.gov (free) drives winds/QNH/runway in use in live mode.
- **ATIS generation** (text + TTS) and **CPDLC** messages in later releases.
- **Anti-abuse & cost control:** per-user online-voice quotas, rate limits, budget alarms, automatic fallback to embedded/text when a cap is hit.
- **Telemetry (opt-in):** recognition failures by phrase type to improve grammar/models; performance by device tier.
- **Offline-first packs:** download a sector (pack + models + 7-day traffic slice) for flights/classrooms without internet.
- **Testing:** golden replays (deterministic sim), grammar corpus tests, ASR benchmark set, visual regression of the scope.
- **Accounts:** current skymess-style alias/password accounts suit consumers; Academy needs email/SSO and seat management.
- **Community content (later):** shared scenarios and packs, moderated.

---

## 16. Mapping to the current codebase

| Current (skymess engine) | Target |
|---|---|
| `game/scenes/GameScene.ts` (sim + render) | `packages/sim` + `ScopeScene` (render only) |
| `systems/WorldTransform.ts` (pixel world) | `Projection` + `ScopeView` |
| `objects/Plane.ts` (path following) | `sim/Aircraft` + `scope/TargetSprite` |
| `InputSystem`, `PathDrawSystem`, `PathProcessor` | Command layer (voice / text / quick-commands) |
| `CollisionSystem` (pixel radii) | `sim/SeparationMonitor` (NM / ft) + TCAS model |
| `airports.config.ts`, `AIRPORTS_OBJECTS.json`, bitmap backgrounds | Airspace packs + video map + chart underlay |
| `planes.config.ts` | OpenAP performance DB |
| `SpawnSystem`, `level.structure.ts` | `TrafficDirector` + scenarios |
| `services/EventBus.ts` | Keep for UI ↔ renderer; sim via worker/WebSocket messages |
| `AudioSystem.ts` | Keep for UI sounds; radio voice via TTS + radio FX |
| Home strips, Control Center, Training Center, System Config, Paywall, auth, stores | Keep; Control Center → packs, Training Center → lessons |
| `packages/server` (empty in skymess) | Session server / voice gateway / traffic fan-out |

The arcade engine stays until the scope reaches parity for one airport; then
airports switch over behind a feature flag.

---

## 17. Implementation plan

Each phase ends with something playable and testable.

### Phase 0 — Foundations (2 wk)
- `packages/sim`, `atc-data`, `voice`, `traffic` with Vitest.
- Geodesy (geographiclib), stereographic projection, WMM magnetic variation, ISA/airspeed conversions — unit tests against reference values.
- Pack / Aircraft / Clearance schemas; worker bridge; deterministic clock + event log.
- **Done when:** a headless test flies a heading and a direct-to with correct distances/times.

### Phase 1 — US data pipeline + scope MVP + text commands (4–5 wk)
- CIFP + NASR + OurAirports importers → first packs (one busy US approach, e.g. a Class B TMA) with AIRAC versioning and validation report.
- `ScopeScene`: video map, targets, history, vectors, data blocks, range rings, pan/zoom; precision tests (≤ 10 m).
- Flight model v1 with OpenAP for ~15 types; text command syntax (`DAL123 FL120 H240 S220`).
- Separation monitor + STCA. Route `/scope/:packId` behind a feature flag.
- **Done when:** you can vector 5 arrivals to final by keyboard and get conflict alerts.

### Phase 2 — Phraseology + readback (3 wk)
- Chevrotain grammar for release-1 phrases, telephony designators, number normaliser; ≥ 500 corpus tests.
- Readback generator; TTS interface with Kokoro (embedded) + Web Speech fallback; radio FX.

### Phase 3 — Voice engines (4 wk)
- PTT UX + permissions (web, Electron, iOS, Android).
- Embedded STT (Moonshine / Whisper via transformers.js; whisper.cpp in Electron) with model tiers and lazy download.
- Online engine: voice gateway (`packages/server`) + GPU inference (faster-whisper + Kokoro), Groq fallback; quotas.
- Grammar re-scoring + context biasing; ASR benchmark set.
- Synthetic fine-tuning dataset generator (grammar → Kokoro voices → radio augmentation); first fine-tuned model.
- **Done when:** spoken clearances work end-to-end < 1.0 s on tier A, < 1.5 s online.

### Phase 4 — Procedures, approaches, charts (4 wk)
- ARINC 424 FMS (IF/TF/CF/DF/RF/CA/VA…), constraints, holds, ILS capture.
- d-TPP chart PDF underlay + georeferencing + digitising editor.
- **Done when:** an arrival flies a STAR, is cleared ILS and lands; chart overlay ≤ 0.2 NM.

### Phase 5 — Traffic (4 wk)
- adsb.lol live adapter + server fan-out; seeding sim aircraft from live data.
- 7-day flight DB job (ingest, segment, ADEP/ADES, route inference, Parquet on R2) + replay picker.
- `TrafficDirector` augmentation + conflict injection; real METAR/TAF.

### Phase 6 — Training Center + scoring + any-device polish (3–4 wk)
- Lessons, objectives, scoring, debrief replay; progress sync.
- Capability tiers, PWA offline packs/models, touch UX, performance on mid-range phones.
- Subscriptions wired to the new plans (RevenueCat entitlements, fair-use quotas).

### Phase 7 — Academy MVP (8 wk)
- Server-authoritative multi-seat sessions, roles, instructor station.
- Session timeline: snapshots per sweep, wind / rewind / reset / branch.
- Scenario generator (§14.4): spec form + text parser, conflict planner, Monte Carlo validator, ranked proposals with preview, live re-plan, library versioning.
- Event library (§14.3), assessment rubrics + PDF reports.
- Dedicated tenant deployment template; on-prem Docker bundle with offline activation.

### Phase 8 — Expansion (ongoing)
- Navigraph bring-your-own integration (after eligibility confirmed).
- Licensed non-US packs; FR24-via-Navigraph live traffic; more types/voices/languages; ATIS, CPDLC; retire the arcade engine.

---

## 18. Decisions and open questions

| # | Decision | Proposal | Needs |
|---|---|---|---|
| 1 | Launch region | USA (free, public-domain data) | OK from you |
| 2 | Worldwide consumer data | Navigraph bring-your-own | Written confirmation from Navigraph that an ATC sim qualifies |
| 3 | Non-US in-house packs | Per-state licence review, EAD B2B if needed | Quotes |
| 4 | Live traffic default | adsb.lol (ODbL) | Accept ODbL share-alike for our flight DB |
| 5 | Premium live traffic | FR24 via Navigraph platform, or direct licence | Quote / terms |
| 6 | STT models | Moonshine EN + Whisper; own fine-tune on synthetic data | OK from you |
| 7 | TTS | Kokoro everywhere; no cloud TTS by default | OK from you |
| 8 | Online engine hosting | Groq at launch → own GPU at ~1–2k subscribers | GPU provider choice |
| 9 | Pricing | §13.6 | Price test at launch |
| 10 | Academy | Cloud tenant first, on-prem second | First pilot school |
| 11 | Scenario intent input | Structured form + grammar parser; LLM for free text later, always confirmed as a form | OK from you |

## 19. Sources (checked Oct 2026)

- FlightAware AeroAPI pricing — https://www.flightaware.com/commercial/aeroapi/ · overview https://geekflare.com/guides/flight-data-api/
- Flightradar24 API plans — https://www.flightradar24.com/blog/b2b/how-to-get-started-with-the-flightradar24-api/ · https://github.com/api-evangelist/flightradar24
- OpenSky terms (commercial licence required) — https://opensky-network.org/about/terms-of-use · https://opensky-network.org/about/faq
- adsb.lol open data (ODbL) — https://www.adsb.lol/docs/open-data/historical/ · https://github.com/adsblol
- ADS-B Exchange commercial use — https://store.adsbexchange.com/products/monthly-ad-free-adsbexchange-subscription
- Navigraph developer model and terms — https://developers.navigraph.com/docs/general/navigraph-model · https://developers.navigraph.com/docs/charts/airport-charts · https://developers.navigraph.com/docs/developer-terms-of-service
- Navigraph × Flightradar24 sim traffic — https://www.flightradar24.com/blog/inside-flightradar24/flightradar24-coming-to-a-flight-simulator-near-you/ · https://fselite.net/content/flightradar24-traffic-now-live-in-beyondatc-with-navigraph/
- Eurocontrol EAD Basic — https://www.ead.eurocontrol.int/fwf-eadbasic/public/static/home.faces
- AIS of Ukraine publications + 2026 prices (AIC A 03/25) — https://www.aisukraine.net/publications/eng/publ(eng).htm · https://aisukraine.net/current/UK_Circ_2025_A_03_en.pdf
- AIP:Aero (aggregator, partner API) — https://aip.aero/ua/en/ · https://aip.aero/partners/ · https://aip.aero/terms/
- FAA SWIM / LADD obligations — https://www.faa.gov/air_traffic/technology/swim/swift/swift-meeting-presentation-18-5-5-2022
- STT pricing — https://www.cartesia.ai/learn/openai-whisper-api-pricing · https://convertaudiototext.com/blog/speech-to-text-api-pricing-2026 · https://www.digitalapplied.com/blog/openai-gpt-transcribe-stt-model-comparison-2026
- TTS pricing — https://cloud.google.com/text-to-speech/pricing · https://azure.microsoft.com/pricing/details/cognitive-services/speech-services
- Moonshine — https://arxiv.org/html/2509.02523v1 · https://www.onresonant.com/resources/local-stt-models-2026
- Kokoro (kokoro-js) — https://www.npmjs.com/package/kokoro-js
- Vosk browser — https://github.com/ccoreilly/vosk-browser
- ATC-tuned Whisper research — https://research.tudelft.nl/en/publications/whisper-atc-open-models-for-air-traffic-control-automatic-speech- · https://huggingface.co/jsf3467v/whisper-small-atc-lora
- Store / billing fees — https://appbot.co/blog/app-developers-apple-google-small-business-programs/ · https://costbench.com/software/subscription-billing/revenuecat/
- Comparable products — https://fselite.net/content/beyondatc-reveals-pricing-model/ · https://www.avsim.com/forums/topic/681359-sayintentionsai-price-increase/ · https://www.learn-atc.com/pricing
