import { defineStore } from 'pinia';
import { safeStorage } from '@/lib/safeStorage';

// Game settings (audio volumes, background dimming, zoom) live with the game,
// which is not part of atc-app yet. Add them back here when it is.
export interface SettingsState {
  controls: {
    hapticFeedback: boolean;
  };
  // Update check settings
  checkForUpdates: boolean;
  updateCheckIntervalHours: number;
}

const SETTINGS_STORAGE_KEY = 'atc-app_settings';

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    controls: {
      hapticFeedback: true,
    },
    // Update check defaults
    checkForUpdates: true,
    updateCheckIntervalHours: 24,
  }),

  actions: {
    /**
     * Load settings from localStorage
     */
    loadSettings() {
      try {
        const saved = safeStorage.getItem(SETTINGS_STORAGE_KEY);
        if (saved) {
          // $patch goes through Vue's reactive setters, so the loaded values are
          // visible in the same call stack.
          this.$patch(JSON.parse(saved));
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    },

    /**
     * Save settings to localStorage
     */
    saveSettings() {
      try {
        safeStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.$state));
      } catch (error) {
        console.error('❌ Failed to save settings:', error);
      }
    },

    /**
     * Update controls settings
     */
    updateControls(settings: Partial<SettingsState['controls']>) {
      Object.assign(this.controls, settings);
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
      this.saveSettings();
    },
  },
});
