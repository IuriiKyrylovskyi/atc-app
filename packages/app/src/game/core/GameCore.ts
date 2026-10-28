import Phaser from 'phaser';
import { createPhaserGame } from '@/game/config/phaser.config';
import { gameEventBus } from '@/services/EventBus';

/**
 * GameCore wrapper for Phaser
 * Manages the Phaser game instance and provides Vue integration
 */
export class GameCore {
  /**
   * The live instance. GameCore is created by useGame() inside a component, so
   * without this handle app-level lifecycle events (Android backgrounding the
   * app) have no way to reach the running scene.
   */
  private static _active: GameCore | null = null;

  static get active(): GameCore | null {
    return GameCore._active;
  }

  private game: Phaser.Game | null = null;
  private container: HTMLElement;
  private isInitialized: boolean = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Initialize Phaser game
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      console.warn('GameCore already initialized');
      return;
    }

    try {
      // Create Phaser game instance
      this.game = createPhaserGame(this.container.id || 'game-container');

      this.isInitialized = true;
      GameCore._active = this;

      // Expose the Phaser game instance on window so AirTrafficCanvas can
      // reach the AudioContext for iOS unlock without a circular import.
      (window as unknown as Record<string, unknown>).__PHASER_GAME__ = this.game;

      // Emit ready event
      gameEventBus.emit('game:ready');

      console.log('✅ GameCore initialized with Phaser');
    } catch (error) {
      console.error('❌ Failed to initialize GameCore:', error);
      throw error;
    }
  }

  /**
   * Start the game
   */
  start(): void {
    if (!this.game) {
      console.error('Cannot start game: not initialized');
      return;
    }

    // Game automatically starts with BootScene
    gameEventBus.emit('game:start');
  }

  /**
   * Pause the game
   */
  pause(): void {
    if (!this.game) return;

    this.game.scene.pause('GameScene');
    gameEventBus.emit('game:pause');
  }

  /**
   * Resume the game
   */
  resume(): void {
    if (!this.game) return;

    this.game.scene.resume('GameScene');
    gameEventBus.emit('game:resume');
  }

  /**
   * Restart the game
   */
  restart(): void {
    if (!this.game) return;

    const gameScene = this.game.scene.getScene('GameScene');
    if (gameScene) {
      this.game.scene.stop('GameScene');
      this.game.scene.start('GameScene');
      // No game:restart emit needed - new GameScene instance initializes itself
    }
  }

  /**
   * Toggle debug mode
   */
  toggleDebug(): void {
    if (!this.game) return;

    const gameScene = this.game.scene.getScene('GameScene');
    if (gameScene && gameScene.physics) {
      gameScene.physics.world.drawDebug = !gameScene.physics.world.drawDebug;
    }
  }

  /**
   * Get current game stats
   */
  getStats() {
    if (!this.game) return null;

    const gameScene = this.game.scene.getScene('GameScene');

    return {
      fps: this.game.loop.actualFps,
      isRunning: gameScene?.scene.isActive() || false,
      isPaused: gameScene?.scene.isPaused() || false,
    };
  }

  /**
   * Destroy the game instance
   */
  destroy(): void {
    if (this.game) {
      this.game.destroy(true);
      this.game = null;
      this.isInitialized = false;
      if (GameCore._active === this) GameCore._active = null;

      // Remove the global reference so stale AudioContext unlock attempts fail gracefully
      delete (window as unknown as Record<string, unknown>).__PHASER_GAME__;

      gameEventBus.emit('game:destroyed');
      console.log('✅ GameCore destroyed');
    }
  }

  /**
   * Check if game is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.game !== null;
  }

  /**
   * Get Phaser game instance (for advanced usage)
   */
  getPhaserGame(): Phaser.Game | null {
    return this.game;
  }
}
