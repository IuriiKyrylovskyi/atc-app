import Phaser from 'phaser';
import { GameScene } from '@/game/scenes/GameScene';
import { BootScene } from '@/game/scenes/BootScene';
import {
  getOptimalCanvasDimensions,
  isMobileDevice,
  requestFullscreen,
  requestFullscreenOnUserGesture,
  DISPLAY_DEFAULTS,
} from '@/game/config/defaults.config';

/**
 * Phaser game configuration with HIGH QUALITY rendering
 * Cross-platform compatible settings for Web, Electron, iOS, Android
 */

export const phaserConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL, // Force WebGL for better quality
  parent: 'game-container',
  // ✅ CRITICAL: Multiply by DPR for actual canvas size
  width: window.innerWidth * (window.devicePixelRatio || 1),
  height: window.innerHeight * (window.devicePixelRatio || 1),
  backgroundColor: '#000000',

  scale: {
    mode: Phaser.Scale.NONE, // ✅ Use NONE to control manually
    autoCenter: Phaser.Scale.NO_CENTER,
    width: window.innerWidth * (window.devicePixelRatio || 1),
    height: window.innerHeight * (window.devicePixelRatio || 1),
    fullscreenTarget: 'game-container',
    expandParent: false,
    parent: 'game-container',
  },

  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },

  scene: [BootScene, GameScene],

  input: {
    activePointers: 3,
    smoothFactor: 0,
  },

  render: {
    // ✅ HIGH QUALITY RENDERING SETTINGS
    antialias: true, // Smooth edges
    antialiasGL: true, // WebGL antialiasing
    pixelArt: false, // IMPORTANT: false for smooth graphics
    roundPixels: false, // IMPORTANT: false for subpixel rendering
    powerPreference: 'high-performance', // Use GPU acceleration
    transparent: false,
    clearBeforeRender: true,
    preserveDrawingBuffer: false,
    premultipliedAlpha: true,
    failIfMajorPerformanceCaveat: false,
    desynchronized: true,
    batchSize: 4096, // Larger batch for better performance
    maxTextures: 16, // More textures in memory
    mipmapFilter: 'LINEAR', // ✅ Better texture filtering
  },

  audio: {
    disableWebAudio: false,
  },

  banner: {
    hidePhaser: false,
    text: '#ffffff',
    background: ['#667eea', '#764ba2', '#f093fb', '#f5576c'],
  },

  callbacks: {
    postBoot: (game: Phaser.Game) => {
      console.log('🎮 Phaser Game Initialized');

      const rendererType = game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas';
      console.log(`🎨 Renderer: ${rendererType}`);

      if (rendererType === 'Canvas') {
        console.warn('⚠️ WARNING: Using Canvas renderer instead of WebGL!');
      }

      if (game.renderer.type === Phaser.WEBGL) {
        const gl = (game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl;
        if (gl) {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          console.log('✅ WebGL texture smoothing enabled');
        }
      }

      // Enforce fullscreen FIRST so the container has its final dimensions
      enforceGameContainer();

      // ✅ CRITICAL: on mobile, window.innerHeight excludes the browser address bar
      // while the container (position:fixed, top:0, bottom:0) fills the full screen.
      // Use the container's actual clientHeight so canvas resolution matches display.
      const dpr = window.devicePixelRatio || 1;
      const container = document.getElementById('game-container');
      const displayW = container ? container.clientWidth : window.innerWidth;
      const displayH = container ? container.clientHeight : window.innerHeight;

      const canvasW = Math.round(displayW * dpr);
      const canvasH = Math.round(displayH * dpr);

      console.log(`📐 Container: ${displayW}×${displayH}`);
      console.log(`📐 Canvas target: ${canvasW}×${canvasH} (${dpr}x DPR)`);

      if (game.canvas.width !== canvasW || game.canvas.height !== canvasH) {
        console.warn(
          `⚠️ Canvas mismatch (was ${game.canvas.width}×${game.canvas.height}), resizing`
        );
        game.scale.resize(canvasW, canvasH);
      }

      // Apply CSS so canvas fills its container exactly
      applyCanvasQualityFixes(game.canvas);

      // ✅ Re-read canvas layout after CSS changes so pointer coords are correct
      game.scale.refresh();

      // Request fullscreen on mobile
      if (isMobileDevice()) {
        const requestFS = () => {
          requestFullscreen(game.canvas.parentElement || undefined);
          document.removeEventListener('touchstart', requestFS);
          document.removeEventListener('click', requestFS);
        };
        document.addEventListener('touchstart', requestFS, { once: true });
        document.addEventListener('click', requestFS, { once: true });
      }

      game.canvas.oncontextmenu = (e) => {
        e.preventDefault();
        return false;
      };

      // Debounce resize — Electron fires a resize event on every pixel during
      // window drag, flooding the audio context and causing sounds to disappear.
      // 150 ms after the last event fires we apply the resize exactly once.
      let _resizeTimer: ReturnType<typeof setTimeout> | null = null;
      window.addEventListener('resize', () => {
        if (_resizeTimer !== null) clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => {
          _resizeTimer = null;
          handleResize(game);
        }, 150);
      });
      window.addEventListener('orientationchange', () => {
        setTimeout(() => {
          handleOrientationChange(game);
        }, 100);
      });

      // THIS blocks Phaser's internal AudioContext unlock on iOS:
      // document.addEventListener('gesturestart', (e) => {
      //   // e.preventDefault(); // ← remove this entire listener
      // });

      document.addEventListener(
        'wheel',
        (e) => {
          if (!(e.target as HTMLElement).closest('#game-container')) e.preventDefault();
        },
        { passive: false }
      );

      document.addEventListener(
        'touchmove',
        (e) => {
          const target = e.target as HTMLElement;
          // Canvas already has touch-action:none — calling preventDefault here
          // cancels pointermove on iOS 17+ (iPhone 15 Pro Max), breaking path drawing
          if (target instanceof HTMLCanvasElement) return; // ← add this line
          if (!target.closest('.modal-content, .scrollable-panel')) e.preventDefault();
        },
        { passive: false }
      );

      if (isMobileDevice()) {
        document.addEventListener('fullscreenchange', () => {
          // fullscreenchange fires when the user exits fullscreen (e.g. presses the
          // back button). It is NOT a user gesture, so requestFullscreen() called
          // directly here is rejected by the browser with "API can only be initiated
          // by a user gesture". Use the deferred helper instead — it re-attaches a
          // one-time click/touchstart listener and fires when the user next taps.
          if (!document.fullscreenElement && DISPLAY_DEFAULTS.FULLSCREEN_REQUIRED_MOBILE) {
            requestFullscreenOnUserGesture(game.canvas.parentElement || undefined);
          }
        });
      }
    },
  },
};

/**
 * ✅ Apply canvas quality fixes for crisp rendering
 */
function applyCanvasQualityFixes(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;

  // ✅ Let the canvas fill its container (which is position:fixed top/bottom 0).
  // Using percentage rather than px means the canvas always covers the full screen
  // regardless of whether window.innerHeight matches the visual viewport on mobile.
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';

  // Force high-quality image rendering
  canvas.style.imageRendering = 'auto';

  const actualRatio = canvas.width / window.innerWidth;

  console.log('✅ Canvas quality fixes applied');
  console.log(`   Canvas internal: ${canvas.width}×${canvas.height}`);
  console.log(`   DPR: ${dpr}x`);
  console.log(`   Actual ratio: ${actualRatio.toFixed(2)}x`);

  if (actualRatio < 1.5) {
    console.warn('⚠️ WARNING: Canvas is NOT high-resolution!');
  } else {
    console.log('✅ High-resolution rendering ACTIVE');
  }
}

/**
 * ✅ Enforce fullscreen game container (fixes black bars on mobile)
 */
function enforceGameContainer(): void {
  const gameContainer = document.getElementById('game-container');
  const app = document.getElementById('app');
  const html = document.documentElement;
  const body = document.body;

  // ✅ Use top/bottom/left/right instead of width/height percentages.
  // On mobile Safari, `height: 100vh` can be taller than the visible area
  // (includes the chrome bar), while `top: 0; bottom: 0` always stretches
  // between the actual top and bottom of the available screen space.
  const fillStyle = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    overscroll-behavior: none !important;
    touch-action: none !important;
  `;

  html.setAttribute('style', fillStyle);
  body.setAttribute('style', fillStyle);
  if (app) app.setAttribute('style', fillStyle);
  if (gameContainer) gameContainer.setAttribute('style', fillStyle);

  // ✅ Mobile-specific: Hide address bar
  if (isMobileDevice()) {
    window.scrollTo(0, 1);
    setTimeout(() => window.scrollTo(0, 0), 100);

    let viewport = document.querySelector('meta[name=viewport]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.setAttribute('name', 'viewport');
      document.head.appendChild(viewport);
    }
    viewport.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
    );

    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.height = '100%';
  }

  console.log('✅ Game container enforced fullscreen');
}

/**
 * Handle window resize - maintain quality
 *
 * Two guards are required:
 *   1. game.scale null-check — the debounce timer can fire AFTER the Phaser
 *      instance has been destroyed (hard restart between levels). Calling
 *      game.scale.resize() on a partially torn-down ScaleManager crashes with
 *      "Cannot read properties of null (reading 'x')" inside Size2.resize().
 *      We guard with a try-catch so a stale timer never crashes the app.
 *
 *   2. AudioContext resume — browsers and Electron auto-suspend the Web Audio
 *      context on window resize. Phaser normally resumes it on the next user
 *      gesture (touch/click), which is why sounds return after tapping the
 *      screen. We resume it explicitly here so audio continues without any
 *      interaction required.
 */
function handleResize(game: Phaser.Game): void {
  const dpr = window.devicePixelRatio || 1;

  enforceGameContainer();

  const container = document.getElementById('game-container');
  const displayW = container ? container.clientWidth : window.innerWidth;
  const displayH = container ? container.clientHeight : window.innerHeight;

  // Guard 1: ScaleManager may be null if game was destroyed before timer fired
  try {
    game.scale.resize(Math.round(displayW * dpr), Math.round(displayH * dpr));
    applyCanvasQualityFixes(game.canvas);
    game.scale.refresh();
  } catch {
    // Game instance was destroyed — this resize is stale, silently ignore
    return;
  }

  // Guard 2: Resume AudioContext suspended by Electron/browser on resize
  try {
    const audioCtx = (game.sound as unknown as { context?: AudioContext })?.context;
    if (audioCtx?.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  } catch {
    // Sound manager not available — ignore
  }

  console.log(`🔄 Game resized to ${displayW}×${displayH} @ ${dpr}x`);
}

/**
 * Handle orientation change.
 * Orientation is locked natively via AndroidManifest screenOrientation="sensorLandscape"
 * so this handler only resizes — no warnings or scene pausing.
 */
function handleOrientationChange(game: Phaser.Game): void {
  console.log('📱 Orientation changed — resizing');
  handleResize(game);
}

/**
 * Show orientation warning overlay
 */
function showOrientationWarning(): void {
  let overlay = document.getElementById('orientation-warning');

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'orientation-warning';
    overlay.innerHTML = `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.95);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        text-align: center;
        padding: 20px;
      ">
        <div style="font-size: 64px; margin-bottom: 20px;">📱</div>
        <h2 style="font-size: 24px; margin-bottom: 10px;">Please Rotate Your Device</h2>
        <p style="font-size: 16px; opacity: 0.8;">This game requires landscape orientation</p>
        <div style="
          margin-top: 30px;
          width: 80px;
          height: 80px;
          border: 3px solid white;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: rotate 2s infinite;
        ">
          <div style="
            width: 60px;
            height: 40px;
            border: 2px solid white;
            border-radius: 4px;
          "></div>
        </div>
      </div>
      <style>
        @keyframes rotate {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(90deg); }
        }
      </style>
    `;
    document.body.appendChild(overlay);
  }

  overlay.style.display = 'flex';
}

/**
 * Hide orientation warning
 */
function hideOrientationWarning(): void {
  const overlay = document.getElementById('orientation-warning');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

/**
 * Create Phaser game instance with high quality settings
 */
export function createPhaserGame(containerId: string = 'game-container'): Phaser.Game {
  // ✅ Force proper fullscreen BEFORE getting dimensions
  enforceGameContainer();

  // ✅ Get actual viewport dimensions (not from getOptimalCanvasDimensions)
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  const config: Phaser.Types.Core.GameConfig = {
    ...phaserConfig,
    parent: containerId,
    // ✅ Multiply by DPR for internal resolution
    width: width * dpr,
    height: height * dpr,
    scale: {
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: width * dpr,
      height: height * dpr,
      fullscreenTarget: containerId,
      parent: containerId,
    },
  };

  console.log(`🎮 Creating game:`);
  console.log(`   Display: ${width}×${height}`);
  console.log(`   Canvas: ${width * dpr}×${height * dpr}`);
  console.log(`   DPR: ${dpr}x`);

  const game = new Phaser.Game(config);

  return game;
}
