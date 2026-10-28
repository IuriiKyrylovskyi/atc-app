import { ref } from 'vue';
import { RevenueCatService } from '@/services/revenueCatService';

export function usePurchases() {
  const offerings = ref<any | null>(null);
  const customerInfo = ref<any | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadOfferings() {
    loading.value = true;
    error.value = null;
    try {
      offerings.value = await RevenueCatService.getOfferings();
      return offerings.value;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function refreshCustomerInfo() {
    loading.value = true;
    error.value = null;
    try {
      const info = await RevenueCatService.restorePurchases(); // restore returns customerInfo
      customerInfo.value = info;
      return info;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function purchasePackage(pkg: any) {
    loading.value = true;
    error.value = null;
    try {
      const res = await RevenueCatService.purchasePackage(pkg);
      if (res.success) customerInfo.value = res.customerInfo;
      return res;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return { success: false, error: error.value };
    } finally {
      loading.value = false;
    }
  }

  async function purchaseProduct(productId: string) {
    loading.value = true;
    error.value = null;
    try {
      const res = await RevenueCatService.purchaseProduct(productId);
      if (res.success) customerInfo.value = res.customerInfo;
      return res;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return { success: false, error: error.value };
    } finally {
      loading.value = false;
    }
  }

  async function restorePurchases() {
    return refreshCustomerInfo();
  }

  function hasProAccess() {
    return !!customerInfo.value?.entitlements?.active?.['pro_access'];
  }

  return {
    offerings,
    customerInfo,
    loading,
    error,
    loadOfferings,
    refreshCustomerInfo,
    purchasePackage,
    purchaseProduct,
    restorePurchases,
    hasProAccess,
  };
}
