import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import vuetify from './plugins/vuetify';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';

// ── IMPORTANT ────────────────────────────────────────────────────────────────
// RevenueCat is initialized ONLY inside monetizationStore.init() via
// RevenueCatService.initialize(). Do NOT call Purchases.configure() here —
// doing so causes a double-configure race condition and the second call
// silently fails on both iOS and Android.
// ─────────────────────────────────────────────────────────────────────────────

if (Capacitor.getPlatform() === 'ios') {
  StatusBar.hide();
}

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(vuetify);

app.mount('#app');
