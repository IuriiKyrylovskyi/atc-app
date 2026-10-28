import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';

export function useAuth() {
  const authStore = useAuthStore();
  const router = useRouter();

  const isAuthenticated = computed(() => authStore.isAuthenticated);
  const user = computed(() => authStore.user);
  const needsMFA = computed(() => authStore.needsMFA);

  const login = async (username: string, password: string, otp?: string) => {
    return await authStore.login({ username, password, otp });
  };

  const logout = async () => {
    await authStore.logout();
    router.push({ name: 'Login' });
  };

  const refreshToken = async () => {
    return await authStore.refresh();
  };

  const requireStepUp = async (otp: string) => {
    return await authStore.stepUp({
      otp,
      backup_code: null,
      client_id: 'web',
      return_to: '/',
    });
  };

  return {
    isAuthenticated,
    user,
    needsMFA,
    login,
    logout,
    refreshToken,
    requireStepUp,
  };
}
