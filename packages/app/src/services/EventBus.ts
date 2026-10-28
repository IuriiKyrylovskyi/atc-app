/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import type { PopupPlaneData } from '@/components/game/SpeedControlPopup.vue';
import type {
  GameInitData,
  LevelCompleteData,
  CollisionData,
  ScoreUpdateData,
  PlaneData,
  Point,
} from '@/types/game';

/**
 * Type-safe event bus for Vue ↔ Game communication
 */
export interface GameEvents {
  // ========== Game Lifecycle ==========
  'game:init': (data: GameInitData) => void;
  'game:ready': () => void;
  'game:start': () => void;
  'game:pause': () => void;
  'game:resume': () => void;
  'game:restart': () => void;
  'game:over': (data: { score: number; reason: string }) => void;
  'game:destroyed': () => void;

  // ========== Level Events ==========
  'level:start': (levelId: number) => void;
  'level:complete': (data: LevelCompleteData) => void;
  'level:failed': (reason: string) => void;

  // ========== Plane Events ==========
  'plane:spawned': (planeData: PlaneData) => void;
  'plane:path-assigned': (planeId: number, path: Point[]) => void;
  'plane:attached': (planeId: number, target: 'runway' | 'waypoint') => void;
  'plane:landed': (planeId: number, score: number) => void;
  'plane:collision': (data: CollisionData) => void;
  'plane:offscreen': (data: { planeId: number }) => void;
  // Left the screen while following an airway without reaching its exit.
  'plane:missed': (data: { planeId: number }) => void;
  'plane:warning': (planeId: number, hasWarning: boolean) => void;
  'plane:waypoint-passed': (planeId: number, score: number) => void;

  // ========== Score & Stats ==========
  'score:update': (data: ScoreUpdateData) => void;
  'stats:update': (stats: {
    activePlanes: number;
    planesLanded: number;
    waypointPasses: number;
    conflicts: number;
    planesMissed?: number;
    planesTarget?: number;
  }) => void;

  // ========== Speed control popup ==========
  'plane:tapped': (data: PopupPlaneData) => void;
  'plane:tap-deselect': () => void;
  'plane:setSpeed': (data: { planeId: number; speed: number }) => void;
  'plane:cancelApproach': (data: { planeId: number }) => void;
  'plane:resumeApproach': (data: { planeId: number }) => void;
  'popup:opened': () => void;
  'popup:closed': () => void;
  // Ask the canvas to close the speed popup (e.g. from the HUD).
  'popup:close': () => void;

  // ========== UI Events ==========
  'ui:show-warning': (message: string) => void;
  'ui:show-notification': (notification: {
    type: 'success' | 'warning' | 'error' | 'info';
    message: string;
  }) => void;

  // ========== Input Events ==========
  'input:drag-start': (planeId: number, position: Point) => void;
  'input:drag-move': (position: Point) => void;
  'input:drag-end': () => void;

  // ========== Settings Events ==========
  'settings:audio': (audio: {
    masterVolume: number;
    musicVolume: number;
    sfxVolume: number;
    muted: boolean;
  }) => void;
  'settings:graphics': (graphics: {
    quality: 'low' | 'medium' | 'high';
    particles: boolean;
  }) => void;
  // ✅ NEW: Zoom settings
  'settings:zoom': (zoom: number) => void;
  'settings:controls': (controls: { hapticFeedback: boolean }) => void;
  // ✅ NEW: Background dimming settings
  'settings:background': (background: { dimming: number; alpha: number }) => void;

  // ========== Loading Events ==========
  'loading:progress': (percent: number) => void;
  'loading:complete': () => void;

  // ========== Boot / scene lifecycle ==========
  'assets:progress': (data: { pct: number; step: string }) => void;
  'game:scene-ready': () => void;
  // The Vue loader overlay finished fading out (music may start).
  'loader:done': () => void;

  // ========== Asset Events ==========
  'assets:loaded': () => void;
  'assets:error': (assetKey: string) => void;
}

/**
 * Simple browser-compatible Event Emitter
 */
class SimpleEventEmitter {
  private events: Map<string, Function[]> = new Map();
  private maxListeners: number = 50;

  setMaxListeners(max: number): void {
    this.maxListeners = max;
  }

  on(event: string, listener: Function): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    const listeners = this.events.get(event)!;

    if (listeners.length >= this.maxListeners) {
      console.warn(`Max listeners (${this.maxListeners}) exceeded for event: ${event}`);
    }

    listeners.push(listener);
  }

  off(event: string, listener: Function): void {
    const listeners = this.events.get(event);
    if (!listeners) return;

    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }

    if (listeners.length === 0) {
      this.events.delete(event);
    }
  }

  emit(event: string, ...args: unknown[]): void {
    const listeners = this.events.get(event);
    if (!listeners || listeners.length === 0) return;

    // Create a copy to avoid issues if listeners are removed during emit
    const listenersCopy = [...listeners];

    for (const listener of listenersCopy) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      }
    }
  }

  once(event: string, listener: Function): void {
    const onceWrapper = (...args: unknown[]) => {
      this.off(event, onceWrapper);
      listener(...args);
    };
    this.on(event, onceWrapper);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }

  listenerCount(event: string): number {
    const listeners = this.events.get(event);
    return listeners ? listeners.length : 0;
  }

  eventNames(): string[] {
    return Array.from(this.events.keys());
  }
}

class TypedEventBus {
  private emitter = new SimpleEventEmitter();

  constructor() {
    // Increase max listeners for game events
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof GameEvents>(event: K, listener: GameEvents[K]): void {
    this.emitter.on(event, listener as Function);
  }

  off<K extends keyof GameEvents>(event: K, listener: GameEvents[K]): void {
    this.emitter.off(event, listener as Function);
  }

  emit<K extends keyof GameEvents>(event: K, ...args: Parameters<GameEvents[K]>): void {
    this.emitter.emit(event, ...args);
  }

  once<K extends keyof GameEvents>(event: K, listener: GameEvents[K]): void {
    this.emitter.once(event, listener as Function);
  }

  removeAllListeners<K extends keyof GameEvents>(event?: K): void {
    this.emitter.removeAllListeners(event);
  }

  // Debug helper
  listenerCount<K extends keyof GameEvents>(event: K): number {
    return this.emitter.listenerCount(event);
  }

  // Get all event names
  eventNames(): string[] {
    return this.emitter.eventNames();
  }
}

// Singleton instance
export const gameEventBus = new TypedEventBus();

// Debug helper (only in development)
if (import.meta.env.DEV) {
  (window as unknown as { __gameEventBus: TypedEventBus }).__gameEventBus = gameEventBus;
}
