/**
 * Shared Authentication Module for Office Monitor
 * Provides consistent auth handling across all pages
 */

(function(window) {
  'use strict';

  const AUTH_TOKEN_KEY = 'authToken';
  const AUTH_USER_KEY = 'authUser';

  // Track token rotation to prevent duplicate WebSocket reconnects
  let tokenRotationPending = false;
  let lastTokenRotationTime = 0;
  const TOKEN_ROTATION_DEBOUNCE = 2000;

  // Callbacks for token rotation (e.g., WebSocket reconnect)
  const tokenRotationCallbacks = [];

  /**
   * Get the current auth token from localStorage
   */
  function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  /**
   * Set the auth token in localStorage
   */
  function setAuthToken(token) {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  }

  /**
   * Get the current user from localStorage
   */
  function getAuthUser() {
    const userStr = localStorage.getItem(AUTH_USER_KEY);
    try {
      return userStr ? JSON.parse(userStr) : null;
    } catch {
      return null;
    }
  }

  /**
   * Set the current user in localStorage
   */
  function setAuthUser(user) {
    if (user) {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(AUTH_USER_KEY);
    }
  }

  /**
   * Clear all auth data (logout)
   */
  function clearAuth() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  }

  /**
   * Check if user is authenticated
   */
  function isAuthenticated() {
    return !!getAuthToken();
  }

  /**
   * Register a callback for token rotation events
   * Useful for reconnecting WebSockets after token refresh
   */
  function onTokenRotation(callback) {
    if (typeof callback === 'function') {
      tokenRotationCallbacks.push(callback);
    }
  }

  /**
   * Authenticated fetch wrapper with automatic token rotation handling
   * @param {string} url - The URL to fetch
   * @param {object} options - Fetch options
   * @returns {Promise<Response>} - The fetch response
   */
  async function authFetch(url, options = {}) {
    const headers = { ...options.headers };
    const currentToken = getAuthToken();

    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const response = await fetch(url, { ...options, headers });

    // Only check for token rotation on successful responses
    if (response.ok) {
      const newToken = response.headers.get('X-New-Token');
      if (newToken && newToken !== currentToken) {
        console.log('[Auth] Token rotated');
        setAuthToken(newToken);

        // Debounce token rotation callbacks
        const now = Date.now();
        if (!tokenRotationPending && (now - lastTokenRotationTime) > TOKEN_ROTATION_DEBOUNCE) {
          tokenRotationPending = true;
          lastTokenRotationTime = now;

          setTimeout(() => {
            tokenRotationPending = false;
            tokenRotationCallbacks.forEach(cb => {
              try {
                cb(newToken);
              } catch (e) {
                console.error('[Auth] Token rotation callback error:', e);
              }
            });
          }, 100);
        }
      }
    }

    return response;
  }

  /**
   * Redirect to login page if not authenticated
   * @param {string} returnUrl - Optional URL to return to after login
   */
  function requireAuth(returnUrl) {
    if (!isAuthenticated()) {
      const redirect = returnUrl || window.location.pathname;
      window.location.href = `/login.html?redirect=${encodeURIComponent(redirect)}`;
      return false;
    }
    return true;
  }

  /**
   * Logout and redirect to login page
   * @param {string} apiUrl - The API base URL
   */
  async function logout(apiUrl = '') {
    try {
      await authFetch(`${apiUrl}/api/auth/logout`, { method: 'POST' });
    } catch (e) {
      console.error('[Auth] Logout error:', e);
    }
    clearAuth();
    window.location.href = '/login.html';
  }

  // Expose the auth module
  window.Auth = {
    getToken: getAuthToken,
    setToken: setAuthToken,
    getUser: getAuthUser,
    setUser: setAuthUser,
    clearAuth,
    isAuthenticated,
    onTokenRotation,
    authFetch,
    requireAuth,
    logout
  };

})(window);
