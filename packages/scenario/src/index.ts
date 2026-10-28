/**
 * @atc-app/scenario — scenario specs and the automated generator.
 *
 * Phase 7 (see TODO.md, ATC_ARCHITECTURE.md §14.4). Free stack used by the first
 * implementation: structured spec form + our own grammar parser for instructor
 * requests ("4 conflicts within 4 min over SLV in FL170–200, approaching traffic"),
 * conflict planner and Monte Carlo validator built on @atc-app/sim.
 *
 * PAID-ALT: hosted LLM (e.g. Claude / GPT class) to turn loose free-text requests
 *   into a ScenarioSpec.
 *   Why better: accepts any wording, not only the grammar.
 *   Price: per-token API pricing; small per request. The spec is always shown back
 *   as an editable form, so the free grammar path stays the default.
 *
 * Today: STAR arrival routes and hand-written scripted scenarios (library/).
 */
export * from './star';
export * from './script';
export * from './library';
