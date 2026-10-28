import { ref, computed, onMounted, onUnmounted } from 'vue';
import { detectAspectRatio } from '@/utils/aspectRatio';

// Eagerly evaluated at module load so the FIRST render already picks the right
// mobile/desktop + portrait/landscape strip layout. `useDevice` used to start
// both flags at `false` and only flip them in `onMounted`, so on a phone the
// first paint rendered the desktop strip array and then re-rendered to the
// mobile one a frame later. The centre column's fall animation is armed from
// StripColumn.onMounted (children mount before parents), so during that flip it
// sometimes bound the old elements and sometimes the new ones — on a cold start
// some strips in the middle landed together with the first ones instead of
// holding their 0.15s stagger. Desktop was unaffected because its defaults
// already matched, and every redirect was unaffected because the pageKey
// watcher bumps restartKey and remounts cleanly.
const _initial = typeof window !== 'undefined' ? detectAspectRatio() : { isMobile: false };
const isMobile = ref(_initial.isMobile);
const isPortrait = ref(typeof window !== 'undefined' && window.innerHeight > window.innerWidth && window.innerWidth <= 600);

function updateFlags() {
  if (typeof window === 'undefined') return;
  isMobile.value = detectAspectRatio().isMobile;
  isPortrait.value = window.innerHeight > window.innerWidth && window.innerWidth <= 600;
  console.log('[useDevice] updateFlags', {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    isPortrait: isPortrait.value,
  });
}

// Deferred retries cover browsers that fire orientationchange/resize BEFORE
// window.innerWidth/Height have updated — without them isPortrait stays stale,
// screenRotation never flips, the StripPage screenRotation watcher never fires,
// restartKey never bumps, and the strips keep their `settled` class
// (animation:none) so they do not re-drop on rotation.
function deferredFlags() {
  setTimeout(updateFlags, 50);
  setTimeout(updateFlags, 250);
}

// Register listeners at module load so tracking is active regardless of
// component mount lifecycle — rotation events fire even when no component
// using `useDevice` is currently mounted. Guarded against missing APIs.
if (typeof window !== 'undefined') {
  window.addEventListener('resize', deferredFlags);
  window.addEventListener('orientationchange', deferredFlags);
  if (typeof (window as any).visualViewport !== 'undefined' && (window as any).visualViewport) {
    (window as any).visualViewport.addEventListener('resize', deferredFlags);
  }
}

export function useDevice() {
  // Synchronous first pass for the initial render.
  const syncFlags = () => updateFlags();

  onMounted(() => {
    syncFlags();
  });

  onUnmounted(() => {
    // Kept for backwards compatibility; module-level listeners are the
    // primary trigger and remain registered for the page lifetime.
  });

  return {
    isMobile: computed(() => isMobile.value),
    isPortrait: computed(() => isPortrait.value),
    isDesktop: computed(() => !isMobile.value),
    isLandscape: computed(() => !isPortrait.value),
    screenType: computed(() => (isMobile.value ? 'mobile' : 'desktop')),
    screenRotation: computed(() => (isPortrait.value ? 'portrait' : 'landscape')),
  };
}
