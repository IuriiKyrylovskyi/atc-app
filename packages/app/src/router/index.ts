/**
 * packages/app/src/router/index.ts
 *
 * Routes behind the Home strips: Start Game, Control Center (→ airport shifts →
 * gameplay), Training Center (→ training play), System Config, plus the
 * single-device Waiting screen. GO PRO / PREMIUM ACCOUNT open the Paywall
 * modal on StripPage, so they have no route.
 */
import {
  createRouter,
  createWebHashHistory,
  type RouteLocationNormalized,
  type RouteRecordRaw,
} from 'vue-router';
import { useMonetizationStore } from '@/stores/monetization';
import { ensurePlayAllowed } from '@/composables/useSessionGuard';
import { progressService } from '@/services/progress';
import { ROUTE_TO_PAGE } from '@/composables/usePageName';
import { useStripPageTransition } from '@/composables/useStripPageTransition';
import { ENV } from '@/config/env';
import { isolationRequested, isolationUrl } from '@/utils/isolation';

const SCOPE_ENABLED = import.meta.env.DEV || ENV.VITE_FEATURE_SCOPE === 'true';
import { getAirportById } from '@/game/config/airports.config';
import {
  getLevelByAirportAndShift,
  getLevelByNumber,
  getGameplayLevelById,
  getLevelNumberById,
} from '@/game/config/levels.config';

const routes: RouteRecordRaw[] = [
  // ── Splash / loading ──────────────────────────────────────────────────────
  {
    path: '/',
    name: 'Intro',
    component: () => import('@/views/IntroScreen.vue'),
    meta: { requiresAuth: false, requiresPremium: false },
  },

  // ── <Home> ───────────────────────────────────────────────────────────
  {
    path: `/${ROUTE_TO_PAGE.Home}`,
    name: 'home',
    component: () => import('@/views/Home.vue'),
    meta: { requiresAuth: false, requiresPremium: false, isStripPage: true },
  },

  // ── Control Center → airport shifts ─────────────────────────────────────────
  {
    path: `/${ROUTE_TO_PAGE.Airfields}/:airportId/shifts`,
    name: 'AirportShifts',
    component: () => import('@/views/AirportShiftsScreen.vue'),
    meta: { requiresAuth: false, requiresPremium: false },
  },
  // `Airfields` is where the game sends the player after leaving a level
  // (GameView, AirTrafficCanvas, AirportShiftsScreen). It is the airport list,
  // i.e. the first Control Center page.
  {
    path: `/${ROUTE_TO_PAGE.Airfields}`,
    name: 'Airfields',
    redirect: { name: 'Control Center', params: { pageNumber: '1' } },
  },
  {
    path: '/game-mode',
    redirect: { name: 'Airfields' },
  },
  {
    path: `/${ROUTE_TO_PAGE.ControlCenter}/page-:pageNumber(\\d+)`,
    name: 'Control Center',
    component: () => import('@/views/ControlCenter.vue'),
    meta: { requiresAuth: false, requiresPremium: false, isStripPage: true },
  },
  // Legacy 0-based shape (`#/control-center/0`). The `\\d+` is load-bearing:
  // without it `/control-center/page-1` would also resolve HERE with
  // pageNumber = 'page-1', and the redirect below would then bounce the real
  // page to Home. The integer guard is the second line of defence for the same
  // reason.
  {
    path: `/${ROUTE_TO_PAGE.ControlCenter}/:pageNumber(\\d+)`,
    redirect: (to) => {
      const legacy = Number(to.params.pageNumber);
      const page = Number.isInteger(legacy) ? legacy + 1 : 1;
      return { name: 'Control Center', params: { pageNumber: String(page) } };
    },
  },
  {
    path: `/${ROUTE_TO_PAGE.ControlCenter}`,
    redirect: { name: 'Control Center', params: { pageNumber: '1' } },
  },
  {
    path: `/${ROUTE_TO_PAGE.TrainingCenter}`,
    name: 'Training Center',
    component: () => import('@/views/TrainingCenter.vue'),
    meta: { requiresAuth: false, requiresPremium: false },
  },

  // ── Gameplay ──────────────────────────────────────────────────────────────
  {
    path: '/play', // TODO: check if used
    name: 'Play',
    component: () => import('@/views/GameView.vue'),
    meta: { fullscreen: true, requiresAuth: false, requiresPremium: false },
  },
  {
    path: '/play/:airportId/:shiftId',
    name: 'Gameplay',
    component: () => import('@/views/GameView.vue'),
    meta: { fullscreen: true, requiresAuth: false, requiresPremium: false },
  },
  {
    path: '/train/:levelId',
    name: 'Training Play',
    component: () => import('@/views/GameView.vue'),
    props: true,
    meta: { requiresAuth: false, requiresPremium: false },
  },

  // ── Single active device (premium) ────────────────────────────────────────
  // Shown when the account's play session is held by another device.
  {
    path: '/waiting',
    name: 'Waiting',
    component: () => import('@/views/WaitingScreen.vue'),
    meta: { requiresAuth: false, requiresPremium: false, fullscreen: true },
  },

  // ── Utility screens ────────────────────────────────────────────────────────
  {
    path: `/${ROUTE_TO_PAGE.SystemConfig}`,
    name: 'SystemConfig',
    component: () => import('@/views/SystemConfig.vue'),
    meta: { requiresAuth: false, requiresPremium: false },
  },
  // The Paywall's "premium" finish sends the player to their settings; the
  // game-settings screen is not part of atc-app, so System Config takes it.
  {
    path: '/settings',
    name: 'Settings',
    redirect: { name: 'SystemConfig' },
  },

  // ── Radar scope (new ATC engine, feature-flagged) ───────────────────────────
  // Works offline from a local pack, so it skips the account init the game
  // screens need.
  ...(SCOPE_ENABLED
    ? [
        {
          path: '/scope/:packId',
          name: 'Scope',
          component: () => import('@/views/ScopeScreen.vue'),
          meta: { requiresAuth: false, requiresPremium: false, fullscreen: true, skipInit: true },
        } satisfies RouteRecordRaw,
      ]
    : []),

  // Anything else (old deep links, pages not ported) lands on the splash,
  // which owns the auth/init lifecycle.
  {
    path: '/:pathMatch(.*)*',
    redirect: { name: 'Intro' },
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// ── BACK must not re-enter a splash or a game ──────────────────────────────
//
// Every "play" route, by name and by path pattern:
//
//   PlayFields    'PlayFields'   /play-fields
//   Play          'Play'         /play
//   Gameplay      'Gameplay'     /play/:airportId/:shiftId
//   Training Play 'Training Play' /train/:levelId   ← name only, path is /train
//
// A hand-written list of route NAMES is how `Training Play` gets missed, and it
// is how a future /play... route gets missed too, so this matches a pattern
// against the name AND the record pattern instead. The record pattern
// (`route.matched[].path`) is used rather than `route.path` so a parameter
// value can never contribute a false positive.
//
// `Play` looks dead — it is pushed by playLevel, but GameContainer immediately
// REPLACES it with `Gameplay`, so `Gameplay` is the name that actually persists
// in history. The `// TODO: check if used` on the route is stale.
const isPlayRoute = (route: RouteLocationNormalized) =>
  /play/i.test(
    `${String(route.name ?? '')} ${route.matched.map((record) => record.path).join(' ')}`
  );

/**
 * The fullscreen GameView routes. Already being inside one means a further play
 * navigation is moving between levels ("Next Level" pushes the next one), not
 * re-entering the game from a menu — so those are let through. `PlayFields` is
 * deliberately NOT here (route not ported, name kept for the pattern): it is a
 * menu, and backing from it into a game is exactly the trap this guard closes.
 *
 * This must be the explicit list and nothing else. Folding `isPlayRoute` in as a
 * fallback looks harmless and is not: it re-admits PlayFields through the name
 * test and exempts it again, so backing out of the hub into a game went
 * through.
 */
const FULLSCREEN_PLAY_ROUTES = new Set(['Play', 'Gameplay', 'Training Play']);

const isFullscreenPlayRoute = (route: RouteLocationNormalized) =>
  FULLSCREEN_PLAY_ROUTES.has(String(route.name ?? ''));

/**
 * Guards receive no `navigationType`, so a pop has to be told from a push by
 * hand. vue-router stamps an increasing `position` into every history entry
 * (`buildState`) and a browser back RESTORES the older, smaller entry before
 * the router runs any guard — so comparing the live position against the one
 * seen at the end of the previous navigation identifies a pop. A push runs its
 * guards before the state is written, so both are equal.
 *
 * This distinction is load-bearing: a PUSH into a game is always deliberate
 * (Training Center's "play training level" strip pushes `/train/N`) and must
 * keep working, while only the pop is a stray back.
 */
let positionAfterLastNavigation: number | null = null;

const historyPosition = (): number | null => {
  const position = (window.history.state as { position?: number } | null)?.position;
  return typeof position === 'number' ? position : null;
};

router.afterEach(() => {
  positionAfterLastNavigation = historyPosition();
});

// Only the radar scope runs cross-origin isolated (utils/isolation.ts): leaving
// it reloads the app unisolated, so the paywall's checkout iframes are never blocked.
router.beforeEach((to) => {
  if (!isolationRequested() || to.name === 'Scope') return true;
  window.location.replace(isolationUrl(false, `#${to.fullPath}`));
  return false;
});

// Registered BEFORE the monetization guard so a stray back into a game never
// pays for `await monetization.init()`.
router.beforeEach((to, from) => {
  if (to.name !== 'Intro' && !isPlayRoute(to)) return true;
  // Stepping between levels inside the game is a normal back: "Next Level"
  // PUSHES the next one, so the previous level is one entry back. Both sides
  // must be a fullscreen play route — exempting merely BEING in the game also
  // let a pop out of it land on the splash, which is the thing being prevented.
  if (isFullscreenPlayRoute(from) && isFullscreenPlayRoute(to)) return true;

  const live = historyPosition();
  const isPop =
    live !== null && positionAfterLastNavigation !== null && live < positionAfterLastNavigation;

  return isPop ? { name: 'home' } : true;
});

// ── Global navigation guard ────────────────────────────────────────────────

router.beforeEach(async (to, from, next) => {
  const monetization = useMonetizationStore();
  const { setFromStripPage } = useStripPageTransition();

  // Skip init for the Intro route — IntroScreen owns the init lifecycle.
  // This allows post-deletion navigation to /intro without immediately
  // creating a new anonymous user (user hasn't clicked Start Game yet).
  // Routes marked `skipInit` (the offline radar scope) need no account at all.
  const skipsInit = to.name === 'Intro' || to.meta.skipInit === true;

  if (!skipsInit && !monetization.isInitialized) {
    await monetization.init();
  }

  // Safety net: if store still not initialized after init attempt
  // (e.g. deep link right after account deletion), redirect to Intro.
  if (!skipsInit && !monetization.isInitialized) {
    next({ name: 'Intro' });
    return;
  }

  // ── Gameplay access gate ────────────────────────────────────────────────
  if (to.name === 'Gameplay' || to.name === 'LegacyGame') {
    const airportId = to.name === 'Gameplay' ? String(to.params.airportId ?? '') : '';
    const shiftId = to.name === 'Gameplay' ? String(to.params.shiftId ?? '') : '';
    const legacyLevelId = String(to.params.levelId ?? '');
    const legacyLevelNumber = Number(legacyLevelId);
    const level =
      to.name === 'Gameplay'
        ? getLevelByAirportAndShift(airportId, shiftId)
        : Number.isInteger(legacyLevelNumber)
        ? getLevelByNumber(legacyLevelNumber)
        : getGameplayLevelById(legacyLevelId);

    if (!level) {
      next({ name: 'Airfields' });
      return;
    }

    const airport = getAirportById(level.airportId);
    const levelNumber =
      to.name === 'Gameplay'
        ? getLevelNumberById(level.id)
        : Number.isInteger(legacyLevelNumber)
        ? legacyLevelNumber
        : getLevelNumberById(level.id);
    const canAccessNumber =
      levelNumber !== undefined &&
      levelNumber !== null &&
      !Number.isNaN(levelNumber) &&
      monetization.canAccessLevel(levelNumber);

    if ((airport?.tier === 'paid' && !monetization.isPremium) || !canAccessNumber) {
      // skymess sent this to the splash with `showUpsell`, which nothing reads.
      // Open the paywall on Home instead so the player sees why it is locked.
      next({
        name: 'home',
        query: { paywall: 'open', lockedLevel: String(levelNumber ?? level.id) },
      });
      return;
    }

    // A premium player owns every airport, but within an airport only the
    // shifts they have completed plus one more are open. The shift list already
    // enforces that; this keeps a deep link from skipping ahead, so the list and
    // the router can never disagree about what is playable.
    if (monetization.isPremium && airportId && shiftId) {
      if (!progressService.isShiftPlayable(airportId, shiftId)) {
        next({ name: 'AirportShifts', params: { airportId } });
        return;
      }
    }

    // ── Single active device ──────────────────────────────────────────────
    // A premium account may only be played on one device at a time. Claim the
    // session before the level boots; if another device holds it, send the
    // player to the waiting page instead of letting two devices write to the
    // same progress.
    if (monetization.isPremium) {
      const allowed = await ensurePlayAllowed();
      if (!allowed) {
        next({ name: 'Waiting', query: { redirect: to.fullPath } });
        return;
      }
    }
  }

  // ── Generic premium gate ────────────────────────────────────────────────
  if (to.meta.requiresPremium && !monetization.isPremium) {
    next({ name: 'home', query: { paywall: 'open' } });
    return;
  }

  setFromStripPage(!!to.meta.isStripPage && !!from.meta.isStripPage);

  next();
});

export default router;
