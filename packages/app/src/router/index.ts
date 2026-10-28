/**
 * packages/app/src/router/index.ts
 *
 * Only the Intro splash and Home are routed today. The Paywall is not a page:
 * StripPage opens it as a modal (GO PRO strip, `?paywall=restore`).
 */
import {
  createRouter,
  createWebHashHistory,
  type RouteLocationNormalized,
  type RouteRecordRaw,
} from 'vue-router';
import { useMonetizationStore } from '@/stores/monetization';
import { ROUTE_TO_PAGE } from '@/composables/usePageName';
import { useStripPageTransition } from '@/composables/useStripPageTransition';

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

  // Anything else (old deep links, pages not ported yet) lands on the splash,
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

// ── BACK must not re-enter the splash ──────────────────────────────────────
//
// Guards receive no `navigationType`, so a pop has to be told from a push by
// hand. vue-router stamps an increasing `position` into every history entry
// (`buildState`) and a browser back RESTORES the older, smaller entry before
// the router runs any guard — so comparing the live position against the one
// seen at the end of the previous navigation identifies a pop. A push runs its
// guards before the state is written, so both are equal.
let positionAfterLastNavigation: number | null = null;

const historyPosition = (): number | null => {
  const position = (window.history.state as { position?: number } | null)?.position;
  return typeof position === 'number' ? position : null;
};

router.afterEach(() => {
  positionAfterLastNavigation = historyPosition();
});

// Registered BEFORE the monetization guard so a stray back onto the splash
// never pays for `await monetization.init()`.
router.beforeEach((to: RouteLocationNormalized) => {
  if (to.name !== 'Intro') return true;

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
  // This allows post-deletion navigation to the splash without immediately
  // creating a new anonymous user (user hasn't clicked Start yet).
  const isIntroRoute = to.name === 'Intro';

  if (!isIntroRoute && !monetization.isInitialized) {
    await monetization.init();
  }

  // Safety net: if store still not initialized after init attempt
  // (e.g. deep link right after account deletion), redirect to Intro.
  if (!isIntroRoute && !monetization.isInitialized) {
    next({ name: 'Intro' });
    return;
  }

  // ── Generic premium gate ────────────────────────────────────────────────
  // No route is premium-only yet; this is here for the first one that is.
  // A locked route sends the player Home with the paywall open on top.
  if (to.meta.requiresPremium && !monetization.isPremium) {
    next({ name: 'home', query: { paywall: 'open' } });
    return;
  }

  setFromStripPage(!!to.meta.isStripPage && !!from.meta.isStripPage);

  next();
});

export default router;
