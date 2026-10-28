import { ref } from 'vue';

/**
 * True while a paywall waits for a request it started (purchase, restore, switch
 * account…). App.vue's Android back-button handler ignores Back while it is set, so
 * the page under the paywall cannot be left mid-request. Written only by Paywall.vue.
 */
export const paywallBusy = ref(false);
