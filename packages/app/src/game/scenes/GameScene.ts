import Phaser from 'phaser';
import { Plane } from '@/game/objects/Plane';
import { Runway } from '@/game/objects/Runway';
import { Waypoint } from '@/game/objects/Waypoint';
import { gameEventBus } from '@/services/EventBus';
import {
  getLevelById,
  getLevelByNumber,
  getTrainingLevelByNumber,
} from '@/game/config/levels.config';
import { useGameStore } from '@/stores/game';
import { useMonetizationStore } from '@/stores/monetization';
// backgroundAssetService: resolves, downloads, checksum-verifies, and caches
// EVERY level's background (free from the public bucket, paid from the
// private one with RLS) on-demand — no level's background ships in the app
// bundle. FREE_LEVEL_LIMIT: imported to gate paid downloads behind
// monetization.canAccessLevel(); free levels never need that check.
// ⚠️  DO NOT REMOVE — without this no background will ever load.
import { getBackgroundForAirport } from '@/services/backgroundAssetService';
import { getAirportById } from '@/game/config/airports.config';
import type { Point, LevelConfig, GameInitData } from '@/types/game';
import { getDeviceType, getAllPlaneTypes } from '@/game/config/planes.config';
import {
  getBackgroundKeyForAirport,
  getFallbackBackgroundKeyForAirport,
} from '@/game/utils/assetLoader';
import type { BackgroundManifestEntry } from '@/game/utils/backgroundVariantResolver';
import { detectAspectRatio } from '@/game/config/aspectRatio.config';
import { CollisionSystem } from '@/game/systems/CollisionSystem';
import { DEPTH } from '@/game/constants/depth.constants';
import { AudioSystem } from '@/game/systems/AudioSystem';
import { EntryDotsSystem } from '@/game/systems/EntryDotsSystem';
import { DrawSystem } from '@/game/systems/DrawSystem';
import { SpawnSystem } from '@/game/systems/SpawnSystem';
import { InputSystem, type InputState } from '@/game/systems/InputSystem';

export class GameScene extends Phaser.Scene {
  // Level data
  public currentLevel: LevelConfig | null = null;
  public currentLevelId: string | null = null;
  private rawLevel: LevelConfig | null = null; // original fraction-based level, never pixel-converted
  public levelNumber: number = 1;

  // Game objects
  public planes: Plane[] = [];
  public runways: Runway[] = [];
  public waypoints: Waypoint[] = [];

  // Input state — owned by InputSystem; stored here so InputContext can reference it
  public inputState!: InputState;
  public waypointConnections: Map<number, { waypoint: Waypoint; exitPoint: Point }> = new Map();

  // -- Performance cache --
  // World-to-screen transform recomputed once per update(), not inside dot loops.
  public _cachedScale: number = 1;
  public _cachedCX: number = 0;
  public _cachedCY: number = 0;
  // Conflict count computed inside checkCollisions() -- reused for stats emit.
  public _cachedConflictCount: number = 0;
  // Stats throttle: emit ~10x/s instead of every frame.
  private _lastStatsEmit: number = 0;
  // Depth sort dirty flag — set to true whenever a plane changes altitude level.
  // worldContainer.sort() only runs on frames where this is true, instead of every frame.
  // Plane.ts sets this on the scene via scene._depthDirty = true when calling setDepth().
  public _depthDirty: boolean = true; // true on first frame to ensure initial sort
  // --

  // Spawn timing — public so SpawnSystem can mutate them via SpawnContext
  public lastDepartureTime: number = 0;
  public lastRandomSpawnTime: number = 0;

  // Collision tracking
  public collidedPlanes: Set<number> = new Set();
  public isGameOver: boolean = false;
  public isLevelComplete: boolean = false;
  public collisionGraphics!: Phaser.GameObjects.Graphics;
  public entryZoneGraphics!: Phaser.GameObjects.Graphics;

  // Bound event listener references — stored so shutdown() can remove the exact same
  // function instances that were registered.  Using .bind() inline in on()/off() creates
  // a new reference each time, so off() would never find the original and listeners leak.
  private _onZoomChange!: (zoom: number) => void;
  private _onBackgroundChange!: (bg: { dimming: number; alpha: number }) => void;
  private _onGameInit!: (data: GameInitData) => void;
  private _onGameRestart!: () => void;

  // Speed-control popup listeners (SESSION 4)
  private _onSetSpeed!: (d: { planeId: number; speed: number }) => void;
  private _onCancelApproach!: (d: { planeId: number }) => void;
  private _onTapDeselect!: () => void;

  // -------------------------------------------------------------------------
  // ENTRY CORNER CONFIG
  // Each corner defines how much of the world edge is BLOCKED (no-entry zone).
  // Values are fractions of the half-extents:
  //   w: fraction of hw (WORLD_W/2 = 960) blocked along the horizontal edge
  //   h: fraction of hh (WORLD_H/2 = 540) blocked along the vertical edge
  //
  // Derived from GameHUD element positions at worldScale ≈ 0.75 (typical
  // tablet landscape).  Formula: fraction = element_edge_px / (half_extent × worldScale)
  //
  //   topLeft     — LANDED/ROUTE stats panel (top:20 left:20, ~200×90px + 20px buffer)
  //   topRight    — SCORE + plane icon panel  (top:20 right:20, ~210×90px + 20px buffer)
  //   bottomLeft  — settings button           (bottom:30 left:30, 60×60px + 20px buffer)
  //   bottomRight — play-pause button         (bottom:30 right:30, 60×60px + 20px buffer)
  //
  // Keep SPAWN_EDGE_MARGIN_X/Y in SpawnSystem.ts in sync:
  //   margin% = max_corner_fraction × 50
  //   X → max(0.35, 0.33, 0.18, 0.18) = 0.35 → 18 %
  //   Y → max(0.28, 0.28, 0.28, 0.28) = 0.28 → 14 %
  // -------------------------------------------------------------------------
  public readonly ENTRY_CORNERS = {
    topLeft: { w: 0.35, h: 0.28 }, // stats panel
    topRight: { w: 0.33, h: 0.28 }, // score + plane icon
    bottomLeft: { w: 0.18, h: 0.28 }, // settings button
    bottomRight: { w: 0.18, h: 0.28 }, // play-pause button
  };

  // Configuration — public so SpawnSystem can read plane count limits via SpawnContext
  public MAX_PLANES = 7;
  public MIN_PLANES = 1;
  // Path constants live in PathProcessor (imported above).

  // Plane textures — public so SpawnSystem can read via SpawnContext
  // Texture registry: compound keys "{typeId}-{color}" → same key (truthy = loaded).
  // SpawnSystem checks planeTextures[`${typeId}-${colour}`] before constructing a Plane.
  public planeTextures: { [textureKey: string]: string } = {};

  // Stats
  private landedCount: number = 0;
  private waypointPassCount: number = 0;
  /** Planes that exited the world without any runway/waypoint connection. */
  private missedCount: number = 0;

  // World container — public so SpawnSystem can add planes to it via SpawnContext
  public worldContainer!: Phaser.GameObjects.Container;
  public readonly WORLD_W = 1920; // reference world width (DPR-independent)
  public readonly WORLD_H = 1080; // reference world height

  // Background
  private background!: Phaser.GameObjects.Image;
  private brightnessOverlay!: Phaser.GameObjects.Graphics; // black rect, alpha 0–1
  private backgroundKey: string | null = null;
  private bgImageW: number = 0;
  private bgImageH: number = 0;
  private backgroundMetadata: BackgroundManifestEntry | null = null;

  // Settings state
  private currentZoom: number = 1.0;
  private backgroundDimming: number = 0; // 0–100 %, maps directly to overlay alpha
  public viewportBounds!: Phaser.Geom.Rectangle;

  private debugText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  /**
   * Initialize scene with level data
   */
  init(data?: { level?: number; levelId?: string }): void {
    // Priority: data passed by scene.start() → gameStore.currentLevel → 1
    const gameStore = useGameStore();
    this.levelNumber = data?.level ?? gameStore.currentLevel ?? 1;
    this.currentLevelId = data?.levelId ?? gameStore.currentLevelId;
    console.log(
      `🎮 Initializing Level ${this.levelNumber}${
        this.currentLevelId ? ` (${this.currentLevelId})` : ''
      }`
    );
  }

  preload(): void {
    // Preload handled by BootScene
  }

  private async loadLevelBackground(): Promise<void> {
    // Guard on rawLevel (set by loadLevel()) rather than currentLevel.
    if (!this.rawLevel) {
      console.warn('⚠️ No level loaded, using default background');
      return;
    }

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    const ratio = width / height;
    // Use the airport-keyed backgroundImage field for background lookup.
    // This replaces the old numeric level-based scheme (level-N-ratio) which
    // broke when levels were grouped by airport rather than sequential position.
    const bgKey = this.rawLevel.backgroundImage;

    console.log(`🖼️ Loading background for Level ${this.levelNumber} (${bgKey})`);
    console.log(`   Camera: ${width}x${height} (${ratio.toFixed(3)})`);

    // ── Background download ──────────────────────────────────────────────────
    //
    // No level's background ships in the app bundle — free or paid. Both are
    // downloaded on demand and cached locally by backgroundAssetService,
    // which picks the bucket (public for free, private+RLS for paid)
    // internally based on the level number. See its header for why free
    // levels moved off bundling too (every ratio/dpr/format combination for
    // every free level, when a device only ever needs one, was pure app-size
    // waste — worse on mobile where install size affects conversion).
    //
    // For PAID levels specifically, only attempt the download if the user
    // can actually access this level — no wasted bandwidth, and no request
    // against a bucket that would reject it anyway (RLS enforces this
    // server-side regardless; this check just avoids the doomed round-trip).
    //
    // ⚠️  DO NOT load paid backgrounds in BootScene — they must stay
    //     deferred until after purchase verification. Free levels ARE fine
    //     to preload in BootScene (see BootScene.ts), so this call is a
    //     no-op there if the texture's already loaded and cached.
    const monetization = useMonetizationStore();
    const isFreeAirport = getAirportById(bgKey)?.tier === 'free';
    const canLoad = isFreeAirport || monetization.canAccessLevel(this.levelNumber);

    if (canLoad) {
      const expectedKey = getBackgroundKeyForAirport(bgKey);
      if (!this.textures.exists(expectedKey)) {
        const asset = await getBackgroundForAirport(bgKey);
        if (asset) {
          this.backgroundMetadata = asset.entry;
          if (!this.textures.exists(asset.key)) {
            // addBase64, NOT load.image — asset.url is always a data: URI
            // (see backgroundAssetService.ts §3). addBase64 uses an <img>
            // element directly, bypassing Phaser's XHR-based loader, which
            // most CSPs' connect-src would otherwise block (this was a real
            // bug: blob: URLs were getting silently CSP-rejected here).
            await new Promise<void>((resolve) => {
              this.textures.once(Phaser.Textures.Events.ADD, (addedKey: string) => {
                if (addedKey === asset.key) resolve();
              });
              this.textures.addBase64(asset.key, asset.url);
            });
          }
          this.backgroundKey = asset.key;
        } else {
          console.error(`Failed to obtain background for airport: ${bgKey}`);
        }
      } else {
        // Already cached/loaded (e.g. BootScene preloaded this free airport) —
        // still need backgroundMetadata for projectMasterToWorld. Re-resolve
        // without re-downloading (fetchAssetForEntry checks cache first).
        const asset = await getBackgroundForAirport(bgKey);
        this.backgroundMetadata = asset?.entry ?? null;
        this.backgroundKey = expectedKey;
      }
    } else {
      console.error(`User cannot access level ${this.levelNumber} — no background will load`);
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (!this.backgroundKey || !this.textures.exists(this.backgroundKey)) {
      console.warn(`⚠️ No background loaded for level ${this.levelNumber}`);

      const allTextures = Object.keys(this.textures.list);
      const backgroundTextures = allTextures.filter((key) => key.startsWith('bg-'));
      console.log(`📦 Available backgrounds:`, backgroundTextures);

      const loadedBackgrounds = backgroundTextures.reduce((acc, key) => {
        acc[key] = key;
        return acc;
      }, {} as { [key: string]: string });

      this.backgroundKey = getFallbackBackgroundKeyForAirport(bgKey, loadedBackgrounds);

      if (!this.backgroundKey) {
        console.error(`❌ No suitable background found for airport: ${bgKey}`);
        return;
      }
    }

    console.log(`✅ Using background: ${this.backgroundKey}`);

    this.createBackground(this.backgroundKey);
  }

  /**
   * Create background image inside worldContainer at (0,0).
   * Stretched to fill the WORLD_WxWORLD_H reference rect exactly.
   * worldContainer's scale then cover-fits it to any screen.
   */
  private createBackground(textureKey: string): void {
    if (this.background) {
      this.background.destroy();
    }

    if (!this.textures.exists(textureKey)) {
      console.error(`❌ Background texture missing: ${textureKey}`);
      return;
    }

    // -------------------------------------------------------------------------
    // ANDROID WEBGL TEXTURE LIMIT GUARD — DO NOT REMOVE
    //
    // Android GPUs hard-cap WebGL textures at MAX_TEXTURE_SIZE (4096 px on most
    // devices). Phaser loads the file fine and reports bg.visible === true, but
    // the GPU silently refuses to upload anything larger — the image renders as
    // invisible black. The background images for mobile ratios are typically
    // 5376×3072, which exceeds 4096 on the long axis.
    //
    // Fix: draw the oversized source to an off-screen <canvas> scaled to fit
    // within maxTex, register that as a new Phaser texture, use it instead.
    // No asset pre-processing required — happens at runtime automatically.
    //
    // DO NOT replace this with setDepth(-1) — depth -1 was the OLD code that
    // caused the invisible-background bug on Android WebGL.
    // DO NOT remove the _scaled texture swap — it is the only reliable fix.
    // -------------------------------------------------------------------------
    const gl = (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl as
      | WebGLRenderingContext
      | undefined;
    const maxTex: number = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 4096;
    const src = this.textures.get(textureKey).getSourceImage() as
      | HTMLImageElement
      | HTMLCanvasElement;
    const srcW: number =
      (src as HTMLImageElement).naturalWidth || (src as HTMLCanvasElement).width || 0;
    const srcH: number =
      (src as HTMLImageElement).naturalHeight || (src as HTMLCanvasElement).height || 0;

    console.log(`🖼️ createBackground ${textureKey}: ${srcW}x${srcH}, GL max=${maxTex}`);

    let finalKey = textureKey;
    if (srcW > 0 && srcH > 0 && (srcW > maxTex || srcH > maxTex)) {
      const scale = Math.min(maxTex / srcW, maxTex / srcH);
      const dstW = Math.floor(srcW * scale);
      const dstH = Math.floor(srcH * scale);
      const canvas = document.createElement('canvas');
      canvas.width = dstW;
      canvas.height = dstH;
      canvas.getContext('2d')!.drawImage(src as CanvasImageSource, 0, 0, dstW, dstH);
      const scaledKey = textureKey + '_scaled';
      if (this.textures.exists(scaledKey)) this.textures.remove(scaledKey);
      this.textures.addCanvas(scaledKey, canvas);
      finalKey = scaledKey;
      console.warn(`⚠️ Texture downscaled ${srcW}x${srcH} -> ${dstW}x${dstH} (GL max ${maxTex})`);
    }
    // -------------------------------------------------------------------------

    this.background = this.add.image(0, 0, finalKey);

    const textureWidth = this.background.width;
    const textureHeight = this.background.height;

    // Uniform cover-fit scale: the device-native texture (e.g. 2400×1080 for 20:9)
    // is scaled uniformly so it COVERS the 1920×1080 world rect without distortion.
    // The excess on the overflowing axis is clipped by the world bounds — the same
    // clipping the worldContainer's cover-scale already causes on non-16:9 screens.
    //
    // The old non-uniform setScale(WORLD_W/texW, WORLD_H/texH) squished the image
    // (e.g. 0.8× on X for 20:9) — that's what caused the background shrink/expand
    // distortion on mobile. Uniform scaling preserves the native aspect ratio.
    //
    // setOrigin(0.5, 0.5) + setPosition(0, 0) centers the texture in world space
    // so its centre (and the crop centre) maps to the world centre — matching
    // the overflow offset now applied in projectMasterToWorld().
    const bgScale = Math.max(this.WORLD_W / textureWidth, this.WORLD_H / textureHeight);
    this.background.setScale(bgScale);
    this.background.setOrigin(0.5, 0.5);
    this.background.setPosition(0, 0);
    this.background.setAlpha(1);
    this.background.setDepth(0);
    this.worldContainer.add(this.background);

    // Brightness overlay — full-world black rectangle sitting directly above the
    // background image (depth 1).  Alpha 0 = fully transparent, 1 = solid black.
    // Destroyed and re-created here so resizes/restarts always get a fresh instance.
    if (this.brightnessOverlay) this.brightnessOverlay.destroy();
    this.brightnessOverlay = this.add.graphics();
    this.brightnessOverlay.fillStyle(0x000000, 1);
    this.brightnessOverlay.fillRect(
      -this.WORLD_W / 2,
      -this.WORLD_H / 2,
      this.WORLD_W,
      this.WORLD_H
    );
    this.brightnessOverlay.setAlpha(this.backgroundDimming / 100);
    this.brightnessOverlay.setDepth(1); // explicit depth 1: above bg (0), below entry zones (100) and all game objects
    this.worldContainer.add(this.brightnessOverlay);

    this.bgImageW = textureWidth;
    this.bgImageH = textureHeight;

    console.log(
      `✅ Background in worldContainer: ${textureWidth}x${textureHeight} -> ${this.WORLD_W}x${this.WORLD_H}`
    );
  }

  /**
   * Update viewport bounds (call on resize)
   */
  private updateViewportBounds(): void {
    const cam = this.cameras.main;

    // ✅ Viewport bounds are in CAMERA coordinates
    this.viewportBounds = new Phaser.Geom.Rectangle(
      cam.scrollX,
      cam.scrollY,
      cam.width, // ✅ Camera width (DPR scaled)
      cam.height // ✅ Camera height (DPR scaled)
    );

    console.log(`📐 Viewport bounds: ${cam.width}x${cam.height} (camera coords)`);
  }

  /** Cover-scale: fill the full camera with the world so no black edges appear.
   *  One axis always fills 100 %; the other may extend slightly beyond the camera
   *  edge but is never letterboxed.  World content near extreme edges can scroll
   *  off-screen on non-16:9 displays, but the playfield is always gap-free. */
  private getWorldScale(): number {
    const camW = this.cameras.main.width;
    const camH = this.cameras.main.height;
    return Math.max(camW / this.WORLD_W, camH / this.WORLD_H);
  }

  /** Screen edges in world-local coordinates — used by EntryDotsSystem.draw(). */
  private getScreenBoundsInWorld() {
    const s = this.getWorldScale();
    const camW = this.cameras.main.width;
    const camH = this.cameras.main.height;
    return {
      left: -camW / (2 * s),
      right: camW / (2 * s),
      top: -camH / (2 * s),
      bottom: camH / (2 * s),
      w: camW / s,
      h: camH / s,
    };
  }
  private applyWorldTransform(): void {
    const camW = this.cameras.main.width;
    const camH = this.cameras.main.height;
    const s = this.getWorldScale();
    this.worldContainer.setScale(s);
    this.worldContainer.setPosition(camW / 2, camH / 2);
    this.snapWaypointsToEdges();
  }

  /**
   * Snap each waypoint to the nearest screen edge (in world-local coords).
   *
   * WHY SCREEN EDGES, NOT WORLD BOUNDS
   * ────────────────────────────────────
   * worldContainer uses cover-fit scaling: on non-16:9 screens the scale
   * factor is chosen so the world fills the camera without letterboxing.
   * This means the screen edges in world-local space are SMALLER than
   * ±WORLD_W/2 / ±WORLD_H/2 on the axis that overflows:
   *
   *   screenEdge = camSize / (2 * worldScale)   where worldScale = max(camW/WORLD_W, camH/WORLD_H)
   *
   * Snapping to ±hw/±hh (the world boundary) placed waypoints off-screen
   * on any display wider than 16:9 (e.g. 20:9 phones) because the world
   * boundary extends beyond the visible camera area on the wider axis.
   *
   * Fix: snap to getScreenBoundsInWorld() — the actual visible edges —
   * with margin = 0 so the icon sits exactly on the screen boundary.
   * The approach triangle points inward (toward world centre); it is fully
   * on-screen because it fans in from the edge. The exit line extends
   * outward but is immediately clipped by the camera — correct behaviour.
   *
   * redraw() is called after setPosition() so draw() recomputes angles from
   * the snapped position. Without redraw() the triangles point toward the
   * original config position instead of the correct inbound direction.
   * DO NOT remove the redraw() call.
   */
  private snapWaypointsToEdges(): void {
    // Screen edges expressed in world-local coordinates.
    // On a 16:9 display these equal ±hw / ±hh exactly.
    // On wider/narrower displays one pair of edges shrinks below ±hw / ±hh.
    const bounds = this.getScreenBoundsInWorld();
    const edgeLeft = bounds.left; // e.g. −960 on 16:9, less negative on wider screens
    const edgeRight = bounds.right;
    const edgeTop = bounds.top;
    const edgeBottom = bounds.bottom;

    this.waypoints.forEach((wp) => {
      const wx = wp.worldLocalX;
      const wy = wp.worldLocalY;

      // Distance from the waypoint's logical position to each screen edge.
      const dLeft = wx - edgeLeft; // how far right of the left edge
      const dRight = edgeRight - wx; // how far left of the right edge
      const dTop = wy - edgeTop; // how far below the top edge
      const dBottom = edgeBottom - wy; // how far above the bottom edge
      const nearest = Math.min(dLeft, dRight, dTop, dBottom);

      // Place the icon exactly on the nearest screen edge; keep the
      // orthogonal axis at the waypoint's original world-local position.
      let fx = wx;
      let fy = wy;
      if (nearest === dLeft) fx = edgeLeft;
      else if (nearest === dRight) fx = edgeRight;
      else if (nearest === dTop) fy = edgeTop;
      else fy = edgeBottom;

      wp.setPosition(fx, fy);
      // No setScale — worldContainer.scale is inherited by all children.
      wp.redraw(); // recompute angles from the new snapped position
    });
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    const newW = gameSize.width;
    const newH = gameSize.height;

    console.log(`🔄 Screen resized: ${newW}x${newH}`);

    // Planes, runways, and background are all inside worldContainer.
    // Just update the camera and re-apply the world transform -- everything moves automatically.
    this.cameras.main.setSize(newW, newH);
    this.updateViewportBounds();
    this.applyWorldTransform();

    if (this.debugText) {
      this.updateDebugOverlay();
    }
  }

  async create(): Promise<void> {
    // Startup diagnostics -- always logged (not DEV-only) so adb logcat works on release builds
    {
      const deviceType = getDeviceType();
      const ratio =
        Math.max(window.innerWidth, window.innerHeight) /
        Math.min(window.innerWidth, window.innerHeight);
      const native = window.__DEVICE_INFO__;
      console.log(`📱 Device Type: ${deviceType}`);
      console.log(`📐 screen: ${screen.width}x${screen.height}`);
      console.log(
        `📐 inner:  ${window.innerWidth}x${window.innerHeight}  ratio:${ratio.toFixed(3)}`
      );
      console.log(`📐 DPR: ${window.devicePixelRatio}`);
      console.log(`📐 __DEVICE_INFO__: ${native ? JSON.stringify(native) : 'NOT INJECTED'}`);
      const aspectRatio = detectAspectRatio();
      console.log(`📐 Matched aspect ratio: ${aspectRatio.ratio}`);
    }

    // ✅ Initialize viewport bounds
    this.updateViewportBounds();

    // -- World container: background + runways + planes live here --
    this.worldContainer = this.add.container(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2
    );
    this.worldContainer.setDepth(0);
    // NOTE: Container.setDepthSorting() was added in Phaser 3.60 and is not available
    // in older builds.  Instead we call worldContainer.sort('depth') manually:
    //   • once at the end of create() after all static children are added
    //   • once per frame in update() to reflect dynamic plane altitude changes
    // Array.sort on ≤ ~15 children uses TimSort, which is O(n) on nearly-sorted data.

    // Sync backgroundDimming from the settings store before createBackground() runs.
    // this.backgroundDimming defaults to 0 and is never populated from storage
    // otherwise — so the overlay always started at alpha 0 on scene init regardless
    // of the user's saved setting.  handleBackgroundChange only fires for runtime
    // changes, so without this the stored value is silently lost on every restart.
    {
      const { useSettingsStore } = await import('@/stores/settings');
      this.backgroundDimming = useSettingsStore().gameplay.backgroundDimming;
    }

    // Load level and background, then apply cover-scale world transform
    this.loadLevel(this.levelNumber);
    await this.loadLevelBackground();

    // Convert raw level now that background metadata may be available
    this.currentLevel = this.convertRawLevel();

    // Update configuration from level
    if (this.currentLevel) {
      this.MAX_PLANES = this.currentLevel.maxPlanes;
      this.MIN_PLANES = this.currentLevel.minPlanes;
      console.log(`📋 Loaded: ${this.currentLevel.name}`);
      console.log(`   Difficulty: ${this.currentLevel.difficulty}`);
      console.log(`   Camera: ${this.cameras.main.width}x${this.cameras.main.height}`);
      console.log(`   Max Planes: ${this.MAX_PLANES}`);
      console.log(`   Runways: ${this.currentLevel.runways.length}`);
      console.log(`   Waypoints: ${this.currentLevel.waypoints.length}`);
    }

    this.applyWorldTransform();

    // Prime the transform cache so coordinate helpers work before the first update() tick.
    this._cachedScale = this.getWorldScale();
    this._cachedCX = this.worldContainer.x;
    this._cachedCY = this.worldContainer.y;

    // InputSystem registers pointer events and allocates all dot/projection Graphics.
    // Returns InputState which must be stored for every subsequent InputContext call.
    this.inputState = InputSystem.setup(this);

    EntryDotsSystem.setup(this);

    this.collisionGraphics = this.add.graphics();
    this.collisionGraphics.setDepth(2000);

    // Entry zone overlay — inside worldContainer so it scales with the world
    this.entryZoneGraphics = this.add.graphics();
    this.entryZoneGraphics.setDepth(DEPTH.ENTRY_ZONES); // 100 — above background (0), below runways (200)
    this.worldContainer.add(this.entryZoneGraphics);
    DrawSystem.drawEntryZones(this);

    // Initial depth sort of all static worldContainer children.
    // Planes added later are sorted each frame in update().
    this.worldContainer.sort('depth');

    console.log(
      `🎮 GameScene created: world ${this.WORLD_W}x${
        this.WORLD_H
      } @ scale ${this.getWorldScale().toFixed(3)}`
    );

    // Runways inside worldContainer; waypoints screen-space edge-snapped
    this.createRunwaysFromLevel();
    this.createWaypointsFromLevel();

    // Setup plane textures
    this.setupPlaneTextures();

    // Spawn initial plane
    SpawnSystem.trySpawn(this);

    // Listen for settings changes
    this.setupSettingsListeners();

    // Listen for resize
    this.scale.on('resize', this.handleResize, this);

    // Debug overlay -- dev builds only. Stripped entirely in production by Vite.
    // Must be created BEFORE scale.refresh() so resize handler has debugText ready.
    if (import.meta.env.DEV) {
      this.createDebugOverlay();
    }

    // ✅ Force Phaser to re-read canvas.getBoundingClientRect() so pointer.x/y
    // are in canvas-pixel space from the very first touch/click.
    // Without this, coordinates are only corrected after the first window resize.
    this.scale.refresh();

    // Emit ready event
    gameEventBus.emit('game:ready');

    // Emit scene-ready so the Vue HUD overlay becomes visible.
    // This fires AFTER all game objects are created — GameHUD must stay
    // hidden until this event or it overlays the BootScene loading screen.
    // ⚠️  Do not move this above the game object setup — the HUD must not
    //     appear while the scene is still being built.
    const sceneReadyTime = performance.now();
    console.log(`🎯 [${sceneReadyTime.toFixed(2)}ms] GameScene: EMIT game:scene-ready`);
    gameEventBus.emit('game:scene-ready');

    // Start background music when Vue loader finishes fading out (not a fixed delay).
    // Listen for loader:done event from AirTrafficCanvas which fires when the
    // animated progress reaches 100% AND the fade transition completes.
    const onLoaderDone = () => {
      // Guard: scene may have been destroyed/restarted by the time this fires.
      // Use sys.isActive() which is set to false in shutdown(), and check the
      // scene's own key via sys.config.key.
      const sysActive = this.sys?.isActive();
      const config = this.sys?.config;
      const sceneKey = typeof config === 'string' ? config : config?.key;
      console.log('🎵 GameScene: loader:done received', {
        sysActive,
        sceneKey,
        sys: !!this.sys,
        game: !!this.game,
      });
      if (!sysActive || sceneKey !== 'GameScene') {
        console.log(
          '🎵 GameScene: loader:done received but scene no longer active, skipping music start'
        );
        gameEventBus.off('loader:done', onLoaderDone);
        return;
      }
      const musicStartTime = performance.now();
      console.log(
        `🎵 [${musicStartTime.toFixed(2)}ms] GameScene: START MUSIC (triggered by loader:done, ${(
          musicStartTime - sceneReadyTime
        ).toFixed(2)}ms after scene-ready)`
      );
      console.log('🎵 GameScene: calling AudioSystem.startMusic', {
        sceneActive: sysActive,
        sceneKey,
      });
      AudioSystem.startMusic(this);
      gameEventBus.off('loader:done', onLoaderDone);
    };
    gameEventBus.on('loader:done', onLoaderDone);
    console.log('🎵 GameScene: registered loader:done listener');

    // Pre-load interstitial ad in the background — no-op for premium users.
    // Ad will be ready to show instantly when the level ends.
    // Skipped in training mode.
    const gameStore = useGameStore();
    if (gameStore.trainingLevel === null) {
      useMonetizationStore().preloadAd();
    }

    console.log('✅ GameScene created successfully');
  }

  /**
   * Setup settings event listeners.
   *
   * Listeners are stored as instance properties so shutdown() can pass the exact
   * same function reference to off() — .bind() creates a new object each call so
   * inline off(event, handler.bind(this)) never matches the registered listener.
   */
  private setupSettingsListeners(): void {
    this._onZoomChange = this.handleZoomChange.bind(this);
    this._onBackgroundChange = this.handleBackgroundChange.bind(this);
    this._onGameInit = (data: GameInitData) => {
      // Guard: scene plugin can be null if the event fires before the scene
      // is fully active (e.g. emitted from [TODO: define component] during hard restart).
      if (!this.scene?.scene) return;

      const gameStore = useGameStore();
      const targetLevelId = data.levelKey ?? gameStore.currentLevelId;
      const targetLevelNumber =
        typeof data.levelId === 'number' && Number.isFinite(data.levelId)
          ? data.levelId
          : gameStore.currentLevel;
      if (
        targetLevelNumber &&
        targetLevelNumber !== this.levelNumber &&
        targetLevelId &&
        targetLevelId !== this.currentLevelId
      ) {
        this.levelNumber = targetLevelNumber;
        this.currentLevelId = targetLevelId;
        this.scene.restart({ level: targetLevelNumber, levelId: targetLevelId });
      }
    };
    // Fired by AirTrafficCanvas "Try Again" button.
    // scene.resume() is required first — restarting a paused scene is a no-op.
    this._onGameRestart = () => {
      this.scene.resume();
      this.scene.restart({ level: this.levelNumber });
    };

    gameEventBus.on('settings:zoom', this._onZoomChange);
    gameEventBus.on('settings:background', this._onBackgroundChange);
    gameEventBus.on('game:init', this._onGameInit);
    gameEventBus.on('game:restart', this._onGameRestart);

    // ── Speed-control popup (SESSION 4) ──────────────────────────────────────
    // Stored as instance refs (same pattern as above) so shutdown() can match them.
    this._onSetSpeed = ({ planeId, speed }) => {
      const plane = this.planes.find((p) => p.id === planeId);
      if (plane) plane.setTargetSpeed(speed);
    };

    // ── plane:cancelApproach ─────────────────────────────────────────────────
    //
    // Fired by SpeedControlPopup when the player presses "Cancel approach" or
    // "Cancel en-route". Also fired internally if the game needs to forcibly
    // disconnect a plane (e.g. level reset, collision).
    //
    // Responsibilities split across three listeners on this same event:
    //
    //   HERE (GameScene)
    //     • plane.clearPath()      — nulls path array, resets pathIndex to 0
    //     • plane.resetToNeutral() — sets level 0 (scale 1.0), clears
    //                                isApproachingLanding + isApproachingWaypoint
    //     • waypointConnections.delete(planeId) — removes the stored exitPoint
    //                                so GameScene no longer triggers waypoint pass
    //
    //   InputSystem (setup → _onCancelApproachDots)
    //     • clearPlaneDots(planeId) — erases the white dot Graphics from the
    //                                 canvas so the drawn route disappears visually
    //
    //   SpeedControlPopup (onCancelApproach)
    //     • liveIsApproaching = false, liveIsWaypoint = false
    //     • disables the Cancel button immediately without waiting for a re-tap
    //
    // ⚠️  DO NOT REMOVE OR MERGE THESE — each system owns its own state.
    //     If you remove InputSystem's listener the dots will linger after cancel.
    //     If you remove this handler the plane will keep following a ghost path.
    this._onCancelApproach = ({ planeId }) => {
      const plane = this.planes.find((p) => p.id === planeId);
      if (!plane) return;
      plane.clearPath();
      plane.resetToNeutral(); // level 0 = normal icon scale; clears approach flags
      this.waypointConnections.delete(planeId);
    };

    this._onTapDeselect = () => {
      // Clear the Phaser-side selection ring when popup is closed from Vue.
      if (this.inputState) this.inputState.selectedPlaneId = null;
    };

    gameEventBus.on('plane:setSpeed', this._onSetSpeed);
    gameEventBus.on('plane:cancelApproach', this._onCancelApproach);
    gameEventBus.on('plane:tap-deselect', this._onTapDeselect);

    // Phaser scene lifecycle — stop/restart music on pause/resume.
    // These fire for ALL pause sources (our buttons, level-complete, etc.)
    // so audio is always in sync with scene state.
    // pauseMusic/resumeMusic use music.pause()/resume() — no tweens needed.
    // stopAll() fades via ctx.tweens, which don't tick on a paused scene,
    // so music would keep playing at full volume. pauseMusic() stops instantly.
    this.events.on('pause', () => AudioSystem.pauseMusic(this), this);
    this.events.on('resume', () => AudioSystem.resumeMusic(this), this);
  }

  /**
   * Handle zoom change
   */
  private handleZoomChange(zoom: number): void {
    this.currentZoom = zoom;

    // Guard: cameras.main may not exist if the event fires before create() runs
    // (settings store emits emitAllSettings() during init, before GameScene is active)
    if (!this.cameras?.main) return;

    this.cameras.main.setZoom(zoom);
    console.log(`🔍 Zoom changed to ${zoom.toFixed(1)}x`);
  }

  /**
   * Handle background brightness change.
   *
   * The background image itself always stays at alpha 1.  A black Graphics
   * rectangle (brightnessOverlay, depth 1) sits above it; its alpha maps
   * directly to `dimming` (0 = transparent, 100 = solid black).
   */
  private handleBackgroundChange(settings: { dimming: number; alpha: number }): void {
    this.backgroundDimming = settings.dimming;

    if (this.brightnessOverlay) {
      this.brightnessOverlay.setAlpha(settings.dimming / 100);
      console.log(`🌅 Brightness overlay: ${settings.dimming}% dimming`);
    }
  }

  /**
   * Load level configuration
   */
  /**
   * Convert rawLevel (fraction-based) to pixel coordinates using current camera + background.
   */
  /**
   * Convert rawLevel fractions (0-1) to world-local coordinates.
   * (0,0) = centre of worldContainer. fraction 0.5 → 0, fraction 0 → -WORLD_W/2.
   */
  private convertRawLevel(): LevelConfig {
    if (!this.rawLevel) throw new Error('rawLevel not set');
    const hw = this.WORLD_W / 2;
    const hh = this.WORLD_H / 2;
    return {
      ...this.rawLevel,
      runways: this.rawLevel.runways.map((rw) => {
        // PRIMARY: a runway authored as its two threshold endpoints
        // (masterX1/Y1, masterX2/Y2) on the raw master image. Each endpoint
        // is projected independently through projectMasterToWorld, and
        // center/length/direction are DERIVED from the projected points —
        // this is the only correct approach, because the background's crop
        // is rendered with a uniform cover-fit scale (sx === sy) that varies
        // per ratio, and the crop may overflow the world on one axis (clipped
        // by the centred, origin-0.5 sprite in createBackground). Because the
        // overflow offset is applied in projectMasterToWorld, every ratio
        // maps the crop centre to the world centre — so re-deriving both
        // endpoints' projected positions is always correct regardless of
        // ratio or zoom. Do NOT revert to a single precomputed length/direction
        // scaled by one factor — that only works on 16x9 where there's no overflow.
        //
        // Do NOT add a per-ratio masterPositions map back here — see
        // LevelBackgrounds.md "Positioning runways".
        if (
          this.backgroundMetadata &&
          (rw as any).masterX1 != null &&
          (rw as any).masterY1 != null &&
          (rw as any).masterX2 != null &&
          (rw as any).masterY2 != null
        ) {
          const p1 = this.projectMasterToWorld((rw as any).masterX1, (rw as any).masterY1);
          const p2 = this.projectMasterToWorld((rw as any).masterX2, (rw as any).masterY2);

          const centerX = (p1.x + p2.x) / 2;
          const centerY = (p1.y + p2.y) / 2;
          const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          const direction = Math.atan2(p2.y - p1.y, p2.x - p1.x);

          // Width is the short axis of the runway, perpendicular to
          // the length direction. It is measured in master-image pixels
          // (masterWidth) and converted to world units using the uniform
          // scale factor (sx === sy now). Previously this used the Y scale
          // factor specifically because of non-uniform stretching; with
          // uniform scaling sy === sx so the result is identical.
          // For a more exact measurement, use two points across the runway's
          // width (see `pnpm runway measure`).
          const { sx, sy } = this.getMasterScale();
          const width = (rw as any).masterWidth != null ? (rw as any).masterWidth * sy : rw.width;

          return { ...rw, centerX, centerY, length, direction, width };
        }

        // TRANSITIONAL: single masterX/masterY (+ optionally masterLength).
        // Position is still correct (a single point projects fine under
        // uniform scaling), but length/direction are NOT re-derived —
        // they use whatever was authored, scaled by a single factor.
        // sx === sy now (uniform), so Math.sqrt(sx * sy) === sx exactly.
        // Migrate to the two-endpoint form above for full correctness.
        if (this.backgroundMetadata && (rw as any).masterX != null && (rw as any).masterY != null) {
          console.warn(
            `⚠️ Runway ${(rw as any).id || '(unknown)'} uses single-point masterX/masterY — ` +
              `length/direction are only exact on the ratio they were tuned against. ` +
              `Migrate to masterX1/Y1/masterX2/Y2 (see LevelBackgrounds.md). ` +
              `Run: pnpm runway runway ${this.levelNumber} 16x9 ${
                (rw as any).id
              } <x1> <y1> <x2> <y2>`
          );
          const p = this.projectMasterToWorld((rw as any).masterX, (rw as any).masterY);
          const { sx, sy } = this.getMasterScale();
          const approxScale = Math.sqrt(sx * sy);
          const length =
            (rw as any).masterLength != null ? (rw as any).masterLength * approxScale : rw.length;
          const width = (rw as any).masterWidth != null ? (rw as any).masterWidth * sy : rw.width;

          return { ...rw, centerX: p.x, centerY: p.y, length, width };
        }

        // FALLBACK: no master data authored yet, or backgroundMetadata
        // hasn't loaded. Fraction-of-world centerX/centerY — only exact on
        // the 16x9 baseline; every other ratio drifts.
        console.warn(
          `⚠️ Runway ${(rw as any).id || '(unknown)'} has no master data — using ` +
            `fraction-based fallback (only accurate for 16x9). Run ` +
            `"pnpm runway runway ..." to derive masterX1/Y1/masterX2/Y2.`
        );
        return {
          ...rw,
          centerX: (rw.centerX ?? 0.5) * this.WORLD_W - hw,
          centerY: (rw.centerY ?? 0.5) * this.WORLD_H - hh,
        };
      }),
      waypoints: this.rawLevel.waypoints.map((wp) => ({
        ...wp,
        x: wp.x * this.WORLD_W - hw,
        y: wp.y * this.WORLD_H - hh,
      })),
    };
  }

  /**
   * Master-pixels → world-units scale factor for the currently-loaded
   * background's crop. UNIFORM (sx === sy) — uses cover-fit (max) so the crop
   * fills the fixed WORLD_W×WORLD_H rect without distortion. This matches
   * createBackground()'s uniform bgScale exactly. The crop centre maps to the
   * world centre because projectMasterToWorld() applies the overflow offset
   * and createBackground() centres the sprite (origin 0.5, position 0,0).
   */
  private getMasterScale(): { sx: number; sy: number } {
    if (!this.backgroundMetadata) throw new Error('backgroundMetadata not available');
    const { width: cropW, height: cropH } = this.backgroundMetadata.crop;
    // Uniform cover-fit: sx and sy are now EQUAL. This must match the uniform
    // bgScale used in createBackground() so game-object projection stays aligned
    // with the visually-rendered background. Previously sx ≠ sy (non-uniform),
    // which distorted game object positioning on non-16:9 screens to match the
    // background's non-uniform stretch. Now both are uniform: the background
    // renders undistorted and game objects project to the same undistorted space.
    const s = Math.max(this.WORLD_W / cropW, this.WORLD_H / cropH);
    return { sx: s, sy: s };
  }

  /**
   * Project a point given in master-image pixels to world-local coordinates
   * (the same coordinate space used by runways/waypoints). Requires
   * `backgroundMetadata` to be populated.
   */
  private projectMasterToWorld(masterX: number, masterY: number): { x: number; y: number } {
    if (!this.backgroundMetadata) throw new Error('backgroundMetadata not available');
    // backgroundMetadata is a manifest entry (see backgroundVariantResolver.ts) —
    // crop rect is nested under `.crop`, NOT flat cropLeft/cropTop/cropW/cropH.
    const {
      left: cropLeft,
      top: cropTop,
      width: cropW,
      height: cropH,
    } = this.backgroundMetadata.crop;
    const { sx } = this.getMasterScale(); // now uniform: sx === sy

    // With uniform cover-fit (sx === sy), the crop region maps to a rectangle of
    // size (cropW*s × cropH*s) in world space. Since s = max(WORLD_W/cropW, WORLD_H/cropH),
    // one axis fills the world exactly and the other overflows. We subtract half
    // the overflow so the crop CENTER maps to the world CENTER (0, 0) — this
    // matches createBackground()'s centered sprite (origin 0.5, position 0, 0).
    const overflowX = (cropW * sx - this.WORLD_W) / 2;
    const overflowY = (cropH * sx - this.WORLD_H) / 2;

    const wx = (masterX - cropLeft) * sx - this.WORLD_W / 2 - overflowX;
    const wy = (masterY - cropTop) * sx - this.WORLD_H / 2 - overflowY;
    return { x: wx, y: wy };
  }

  private loadLevel(levelNumber: number): void {
    const gameStore = useGameStore();
    let levelConfig: LevelConfig | undefined;
    if (gameStore.trainingLevel !== null) {
      levelConfig = getTrainingLevelByNumber(levelNumber);
    } else if (this.currentLevelId) {
      levelConfig = getLevelById(this.currentLevelId);
    } else {
      levelConfig = getLevelByNumber(levelNumber);
    }

    console.log(
      `📋 Loading Level ${levelNumber}: ${
        levelConfig ? JSON.stringify(levelConfig, null, 2) : '(not found)'
      }`
    );

    // Store the original fraction-based config as rawLevel -- never pixel-convert this.
    // All conversions always start from rawLevel so resize never double-converts.
    this.rawLevel = levelConfig ?? getLevelByNumber(1)!;
    if (!levelConfig) {
      console.error(`❌ Level ${levelNumber} not found, loading Level 1`);
    }

    // currentLevel (pixel-converted) will be created after background metadata
    // is available so the mapper can convert master coordinates when present.
  }

  /**
   * Setup plane textures mapping - verify they exist for all plane types
   */
  /**
   * Build the plane-texture registry used by SpawnSystem.selectColour().
   *
   * Keys are COMPOUND: "{typeId}-{color}" (e.g. "2-blue", "3-green").
   * SpawnSystem looks up planeTextures[`${planeType.id}-${colour}`] to verify
   * a texture is loaded before constructing a Plane — the value is truthy when
   * the texture exists in the Phaser cache.
   *
   * ── WHY COMPOUND KEYS ────────────────────────────────────────────────────────
   * The old code used bare color keys ("blue", "green"…). Iterating all types
   * then all colors caused later types to silently overwrite earlier ones, so
   * planeTextures["blue"] always ended up as the last-loaded type's key (A320).
   * SpawnSystem picked the correct type but always rendered A320 sprites.
   *
   * Compound keys make each (type, color) pair independently addressable so
   * SpawnSystem can verify exactly the texture it intends to use.
   */
  private setupPlaneTextures(): void {
    const colors = ['blue', 'green', 'yellow', 'pink', 'violet', 'orange', 'white'];
    const planeTypes = getAllPlaneTypes();

    console.log('🎨 Setting up plane textures...');
    console.log('📦 Available textures:', Object.keys(this.textures.list));

    let loaded = 0;
    let missing = 0;

    // Only register types used in the current level — avoids warnings for
    // plane types 4–7 which have no sprites yet (mocked data in defaults_config.ts).
    const levelAllowedTypes = new Set(this.currentLevel?.allowedPlaneTypes ?? []);

    planeTypes.forEach((planeType) => {
      // Skip types not used in this level — they have no sprites
      if (levelAllowedTypes.size > 0 && !levelAllowedTypes.has(planeType.id)) return;

      colors.forEach((color) => {
        const textureKey = `${planeType.id}-${color}`;
        if (this.textures.exists(textureKey)) {
          this.planeTextures[textureKey] = textureKey;
          loaded++;
        } else if (levelAllowedTypes.has(planeType.id)) {
          // Only warn if this type is actually needed for the level
          console.warn(`⚠️ Texture missing for level-required type: ${textureKey}`);
          missing++;
        }
      });
    });

    console.log(
      `📋 Plane textures: ${loaded} registered for level types [${Array.from(
        levelAllowedTypes
      ).join(', ')}]`
    );
  }

  /**
   * Create runways from level configuration
   */
  private createRunwaysFromLevel(): void {
    if (!this.currentLevel) return;

    this.currentLevel.runways.forEach((runwayConfig) => {
      const runway = new Runway({
        scene: this,
        id: runwayConfig.id,
        rwNumber: runwayConfig.rwNumber,
        oppositeRwNumber: runwayConfig.oppositeRwNumber,
        centerX: runwayConfig.centerX!,
        centerY: runwayConfig.centerY!,
        direction: runwayConfig.direction!,
        length: runwayConfig.length,
        width: runwayConfig.width,
        allowedColors: runwayConfig.allowedColors,
        color: runwayConfig.allowedColors?.[0],
      });

      // Runway is a child of worldContainer -- inherits cover-scale automatically
      this.worldContainer.add(runway);
      this.runways.push(runway);
    });

    console.log(`✈️ Created ${this.runways.length} runways in worldContainer`);
  }

  /**
   * Create waypoints from level configuration
   */
  private createWaypointsFromLevel(): void {
    if (!this.currentLevel) return;

    this.currentLevel.waypoints.forEach((waypointConfig) => {
      const waypoint = new Waypoint({
        scene: this,
        name: waypointConfig.name,
        x: waypointConfig.x,
        y: waypointConfig.y,
        description: waypointConfig.description,
        allowedColors: waypointConfig.allowedColors,
        color: waypointConfig.allowedColors?.[0],
      });

      // Store world-local coords for edge-snap recalculation on resize
      waypoint.worldLocalX = waypointConfig.x;
      waypoint.worldLocalY = waypointConfig.y;

      // Required by getExitPoint() to clamp exit ray to world boundaries.
      waypoint.worldHalfW = this.WORLD_W / 2;
      waypoint.worldHalfH = this.WORLD_H / 2;

      // Waypoints live inside worldContainer (world-local coords).
      // worldContainer.scale handles all screen-space scaling automatically.
      this.worldContainer.add(waypoint);
      this.waypoints.push(waypoint);
    });

    this.snapWaypointsToEdges();
    console.log(`📍 Created ${this.waypoints.length} waypoints`);
  }

  update(time: number, delta: number): void {
    // Cache world-to-screen transform once per frame -- used in dot drawing and collision circles.
    this._cachedScale = this.getWorldScale();
    this._cachedCX = this.worldContainer.x;
    this._cachedCY = this.worldContainer.y;

    // Re-sort worldContainer children only when a plane has changed altitude level.
    // Plane.ts sets _depthDirty = true on the scene when it calls setDepth().
    // Container.sort uses TimSort → fast on nearly-sorted arrays, but skipping it
    // entirely on most frames saves measurable CPU at 60 fps.
    if (this._depthDirty) {
      this.worldContainer.sort('depth');
      this._depthDirty = false;
    }

    this.planes.forEach((plane) => plane.update(time));

    this.planes.forEach((plane) => {
      if (plane.isApproachingWaypoint && !plane.isPassingWaypoint && !plane.isFollowingAirway) {
        const connection = this.waypointConnections.get(plane.id);
        // Fire when path is exhausted: pathIndex has reached the last point.
        // Guard supports both execution orderings:
        //   • plane.preUpdate() before GameScene.update() — path may be non-null,
        //     pathIndex === path.length (just exhausted); Plane.ts no longer nulls
        //     path in this state, so the check below still catches it.
        //   • Any other order — path.length - 1 check catches the last-point frame.
        const pathExhausted = !plane.path || plane.pathIndex >= plane.path.length - 1;
        if (connection && pathExhausted) {
          plane.startWaypointPassing(connection.exitPoint);
        }
      }
    });

    this.checkCollisions();

    // Per-frame audio: TA warning debounce + RA collision sound.
    // Must run AFTER checkCollisions() so isGameOver and _cachedConflictCount are current.
    AudioSystem.update(this);

    this.planes = this.planes.filter((plane) => {
      if (plane.isOffscreen) {
        if (plane.isLanding) {
          this.landedCount++;
          gameEventBus.emit('plane:landed', plane.id, 100);
          this.checkLevelComplete();
        } else if (plane.isFollowingAirway) {
          this.waypointPassCount++;
          gameEventBus.emit('plane:waypoint-passed', plane.id, 50);
          this.checkLevelComplete();
        } else {
          // Plane left the world with no connection — counts as missed.
          this.missedCount++;
          gameEventBus.emit('plane:missed', { planeId: plane.id });
        }

        // Clean up the plane's static dot graphics so they don't linger.
        InputSystem.destroyPlaneDots(this, plane.id);
        // Close speed-control popup if this plane is currently selected.
        gameEventBus.emit('plane:offscreen', { planeId: plane.id });
        plane.destroy();
        return false;
      }
      return true;
    });

    // Stop spawning once the level's plane quota has been dispatched.
    // Active planes already in the air are allowed to finish.
    const _target = this.currentLevel?.planesTarget ?? 0;
    const _handled = this.landedCount + this.waypointPassCount;
    const _targetReached = _target > 0 && _handled >= _target;

    if (
      !_targetReached &&
      !this.isLevelComplete &&
      (this.planes.length < this.MIN_PLANES ||
        (this.planes.length < this.MAX_PLANES &&
          Math.random() < (this.currentLevel?.spawnRate || 0.005)))
    ) {
      SpawnSystem.trySpawn(this);
    }

    this.runways.forEach((runway) => runway.update(time));
    this.waypoints.forEach((waypoint) => waypoint.update(time));

    InputSystem.drawPaths(this);
    InputSystem.drawProjections(this);
    EntryDotsSystem.draw(
      time,
      this.planes,
      this._cachedCX,
      this._cachedCY,
      this._cachedScale,
      this.getScreenBoundsInWorld()
    );
    this.drawCollisionCircles();

    // Throttle stats to ~10x/s -- avoids emitting every frame and calling O(n²) getConflictCount().
    // _cachedConflictCount is updated inside checkCollisions() which already runs above.
    if (time - this._lastStatsEmit > 100) {
      this._lastStatsEmit = time;
      gameEventBus.emit('stats:update', {
        activePlanes: this.planes.length,
        planesLanded: this.landedCount,
        waypointPasses: this.waypointPassCount,
        planesMissed: this.missedCount,
        planesTarget: this.currentLevel?.planesTarget ?? 0,
        conflicts: this._cachedConflictCount,
      });
    }

    // Update debug overlay every second
    if (this.debugText) {
      if (Math.floor(time / 1000) !== Math.floor((time - delta) / 1000)) {
        this.updateDebugOverlay();
      }
    }
  }

  /**
   * Delegates to CollisionSystem.check().
   * See CollisionSystem.ts for the full detection rules and design rationale.
   */
  private checkCollisions(): void {
    const result = CollisionSystem.check(this);
    this._cachedConflictCount = result.conflictCount;
  }

  /**
   * Delegates to CollisionSystem.drawCircles().
   * Draws pulsing red circles on collided planes.
   */
  private drawCollisionCircles(): void {
    if (!this.collisionGraphics) return;
    CollisionSystem.drawCircles(this.collisionGraphics, this, this.time.now);
  }

  private createDebugOverlay(): void {
    const cam = this.cameras.main;

    // Semi-transparent background panel so text is readable over any scene
    const panel = this.add.rectangle(0, 0, cam.width * 0.55, 1, 0x000000, 0.75);
    panel.setOrigin(0, 0);
    panel.setDepth(9999);
    panel.setScrollFactor(0);

    this.debugText = this.add.text(10, 6, '', {
      fontSize: '22px',
      fontFamily: 'monospace',
      color: '#00ff88',
      padding: { x: 4, y: 4 },
      wordWrap: { width: cam.width * 0.54 },
    });
    this.debugText.setDepth(10000);
    this.debugText.setScrollFactor(0);

    this.updateDebugOverlay();

    // Resize panel to match text height
    panel.height = this.debugText.height + 12;

    // Tap overlay to hide it
    this.debugText.setInteractive();
    this.debugText.once('pointerdown', () => {
      this.debugText?.destroy();
      panel.destroy();
      this.debugText = null;
    });
  }

  private updateDebugOverlay(): void {
    if (!this.debugText) return;

    const dpr = window.devicePixelRatio || 1;
    const cam = this.cameras.main;
    const native = window.__DEVICE_INFO__;

    // All loaded background texture keys
    const allTextures = Object.keys(this.textures.list);
    const bgTextures = allTextures.filter((k) => k.startsWith('level-'));

    const fps = Math.round(this.game.loop.actualFps);
    const lines = [
      `FPS: ${fps}  planes: ${this.planes.length}`,
      '-- DEVICE --',
      `screen:  ${screen.width}x${screen.height}`,
      `inner:   ${window.innerWidth}x${window.innerHeight}`,
      `DPR:     ${dpr}`,
      `canvas:  ${this.game.canvas.width}x${this.game.canvas.height}`,
      `camera:  ${cam.width}x${cam.height}`,
      `render:  ${this.game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas'}`,
      '-- NATIVE __DEVICE_INFO__ --',
      native
        ? `platform: ${native.platform}  dpr:${native.dpr}\nscreenW:  ${native.screenW}  screenH:${native.screenH}\naspectKey:${native.aspectRatioKey}`
        : '(not injected)',
      '-- BACKGROUND --',
      `key sought: ${this.backgroundKey ?? '(none)'}`,
      `bg loaded:  ${this.background ? '✅ YES' : '❌ NO'}`,
      `bg depth:   ${this.background?.depth ?? '-'}`,
      `bg alpha:   ${this.background?.alpha ?? '-'}`,
      `bg visible: ${this.background?.visible ?? '-'}`,
      `bg scale:   ${
        this.background
          ? `${this.background.scaleX.toFixed(3)}x${this.background.scaleY.toFixed(3)}`
          : '-'
      }`,
      `bg size:    ${this.bgImageW}x${this.bgImageH}`,
      `dimming:    ${this.backgroundDimming}% (overlay α ${(this.backgroundDimming / 100).toFixed(
        2
      )})`,
      '-- AVAILABLE BG TEXTURES --',
      bgTextures.length > 0 ? bgTextures.join('\n') : '(none loaded)',
      '-- WORLD --',
      `worldScale: ${this.getWorldScale().toFixed(3)}`,
      `container:  ${this.worldContainer?.x.toFixed(0)},${this.worldContainer?.y.toFixed(0)}`,
      '',
      '(tap to dismiss)',
    ];

    this.debugText.setText(lines.join('\n'));
  }

  /**
   * Check whether the planes-handled quota has been reached.
   * Called after every successful landing or waypoint pass.
   * Idempotent — safe to call many times; acts only once.
   */
  private checkLevelComplete(): void {
    if (this.isGameOver || this.isLevelComplete) return;

    const target = this.currentLevel?.planesTarget ?? 0;
    if (target <= 0) return; // no target configured — level never auto-completes

    const handled = this.landedCount + this.waypointPassCount;
    if (handled >= target) {
      this.triggerLevelComplete();
    }
  }

  /**
   * Trigger level completion:
   *   1. Set guard flag (idempotent)
   *   2. Pause the scene so no more updates fire
   *   3. Emit 'level:complete' → useGame.ts → gameStore.completeLevel()
   */
  private triggerLevelComplete(): void {
    this.isLevelComplete = true;

    const gameStore = useGameStore();

    // Show interstitial ad for free users — fire-and-forget.
    // The ad is a native overlay so it appears immediately on top of the game;
    // no need to await before pausing the scene.
    // No-op for premium users and on web/Electron.
    // Skipped in training mode.
    if (gameStore.trainingLevel === null) {
      useMonetizationStore().showAdIfReady();
    }

    // scene.pause() triggers the 'pause' scene event above,
    // which calls AudioSystem.pauseMusic() automatically.
    this.scene.pause();
    console.log(
      `✅ Level ${this.levelNumber} complete — ` +
        `${this.landedCount} landed, ${this.waypointPassCount} waypoint passes`
    );
    gameEventBus.emit('level:complete', {
      levelNumber: this.levelNumber,
      planesLanded: this.landedCount,
      waypointPasses: this.waypointPassCount,
      planesTarget: this.currentLevel?.planesTarget ?? 0,
    });
  }

  shutdown(): void {
    // Fade out audio. teardown() is managed by useGame.ts, not the scene.
    AudioSystem.stopAll(this);

    // Planes, runways, waypoints, and background are all worldContainer children.
    // destroy(true) recursively destroys all children.
    if (this.worldContainer) this.worldContainer.destroy(true);

    // collisionGraphics is a scene-level object — must be explicitly destroyed.
    // Dot and projection Graphics are worldContainer children — already destroyed above.
    this.collisionGraphics?.destroy();
    EntryDotsSystem.destroy();
    InputSystem.shutdown(this);

    this.planes = [];
    this.runways = [];
    this.waypoints = [];
    this.waypointConnections.clear();
    this.collidedPlanes.clear();
    this.isGameOver = false;
    this.isLevelComplete = false;
    this.landedCount = 0;
    this.waypointPassCount = 0;
    this.missedCount = 0;

    // Remove listeners using the stored bound references.
    // Passing a fresh .bind() to off() creates a different object and never matches —
    // the stored refs below are the exact instances registered in setupSettingsListeners().
    if (this._onZoomChange) gameEventBus.off('settings:zoom', this._onZoomChange);
    if (this._onBackgroundChange) gameEventBus.off('settings:background', this._onBackgroundChange);
    if (this._onGameInit) gameEventBus.off('game:init', this._onGameInit);
    if (this._onGameRestart) gameEventBus.off('game:restart', this._onGameRestart);
    if (this._onSetSpeed) gameEventBus.off('plane:setSpeed', this._onSetSpeed);
    if (this._onCancelApproach) gameEventBus.off('plane:cancelApproach', this._onCancelApproach);
    if (this._onTapDeselect) gameEventBus.off('plane:tap-deselect', this._onTapDeselect);

    this.scale.off('resize', this.handleResize, this);
  }
}
