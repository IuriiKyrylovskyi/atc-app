import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ApiResponse } from '@/types/auth';

export const useApiStore = defineStore('api', () => {
  const authToken = ref<string | null>(null);
  const baseUrl = ref(import.meta.env?.VITE_API_URL || 'https://idp.example.com');
  const loading = ref(false);

  const setAuthToken = (token: string) => {
    authToken.value = token;
  };

  const clearAuthToken = () => {
    authToken.value = null;
  };

  const getHeaders = (additionalHeaders?: Record<string, string>) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (authToken.value) {
      headers['Authorization'] = `Bearer ${authToken.value}`;
    }

    if (additionalHeaders) {
      Object.assign(headers, additionalHeaders);
    }

    return headers;
  };

  const handleResponse = async <T>(response: Response): Promise<ApiResponse<T>> => {
    if (!response.ok) {
      if (response.status === 401) {
        return {
          success: false,
          error: 'Unauthorized. Please login again.',
        };
      }

      if (response.status === 403) {
        return {
          success: false,
          error: 'Forbidden. You do not have permission.',
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          error: 'Too many requests. Please try again later.',
        };
      }

      try {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData.message || errorData.error || `HTTP Error ${response.status}`,
        };
      } catch {
        return {
          success: false,
          error: `HTTP Error ${response.status}`,
        };
      }
    }

    const data = await response.json();
    return {
      success: true,
      data,
    };
  };

  const get = async <T = unknown>(
    endpoint: string,
    additionalHeaders?: Record<string, string>
  ): Promise<ApiResponse<T>> => {
    loading.value = true;
    try {
      const response = await fetch(`${baseUrl.value}${endpoint}`, {
        method: 'GET',
        headers: getHeaders(additionalHeaders),
        credentials: 'include', // Important for cookies (CSRF)
      });

      return await handleResponse<T>(response);
    } catch (error) {
      console.error('API GET error:', error);
      return {
        success: false,
        error: 'Network error',
      };
    } finally {
      loading.value = false;
    }
  };

  const post = async <T = unknown>(
    endpoint: string,
    data: unknown,
    additionalHeaders?: Record<string, string>
  ): Promise<ApiResponse<T>> => {
    loading.value = true;
    try {
      const response = await fetch(`${baseUrl.value}${endpoint}`, {
        method: 'POST',
        headers: getHeaders(additionalHeaders),
        body: JSON.stringify(data),
        credentials: 'include', // Important for cookies (CSRF)
      });

      return await handleResponse<T>(response);
    } catch (error) {
      console.error('API POST error:', error);
      return {
        success: false,
        error: 'Network error',
      };
    } finally {
      loading.value = false;
    }
  };

  const put = async <T = unknown>(
    endpoint: string,
    data: unknown,
    additionalHeaders?: Record<string, string>
  ): Promise<ApiResponse<T>> => {
    loading.value = true;
    try {
      const response = await fetch(`${baseUrl.value}${endpoint}`, {
        method: 'PUT',
        headers: getHeaders(additionalHeaders),
        body: JSON.stringify(data),
        credentials: 'include',
      });

      return await handleResponse<T>(response);
    } catch (error) {
      console.error('API PUT error:', error);
      return {
        success: false,
        error: 'Network error',
      };
    } finally {
      loading.value = false;
    }
  };

  const del = async <T = unknown>(
    endpoint: string,
    additionalHeaders?: Record<string, string>
  ): Promise<ApiResponse<T>> => {
    loading.value = true;
    try {
      const response = await fetch(`${baseUrl.value}${endpoint}`, {
        method: 'DELETE',
        headers: getHeaders(additionalHeaders),
        credentials: 'include',
      });

      return await handleResponse<T>(response);
    } catch (error) {
      console.error('API DELETE error:', error);
      return {
        success: false,
        error: 'Network error',
      };
    } finally {
      loading.value = false;
    }
  };

  return {
    authToken,
    baseUrl,
    loading,
    setAuthToken,
    clearAuthToken,
    get,
    post,
    put,
    del,
  };
});
