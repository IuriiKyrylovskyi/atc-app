import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  User,
  LoginCredentials,
  AuthResponse,
  MeResponse,
  StepUpCredentials,
} from '@/types/auth';
import { useApiStore } from './api';
import { safeStorage } from '@/lib/safeStorage';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const accessToken = ref<string | null>(null);
  const refreshToken = ref<string | null>(null);
  const expiresAt = ref<number | null>(null);
  const mfaRequired = ref(false);
  const csrfToken = ref<string | null>(null);

  const isAuthenticated = computed(() => {
    if (!accessToken.value || !user.value) return false;
    if (expiresAt.value && Date.now() >= expiresAt.value) return false;
    return true;
  });

  const needsMFA = computed(() => mfaRequired.value);

  const initAuth = async () => {
    const savedToken = safeStorage.getItem('access_token');
    const savedRefreshToken = safeStorage.getItem('refresh_token');
    const savedUser = safeStorage.getItem('auth_user');
    const savedExpiresAt = safeStorage.getItem('expires_at');
    const savedCsrfToken = safeStorage.getItem('csrf_token');

    if (savedToken && savedUser && savedExpiresAt) {
      const expiry = parseInt(savedExpiresAt);

      // Check if token is expired
      if (Date.now() < expiry) {
        accessToken.value = savedToken;
        refreshToken.value = savedRefreshToken;
        try {
          user.value = JSON.parse(savedUser);
        } catch {
          user.value = null;
        }
        expiresAt.value = expiry;
        csrfToken.value = savedCsrfToken;

        // Set token in API store
        const apiStore = useApiStore();
        apiStore.setAuthToken(savedToken);

        // Fetch fresh user data
        await fetchUserData();
      } else {
        // Try to refresh token
        const refreshed = await refresh();
        if (!refreshed) {
          logout();
        }
      }
    }
  };

  const login = async (credentials: LoginCredentials) => {
    try {
      const apiStore = useApiStore();

      // Call IDP login endpoint
      const response = await apiStore.post<AuthResponse>('/auth/login', {
        username: credentials.username,
        password: credentials.password,
        otp: credentials.otp || undefined,
      });

      if (response.success && response.data) {
        const authData = response.data;

        // Store tokens
        accessToken.value = authData.access_token;
        expiresAt.value = Date.now() + authData.expires_in * 1000;

        if (authData.refresh_token) {
          refreshToken.value = authData.refresh_token;
          safeStorage.setItem('refresh_token', authData.refresh_token);
        }

        safeStorage.setItem('access_token', authData.access_token);
        safeStorage.setItem('expires_at', expiresAt.value.toString());

        // Set token in API store
        apiStore.setAuthToken(authData.access_token);

        // Fetch user data
        await fetchUserData();

        mfaRequired.value = false;

        return { success: true };
      }

      // Check if MFA is required
      if (response.error?.includes('MFA') || response.error?.includes('OTP')) {
        mfaRequired.value = true;
        return {
          success: false,
          error: 'MFA required',
          requiresMFA: true,
        };
      }

      return {
        success: false,
        error: response.error || 'Authentication failed',
      };
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: 'Network error. Please check your connection.',
      };
    }
  };

  const stepUp = async (credentials: StepUpCredentials) => {
    try {
      const apiStore = useApiStore();

      const response = await apiStore.post<{ ok: boolean }>('/auth/stepup', credentials, {
        'X-CSRF-Token': csrfToken.value || '',
      });

      if (response.success && response.data?.ok) {
        return { success: true };
      }

      return {
        success: false,
        error: response.error || 'Step-up authentication failed',
      };
    } catch (error) {
      console.error('Step-up error:', error);
      return {
        success: false,
        error: 'Step-up authentication error',
      };
    }
  };

  const fetchUserData = async () => {
    try {
      const apiStore = useApiStore();

      const response = await apiStore.get<MeResponse>('/auth/me');

      if (response.success && response.data) {
        const userData = response.data;

        user.value = {
          sub: userData.sub,
          upn: userData.upn,
          name: userData.name,
          email: userData.email,
          amr: userData.amr,
          acr: userData.acr,
          auth_time: userData.auth_time,
          mfa_time: userData.mfa_time,
        };

        safeStorage.setItem('auth_user', JSON.stringify(user.value));

        return true;
      }

      return false;
    } catch (error) {
      console.error('Fetch user data error:', error);
      return false;
    }
  };

  const refresh = async () => {
    try {
      const apiStore = useApiStore();

      const response = await apiStore.post<{ ok: boolean }>(
        '/auth/refresh',
        {},
        {
          'X-CSRF-Token': csrfToken.value || '',
        }
      );

      if (response.success && response.data?.ok) {
        // Token refreshed, fetch new user data
        await fetchUserData();
        return true;
      }

      return false;
    } catch (error) {
      console.error('Token refresh error:', error);
      return false;
    }
  };

  const logout = async () => {
    try {
      const apiStore = useApiStore();

      // Call logout endpoint
      await apiStore.post(
        '/auth/logout',
        {},
        {
          'X-CSRF-Token': csrfToken.value || '',
        }
      );
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Clear local state
      user.value = null;
      accessToken.value = null;
      refreshToken.value = null;
      expiresAt.value = null;
      mfaRequired.value = false;
      csrfToken.value = null;

      // Clear API token
      const apiStore = useApiStore();
      apiStore.clearAuthToken();

      // Clear localStorage
      safeStorage.removeItem('access_token');
      safeStorage.removeItem('refresh_token');
      safeStorage.removeItem('auth_user');
      safeStorage.removeItem('expires_at');
      safeStorage.removeItem('csrf_token');
    }
  };

  const updateUser = (userData: Partial<User>) => {
    if (user.value) {
      user.value = { ...user.value, ...userData };
      safeStorage.setItem('auth_user', JSON.stringify(user.value));
    }
  };

  const setCsrfToken = (token: string) => {
    csrfToken.value = token;
    safeStorage.setItem('csrf_token', token);
  };

  return {
    user,
    accessToken,
    refreshToken,
    expiresAt,
    mfaRequired,
    csrfToken,
    isAuthenticated,
    needsMFA,
    initAuth,
    login,
    stepUp,
    fetchUserData,
    refresh,
    logout,
    updateUser,
    setCsrfToken,
  };
});
