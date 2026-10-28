import { defineStore } from 'pinia';
import { gameEventBus } from '@/services/EventBus';
import { AudioSystem } from '@/game/systems/AudioSystem';
import { VISUAL_DEFAULTS } from '@/game/config/defaults.config';

export interface SettingsState {
  audio: {
    masterVolume: number;
    musicVolume: number;
    sfxVolume: number;
    muted: boolean;
  };
  controls: {
    hapticFeedback: boolean;
  };
  gameplay: {
    backgroundDimming: number; // ✅ NEW: 0 to 100 (percentage)
  };
  // Update check settings
  checkForUpdates: boolean;
  updateCheckIntervalHours: number;
}

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    audio: {
      masterVolume: 1.0,
      musicVolume: 1.0,
      sfxVolume: 1.0,
      muted: false,
    },
    controls: {
      hapticFeedback: true,
    },
    gameplay: {
      backgroundDimming: VISUAL_DEFAULTS.BG_DIMMING_DEFAULT,
    },
    // Update check defaults
    checkForUpdates: true,
    updateCheckIntervalHours: 24,
  }),

  getters: {
    /**
     * Get background alpha (opacity) from dimming percentage
     * 0% = fully visible (1.0), 100% = fully dimmed (0.0)
     */
    backgroundAlpha: (state): number => {
      return 1.0 - state.gameplay.backgroundDimming / 100;
    },
  },

  actions: {
    /**
     * Load settings from localStorage
     */
    loadSettings() {
      try {
        const saved = localStorage.getItem('atc-app_settings');
        if (saved) {
          const parsed = JSON.parse(saved);
          // $patch goes through Vue's reactive setters, so this.audio etc.
          // immediately reflect the loaded values in the same call stack.
          // Object.assign(this.$state, ...) writes to the raw backing object
          // and can leave the reactive proxy returning stale cached values —
          // which caused applySettings() below to receive default values
          // instead of the saved ones.
          this.$patch(parsed);
        }
        // Push the now-correct audio state to AudioSystem._vol so that
        // startMusic() uses the right volume when GameScene.create() fires.
        AudioSystem.applySettings(this.audio);
        this.emitAllSettings();
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    },

    /**
     * Save settings to localStorage
     */
    saveSettings() {
      try {
        localStorage.setItem('atc-app_settings', JSON.stringify(this.$state));
        console.log('✅ Settings saved');
      } catch (error) {
        console.error('❌ Failed to save settings:', error);
      }
    },

    /**
     * Update audio settings
     */
    updateAudio(settings: Partial<SettingsState['audio']>) {
      Object.assign(this.audio, settings);
      // Direct call — works even before AudioSystem.init() registers the event
      // listener, so volume changes on the settings screen take effect when the
      // game later starts, not just while it is running.
      AudioSystem.applySettings(this.audio);
      gameEventBus.emit('settings:audio', this.audio);
      this.saveSettings();
    },

    /**
     * ✅ NEW: Update background dimming
     */
    updateBackgroundDimming(dimming: number) {
      // Clamp between 0 and 100
      this.gameplay.backgroundDimming = Math.max(0, Math.min(100, dimming));
      gameEventBus.emit('settings:background', {
        dimming: this.gameplay.backgroundDimming,
        alpha: this.backgroundAlpha,
      });
      this.saveSettings();
    },

    /**
     * Update gameplay settings
     */
    updateGameplay(settings: Partial<SettingsState['gameplay']>) {
      Object.assign(this.gameplay, settings);

      if (settings.backgroundDimming !== undefined) {
        gameEventBus.emit('settings:background', {
          dimming: this.gameplay.backgroundDimming,
          alpha: this.backgroundAlpha,
        });
      }

      this.saveSettings();
    },

    /**
     * Update controls settings
     */
    updateControls(settings: Partial<SettingsState['controls']>) {
      Object.assign(this.controls, settings);
      gameEventBus.emit('settings:controls', this.controls);
      this.saveSettings();
    },

    /**
     * Update update check settings
     */
    updateUpdateCheck(settings: { checkForUpdates?: boolean; updateCheckIntervalHours?: number }) {
      if (settings.checkForUpdates !== undefined) {
        this.checkForUpdates = settings.checkForUpdates;
      }
      if (settings.updateCheckIntervalHours !== undefined) {
        this.updateCheckIntervalHours = Math.max(
          1,
          Math.min(168, settings.updateCheckIntervalHours)
        ); // 1 hour to 1 week
      }
      this.saveSettings();
    },

    /**
     * Reset to default settings
     */
    resetToDefaults() {
      this.$reset();
      this.emitAllSettings();
      this.saveSettings();
    },

    /**
     * Emit all settings to game (useful on init)
     *
     * skymess also emitted `graphics` and `gameplay.zoom` here (and had
     * updateGraphics/updateZoom actions), but neither field exists in the
     * state, so those only ever sent `undefined`; they were removed.
     */
    emitAllSettings() {
      gameEventBus.emit('settings:audio', this.audio);
      gameEventBus.emit('settings:background', {
        dimming: this.gameplay.backgroundDimming,
        alpha: this.backgroundAlpha,
      });
    },
  },
});
