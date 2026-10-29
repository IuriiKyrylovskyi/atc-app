/**
 * View-models: the layer between incoming data and the Vue components.
 *
 * Data reaches the app from several places — airspace packs (built from FAA
 * CIFP, state eAIPs, EUROCONTROL ERC, OurAirports, VATSpy), sim snapshots from
 * the worker, and later live feeds and replays. Components do not read those
 * shapes directly: an adapter here turns each into a plain, display-ready
 * object (`AirspaceVM`, `AircraftVM`, `LogEntryVM`, …), so a new source means
 * a new adapter, not changes to every screen.
 *
 * Plain TypeScript, no Vue: adapters are pure functions and are unit-tested.
 * The canvas renderer (@atc-app/scope) keeps working on the video map and the
 * traffic picture directly; per-frame drawing does not go through here.
 */
export * from './format';
export * from './airspace';
export * from './aircraft';
export * from './events';
export * from './traffic';
export * from './areas';
