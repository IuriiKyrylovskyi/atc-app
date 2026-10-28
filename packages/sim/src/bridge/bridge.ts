/**
 * Typed request/response bridge between the UI and a simulation running elsewhere
 * (a Web Worker in the browser, worker_threads in Electron/Node, or a WebSocket to
 * the Academy session server). Transport-agnostic: anything that can post and
 * receive structured-clone / JSON messages implements `PortLike`.
 */
import type { AircraftSpawn, Message, Snapshot } from '../model/types';
import { Simulation, type IssueResult, type SimConfig, type SimState } from '../core/simulation';

export interface PortLike {
  postMessage(data: unknown): void;
  /** Subscribes to incoming messages; returns an unsubscribe function. */
  onMessage(listener: (data: unknown) => void): () => void;
}

export type SimRequest =
  | { op: 'init'; config: SimConfig; state?: SimState }
  | { op: 'addAircraft'; spawn: AircraftSpawn }
  | { op: 'schedule'; atS: number; spawn: AircraftSpawn }
  | { op: 'removeAircraft'; callsign: string }
  | { op: 'issue'; message: Message }
  | { op: 'advance'; seconds: number }
  | { op: 'snapshot' }
  | { op: 'saveState' }
  | { op: 'restore'; state: SimState };

export interface SimResponseMap {
  init: null;
  addAircraft: null;
  schedule: null;
  removeAircraft: null;
  issue: IssueResult;
  advance: Snapshot;
  snapshot: Snapshot;
  saveState: SimState;
  restore: null;
}

interface Envelope {
  id: number;
  request: SimRequest;
}

type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** Runs on the simulation side: answers requests from a `SimClient`. */
export function serveSimulation(port: PortLike): () => void {
  let sim: Simulation | null = null;
  let config: SimConfig | null = null;

  const handle = (req: SimRequest): unknown => {
    if (req.op === 'init') {
      config = req.config;
      sim = new Simulation(req.config, req.state);
      return null;
    }
    if (!sim || !config) throw new Error('simulation not initialised');
    switch (req.op) {
      case 'addAircraft':
        sim.addAircraft(req.spawn);
        return null;
      case 'schedule':
        sim.schedule(req.atS, req.spawn);
        return null;
      case 'removeAircraft':
        sim.removeAircraft(req.callsign);
        return null;
      case 'issue':
        return sim.issue(req.message);
      case 'advance':
        sim.advance(req.seconds);
        return sim.snapshot();
      case 'snapshot':
        return sim.snapshot();
      case 'saveState':
        return sim.saveState();
      case 'restore':
        sim = Simulation.restore(config, req.state);
        return null;
    }
  };

  return port.onMessage((data) => {
    const { id, request } = data as Envelope;
    let reply: Reply;
    try {
      reply = { id, ok: true, result: handle(request) };
    } catch (e) {
      reply = { id, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    port.postMessage(reply);
  });
}

/** Runs on the UI side: promise-based calls into a served simulation. */
export class SimClient {
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private readonly unsubscribe: () => void;

  constructor(private readonly port: PortLike) {
    this.unsubscribe = port.onMessage((data) => {
      const reply = data as Reply;
      const w = this.waiting.get(reply.id);
      if (!w) return;
      this.waiting.delete(reply.id);
      if (reply.ok) w.resolve(reply.result);
      else w.reject(new Error(reply.error));
    });
  }

  call<K extends SimRequest['op']>(
    request: Extract<SimRequest, { op: K }>
  ): Promise<SimResponseMap[K]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.port.postMessage({ id, request } satisfies Envelope);
    });
  }

  dispose(): void {
    this.unsubscribe();
    for (const w of this.waiting.values()) w.reject(new Error('client disposed'));
    this.waiting.clear();
  }
}

/** Two connected in-memory ports (tests, or running the sim on the main thread). */
export function createPortPair(): [PortLike, PortLike] {
  const listeners: [Set<(d: unknown) => void>, Set<(d: unknown) => void>] = [new Set(), new Set()];
  const make = (self: 0 | 1): PortLike => ({
    postMessage(data) {
      const copy = JSON.parse(JSON.stringify(data)) as unknown;
      void Promise.resolve().then(() => listeners[self === 0 ? 1 : 0].forEach((l) => l(copy)));
    },
    onMessage(listener) {
      listeners[self].add(listener);
      return () => listeners[self].delete(listener);
    },
  });
  return [make(0), make(1)];
}
