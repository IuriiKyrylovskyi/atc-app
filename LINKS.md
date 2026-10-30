# Links

Every external link the project uses or has evaluated, grouped by purpose.
**Use** says what we do with it; **Licence** says whether data from it may ship
in the product (see ATC_ARCHITECTURE.md §5.2 and §19 for the full assessments).

Legend: ✅ usable in the product · 🧪 development / reference only · ❌ not usable ·
💰 paid · 🔍 evaluated, not used

## 1. Navigation data — official sources

| Link | Use | Licence |
|---|---|---|
| [FAA CIFP](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/) · files `https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_<YYMMDD>.zip` | US airports, runways, ILS, fixes, navaids, airways, SID/STAR/IAP (ARINC 424) — NY pack (`pnpm data:cifp`) | ✅ public domain |
| [FAA NASR 28-day subscription](https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/NASR_Subscription/2026-10-29) | Class B–E airspace (shapefiles), SUA, ARTCC boundaries (ARB), frequencies — next NY importer | ✅ public domain |
| [FAA MVA / MIA charts](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/mva_mia/) | Minimum vectoring altitudes (AIXM 5.1, KMZ, PDF) — MSAW / MVA layer | ✅ public domain (no fixed cycle: check dates) |
| [FAA ARTCC boundary data (briefing)](https://www.faa.gov/air_traffic/flight_info/aeronav/acf/media/Briefings/ARTCC_Boundary_Data.pdf) · [Center surface boundaries](https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/Center_Surface_Boundaries) | ARTCC (en-route centre) outer boundaries | ✅ public domain |
| [Thailand eAIP — edition index](https://aip.caat.or.th/) · [ENR 2.1 AIRAC 2026-10-29](https://aip.caat.or.th/2026-10-29-AIRAC/html/eAIP/VT-ENR-2.1-en-GB.html) | Bangkok pack: TMA + ACC sectors (ENR 2.1), routes (ENR 3.1 / 3.3), navaids (4.1), points (4.4) — `pnpm data:eaip th` | 🧪 state copyright → devOnly packs; product use needs CAAT permission |
| [Latvia eAIP ENR 2.1](https://ais.lgs.lv/eAIPfiles/2025_001_23-JAN-2025/data/2025-01-23/html/eAIP/EV-ENR-2.1-en-GB.html) | Example of published ACC sectors (Riga Sector North / South); needs a browser session | 🔍 state copyright |
| [Singapore eAIP ENR 2.1](https://aim-sg.caas.gov.sg/aim-content/uploads/aip/07-AUG-2025/2025-08-07-000000/html/eAIP/SG-ENR-2.1-en-GB.html) | Example of FIR / sector limits with arcs | 🔍 state copyright |
| [AIS of Ukraine — publications](https://www.aisukraine.net/publications/eng/publ(eng).htm) · [2026 prices (AIC A 03/25)](https://aisukraine.net/current/UK_Circ_2025_A_03_en.pdf) | Kyiv: eAIP, charts, ARINC 424 database (login) — needed for Kyiv points, routes, sectors | 💰 $1,200 / yr + written agreement for distribution |
| [OurAirports data](https://ourairports.com/data/) · [mirror](https://davidmegginson.github.io/ourairports-data/) (`airports.csv`, `runways.csv`, [`navaids.csv`](https://davidmegginson.github.io/ourairports-data/navaids.csv)) | Airports, runway ends, navaids worldwide; Kyiv and Bangkok airports — `pnpm data:ourairports` | ✅ public domain |
| [EUROCONTROL EAD Basic](https://www.ead.eurocontrol.int/fwf-eadbasic/public/static/home.faces) | European AIP access | 🔍 non-commercial only |

## 2. Charts and maps

| Link | Use | Licence |
|---|---|---|
| [FAA IFR Enroute charts](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/ifr/) · files `https://aeronav.faa.gov/enroute/<MM-DD-YYYY>/` · [product schedule](https://aeronav.faa.gov/content/aeronav/DOLES/Product_Schedule.pdf) · [VIS 26-02 terminations](https://www.faa.gov/air_traffic/flight_info/aeronav/safety_alerts/media/VIS_26-02_CN_Product_Terminations_eff_May_2026.pdf) | Low / High enroute GeoTIFF + GeoPDF; H-10 covers New York (in `charts/`) — visual reference | ✅ public domain |
| [EUROCONTROL Cartography](https://www.eurocontrol.int/service/cartography) · [library](https://www.eurocontrol.int/library) | ERC upper / lower GeoPDFs (ERC-06 incl. Ukraine ATFM sectors), FIR/UIR charts (in `charts/`) — Kyiv points, routes, ATFM sectors via `pnpm data:erc` (devOnly) | 🧪 © EUROCONTROL, written permission for any reuse |
| [Open Flight Maps](https://www.openflightmaps.org) · [about / licence](https://openflightmaps.org/about/) · [FAQ](https://openflightmaps.org/faq/) | VFR AIXM data, 21 countries (Europe, South Africa, Namibia; no USA / Ukraine) | ✅ free incl. commercial, attribution + error reporting |
| [AIP:Aero](https://aip.aero/ua/en/) · [moving map (US)](https://aip.aero/us/moving-map/) · [partners / API](https://aip.aero/partners/) · [terms](https://aip.aero/terms/) | AIP link aggregator / VFR moving map | ❌ no data licence, no export — not a data source |

## 3. Simulation community (VATSIM)

| Link | Use | Licence |
|---|---|---|
| [Virtual New York ARTCC — airspace](https://www.nyartcc.org/page/airspace) · [downloads](http://www.nyartcc.org/downloads) · [wiki (SOPs, LOAs)](https://wiki.nyartcc.org) | ZNY / N90 split diagrams (images, e.g. 2C / 2A / 3A / 4) and SOPs of the VATSIM facility — reference for realistic NY sectorisation; no coordinates on the page | 🧪 "© Virtual New York ARTCC Inc, All Rights Reserved", "Not for real world navigation" |
| [nyartcc on GitHub](https://github.com/nyartcc) | Website, FAQ, bots, VATSpy tools — **no sector files or video maps**; only useful repo is its [VATSpy fork](https://github.com/nyartcc/vatspy-data-project) | MIT (code) |
| [VATSpy data project](https://github.com/vatsimnetwork/vatspy-data-project) | FIR / UIR boundaries worldwide (`Boundaries.geojson`, 534 features) incl. `KZNY` (New York Center), `VTBB` (Bangkok FIR — completes the ACC sectors along the border), `UKBV` (Kyiv FIR); community-drawn | ✅ CC BY-SA 4.0 (attribution + share-alike for packs using it) |
| [SimAware TRACON project](https://github.com/vatsimnetwork/simaware-tracon-project) | TRACON / APP boundaries (GeoJSON) | 🔍 no licence stated → reference only |

## 4. Traffic data

| Link | Use | Licence |
|---|---|---|
| [adsb.lol open data](https://www.adsb.lol/docs/open-data/historical/) · [GitHub](https://github.com/adsblol) | Live + 7-day recorded traffic (planned default) | ✅ ODbL |
| [OpenSky terms](https://opensky-network.org/about/terms-of-use) · [FAQ](https://opensky-network.org/about/faq) | Live / historical ADS-B | 💰 commercial licence required |
| [ADS-B Exchange commercial](https://store.adsbexchange.com/products/monthly-ad-free-adsbexchange-subscription) | Live ADS-B | 💰 |
| [FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/) · [flight data API overview](https://geekflare.com/guides/flight-data-api/) | Flight plans / live data | 💰 |
| [Flightradar24 API](https://www.flightradar24.com/blog/b2b/how-to-get-started-with-the-flightradar24-api/) · [API notes](https://github.com/api-evangelist/flightradar24) · [FR24 × Navigraph sim traffic](https://www.flightradar24.com/blog/inside-flightradar24/flightradar24-coming-to-a-flight-simulator-near-you/) · [BeyondATC + FR24](https://fselite.net/content/flightradar24-traffic-now-live-in-beyondatc-with-navigraph/) | Live traffic for sims | 💰 |
| [FAA SWIM / LADD](https://www.faa.gov/air_traffic/technology/swim/swift/swift-meeting-presentation-18-5-5-2022) | LADD (privacy-blocked aircraft) obligations | — |

## 5. Commercial navdata (paid alternatives)

| Link | Use | Licence |
|---|---|---|
| [Navigraph developer model](https://developers.navigraph.com/docs/general/navigraph-model) · [charts API](https://developers.navigraph.com/docs/charts/airport-charts) · [developer terms](https://developers.navigraph.com/docs/developer-terms-of-service) | Worldwide navdata / charts via the user's own subscription (PAID-ALT) | 💰 end-user subscription |

## 6. Voice (speech-to-text, text-to-speech)

| Link | Use |
|---|---|
| [Moonshine (paper)](https://arxiv.org/html/2509.02523v1) · [local STT models 2026](https://www.onresonant.com/resources/local-stt-models-2026) | On-device STT (default) |
| [moonshine-base ONNX model (MIT)](https://huggingface.co/onnx-community/moonshine-base-ONNX) · [transformers.js](https://huggingface.co/docs/transformers.js) | On-device STT (MIC MOONSHINE mode): q8 encoder + merged decoder ≈ 63 MB from Hugging Face on first use |
| [Web Speech API: SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) | Browser STT (MIC BROWSER mode, no download; Chrome/Edge send audio to their servers, not in Firefox/Electron) |
| [Vosk browser](https://github.com/ccoreilly/vosk-browser) | Low-end STT fallback |
| [Whisper-ATC (TU Delft)](https://research.tudelft.nl/en/publications/whisper-atc-open-models-for-air-traffic-control-automatic-speech-) · [whisper-small-atc LoRA](https://huggingface.co/jsf3467v/whisper-small-atc-lora) | ATC-tuned Whisper |
| [kokoro-js](https://www.npmjs.com/package/kokoro-js) · [Kokoro-82M ONNX model (Apache-2.0)](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) | On-device TTS (Kokoro mode); the model downloads from Hugging Face on first use |
| [Kokoro vs Piper comparison (our notes)](docs/research/TTS_KOKORO_VS_PIPER.md) · [piper-voices](https://huggingface.co/rhasspy/piper-voices) · [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Candidate low-end / mobile pilot voices (Piper int8 ≈ 23 MB per voice file); licences per voice, espeak-ng GPL-3.0 in both engines |
| [Web Speech API: SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis) | System voices (default, no download) |
| [Whisper API pricing](https://www.cartesia.ai/learn/openai-whisper-api-pricing) · [STT API pricing 2026](https://convertaudiototext.com/blog/speech-to-text-api-pricing-2026) · [GPT transcribe comparison](https://www.digitalapplied.com/blog/openai-gpt-transcribe-stt-model-comparison-2026) | Online STT costs (PAID-ALT) |
| [Google Cloud TTS pricing](https://cloud.google.com/text-to-speech/pricing) · [Azure Speech pricing](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services) | Online TTS costs (PAID-ALT) |

## 7. Market and pricing research

| Link | Use |
|---|---|
| [BeyondATC pricing](https://fselite.net/content/beyondatc-reveals-pricing-model/) · [SayIntentions price increase](https://www.avsim.com/forums/topic/681359-sayintentionsai-price-increase/) · [learn-atc pricing](https://www.learn-atc.com/pricing) | Comparable products |
| [Store small-business programmes](https://appbot.co/blog/app-developers-apple-google-small-business-programs/) · [RevenueCat costs](https://costbench.com/software/subscription-billing/revenuecat/) | Store / billing fees |

## 8. Platform, billing, release (app shell)

| Link | Use |
|---|---|
| [Repository](https://github.com/IuriiKyrylovskyi/atc-app) · [Actions](https://github.com/IuriiKyrylovskyi/atc-app/actions) · [Releases](https://github.com/IuriiKyrylovskyi/atc-app/releases) · [Issues](https://github.com/IuriiKyrylovskyi/atc-app/issues) · [Security / Dependabot](https://github.com/IuriiKyrylovskyi/atc-app/security) | This project |
| [skymess (port source)](https://github.com/IuriiKyrylovskyi/skymess.git) | Original project the app shell was ported from (`pnpm check:skymess`) |
| [Privacy](https://iuriikyrylovskyi.github.io/atc-app-privacy/) · [Terms](https://iuriikyrylovskyi.github.io/atc-app-terms/) · [Refund](https://iuriikyrylovskyi.github.io/atc-app-refund/) | Legal pages |
| [Supabase](https://supabase.com) · [dashboard](https://supabase.com/dashboard) | Auth, storage, functions |
| [RevenueCat](https://app.revenuecat.com) · [docs: iOS](https://www.revenuecat.com/docs/ios) · [Android](https://www.revenuecat.com/docs/android) · [Web billing](https://www.revenuecat.com/docs/web/web-billing) · [API v2](https://www.revenuecat.com/docs/api-v2) | Subscriptions |
| [App Store Connect](https://appstoreconnect.apple.com) · [review guidelines](https://developer.apple.com/app-store/review/guidelines/) · [privacy details](https://developer.apple.com/app-store/app-privacy-details/) · [account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app) · [notarizing](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution) | iOS / macOS release |
| [Google Play Console](https://play.google.com/console) · [content policy](https://play.google.com/about/developer-content-policy/) · [account deletion](https://support.google.com/googleplay/android-developer/answer/10787469) | Android release |
| [Capacitor](https://capacitorjs.com/docs) · [electron-builder](https://www.electron.build/) · [Node.js](https://nodejs.org/) · [GitHub Actions docs](https://docs.github.com/en/actions) · [act](https://github.com/nektos/act) · [standard-version](https://github.com/conventional-changelog/standard-version) | Build tooling |

---

Keep this file in sync when a new source is evaluated or used: add the link here
and, for data sources, the licence assessment to ATC_ARCHITECTURE.md §5.2.
