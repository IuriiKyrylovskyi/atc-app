# Paywall.vue — Integration Guide

## File location

```
packages/app/src/components/monetization/Paywall.vue
```

---

## How it works

The paywall has two modes depending on platform:

- **Native mobile (iOS/Android):** Fetches live offerings from RevenueCat → displays real store package with price → calls `Purchases.purchasePackage()` via RC SDK
- **Web/Electron:** Fetches offerings through the RevenueCat Web SDK (`@revenuecat/purchases-js`) → in-app checkout (Paddle via RevenueCat Web Billing) → the webhook creates the account and the paywall polls for it

RC offerings are fetched from `offerings.current.availablePackages` (the default offering set in RC dashboard). The active offering is `default_v2`, package `$rc_lifetime`.

---

## Props

| Prop          | Type      | Default | Description                                   |
| ------------- | --------- | ------- | --------------------------------------------- |
| `visible`     | `boolean` | `false` | Show / hide the overlay                       |
| `dismissible` | `boolean` | `true`  | Show X button and allow backdrop tap to close |

## Emits

| Event       | Payload | When                              |
| ----------- | ------- | --------------------------------- |
| `close`     | —       | User dismisses without purchasing |
| `purchased` | —       | Purchase or restore succeeded     |

---

## 1 — Drop-in on any screen (e.g. Home.vue)

```vue
<template>
  <div class="main-menu">
    <!-- Your existing screen content -->
    <button v-if="!monetization.isPremium" class="menu-btn purchase" @click="showPaywall = true">
      <span class="icon">💎</span>
      <span>Purchase Full Game</span>
    </button>
  </div>

  <!-- Paywall — lives outside your layout, teleports to <body> -->
  <Paywall :visible="showPaywall" @close="showPaywall = false" @purchased="showPaywall = false" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useMonetizationStore } from '@/stores/monetization';
import Paywall from '@/components/monetization/Paywall.vue';

const monetization = useMonetizationStore();
const showPaywall = ref(false);
</script>
```

---

## 2 — Level gate (from [TODO: add correct component] or GameView)

```vue
<template>
  <div class="airfields-screen">
    <button v-for="level in levels" :key="level.id" @click="selectLevel(level)">
      {{ level.name }}
      <span v-if="!monetization.canAccessLevel(level.number)">🔒</span>
    </button>
  </div>

  <Paywall :visible="showPaywall" @close="showPaywall = false" @purchased="onPurchased" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useMonetizationStore } from '@/stores/monetization';
import Paywall from '@/components/monetization/Paywall.vue';

const router = useRouter();
const monetization = useMonetizationStore();
const showPaywall = ref(false);
const attemptedLevel = ref<number | undefined>(undefined);

function selectLevel(level: { number: number; id: string }) {
  if (!monetization.canAccessLevel(level.number)) {
    attemptedLevel.value = level.number;
    showPaywall.value = true;
    return;
  }
  router.push({ name: 'Game', params: { levelId: level.number } });
}

function onPurchased() {
  showPaywall.value = false;
  if (attemptedLevel.value) {
    router.push({ name: 'Game', params: { levelId: attemptedLevel.value } });
  }
}
</script>
```

---

## 3 — Non-dismissible hard gate (e.g. trial expired)

```vue
<Paywall
  :visible="!monetization.isPremium && trialExpired"
  :dismissible="false"
  @purchased="trialExpired = false"
/>
```

Setting `:dismissible="false"` hides the X button and disables backdrop tap — the user must purchase or restore to proceed.

---

## Debug panel

The paywall has a built-in debug panel (tap the yellow DEBUG badge in the top-left corner to toggle). It shows:

- Platform, isNativeMobile, Capacitor presence
- RC key validity and prefix
- RC initialized status
- Offerings status — whether `current` is set and how many packages loaded
- Selected package identifier
- 🧪 **Test RC Native Paywall** button — triggers `RevenueCatUI.presentPaywall()` directly to verify the RC → Play Store connection independently of the custom UI

The debug panel is always visible in development. Remove or gate it before production release by setting `showDebugPanel` default to `false`.

---

## RC Offerings structure

The RC SDK returns:

```ts
{
  current: PurchasesOffering | null,  // the default offering
  all: Record<string, PurchasesOffering>  // all offerings by identifier
}
```

Packages are at `offerings.current.availablePackages`. If `current` is null, the Play Store could not resolve the product — this is a configuration issue, not a code issue. Check:

1. Product is Active in Play Console
2. Product ID in RC matches exactly what's in Play Console
3. App is installed via Play Store (not adb) for testing
4. RC offering `default_v2` is marked as default (blue circle in RC dashboard)

---

## Locked level indicator (optional UI hint)

```vue
<div class="level-card" :class="{ locked: !monetization.canAccessLevel(level.number) }">
  <span class="lock-icon" v-if="!monetization.canAccessLevel(level.number)">
    🔒
  </span>
  {{ level.name }}
</div>
```
