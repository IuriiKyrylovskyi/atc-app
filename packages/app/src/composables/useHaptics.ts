import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export function useHaptics() {
  const settingsStore = useSettingsStore();

  const enabled = computed(() => settingsStore.controls.hapticFeedback);

  async function trigger(style: 'light' | 'medium' | 'heavy' = 'light') {
    if (!enabled.value) return;
    try {
      const impactStyle =
        style === 'medium'
          ? ImpactStyle.Medium
          : style === 'heavy'
          ? ImpactStyle.Heavy
          : ImpactStyle.Light;
      await Haptics.impact({ style: impactStyle });
    } catch {
      // no-op: haptics are optional and should never break the UI
    }
  }

  return { trigger };
}
