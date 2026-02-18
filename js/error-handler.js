/**
 * Shared Error Handler for Office Monitor
 * Provides consistent error display and handling across all pages
 */

(function(window) {
  'use strict';

  // Error types and their user-friendly messages
  const ERROR_MESSAGES = {
    'NetworkError': 'Unable to connect to the server. Please check your internet connection.',
    'TypeError': 'Something went wrong. Please refresh the page and try again.',
    'SyntaxError': 'Received invalid data from the server. Please try again.',
    'AbortError': 'The request was cancelled. Please try again.',
    'TimeoutError': 'The request timed out. The server may be busy.',
    'AuthError': 'Your session has expired. Please log in again.',
    'PermissionError': 'You don\'t have permission to perform this action.',
    'NotFoundError': 'The requested resource was not found.',
    'ValidationError': 'Please check your input and try again.',
    'ServerError': 'The server encountered an error. Please try again later.',
    'default': 'An unexpected error occurred. Please try again.'
  };

  // Toast container
  let toastContainer = null;

  /**
   * Initialize the error handler (creates toast container)
   */
  function init() {
    if (toastContainer) return;

    toastContainer = document.createElement('div');
    toastContainer.id = 'error-toast-container';
    toastContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 400px;
    `;
    document.body.appendChild(toastContainer);

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .error-toast {
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: flex-start;
        gap: 12px;
        animation: slideIn 0.3s ease-out;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.4;
      }
      .error-toast.error {
        background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
        border: 1px solid #dc2626;
        color: #fecaca;
      }
      .error-toast.warning {
        background: linear-gradient(135deg, #78350f 0%, #92400e 100%);
        border: 1px solid #f59e0b;
        color: #fef3c7;
      }
      .error-toast.success {
        background: linear-gradient(135deg, #14532d 0%, #166534 100%);
        border: 1px solid #22c55e;
        color: #bbf7d0;
      }
      .error-toast.info {
        background: linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%);
        border: 1px solid #3b82f6;
        color: #bfdbfe;
      }
      .error-toast-icon {
        font-size: 18px;
        flex-shrink: 0;
      }
      .error-toast-content {
        flex: 1;
      }
      .error-toast-title {
        font-weight: 600;
        margin-bottom: 4px;
      }
      .error-toast-message {
        opacity: 0.9;
      }
      .error-toast-close {
        background: none;
        border: none;
        color: inherit;
        cursor: pointer;
        padding: 0;
        font-size: 18px;
        opacity: 0.7;
        transition: opacity 0.2s;
      }
      .error-toast-close:hover {
        opacity: 1;
      }
      .error-toast-action {
        margin-top: 8px;
      }
      .error-toast-action button {
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        color: inherit;
        padding: 4px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: background 0.2s;
      }
      .error-toast-action button:hover {
        background: rgba(255,255,255,0.3);
      }
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Get user-friendly message for an error
   */
  function getFriendlyMessage(error) {
    if (typeof error === 'string') return error;

    // Check for specific error types
    if (error.name && ERROR_MESSAGES[error.name]) {
      return ERROR_MESSAGES[error.name];
    }

    // Check for HTTP status codes
    if (error.status) {
      if (error.status === 401 || error.status === 403) {
        return ERROR_MESSAGES.AuthError;
      }
      if (error.status === 404) {
        return ERROR_MESSAGES.NotFoundError;
      }
      if (error.status === 400 || error.status === 422) {
        return error.message || ERROR_MESSAGES.ValidationError;
      }
      if (error.status >= 500) {
        return ERROR_MESSAGES.ServerError;
      }
    }

    // Check for network errors
    if (error.message) {
      if (error.message.includes('fetch') || error.message.includes('network')) {
        return ERROR_MESSAGES.NetworkError;
      }
      // Return the error message if it looks user-friendly
      if (error.message.length < 100 && !error.message.includes('at ')) {
        return error.message;
      }
    }

    return ERROR_MESSAGES.default;
  }

  /**
   * Show an error toast notification
   * @param {string|Error} error - The error to display
   * @param {object} options - Display options
   */
  function showError(error, options = {}) {
    init();

    const {
      title = 'Error',
      type = 'error',
      duration = 5000,
      action = null,
      actionText = 'Retry'
    } = options;

    const message = getFriendlyMessage(error);
    const icons = {
      error: '❌',
      warning: '⚠️',
      success: '✓',
      info: 'ℹ️'
    };

    const toast = document.createElement('div');
    toast.className = `error-toast ${type}`;
    toast.innerHTML = `
      <span class="error-toast-icon">${icons[type] || icons.error}</span>
      <div class="error-toast-content">
        <div class="error-toast-title">${title}</div>
        <div class="error-toast-message">${message}</div>
        ${action ? `
          <div class="error-toast-action">
            <button class="error-toast-retry">${actionText}</button>
          </div>
        ` : ''}
      </div>
      <button class="error-toast-close">×</button>
    `;

    // Close button handler
    toast.querySelector('.error-toast-close').onclick = () => removeToast(toast);

    // Action button handler
    if (action) {
      toast.querySelector('.error-toast-retry').onclick = () => {
        removeToast(toast);
        action();
      };
    }

    toastContainer.appendChild(toast);

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => removeToast(toast), duration);
    }

    // Log to console for debugging
    console.error('[ErrorHandler]', error);

    return toast;
  }

  /**
   * Remove a toast with animation
   */
  function removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.style.animation = 'slideOut 0.3s ease-out forwards';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  /**
   * Show a success toast
   */
  function showSuccess(message, options = {}) {
    return showError(message, { ...options, type: 'success', title: options.title || 'Success' });
  }

  /**
   * Show a warning toast
   */
  function showWarning(message, options = {}) {
    return showError(message, { ...options, type: 'warning', title: options.title || 'Warning' });
  }

  /**
   * Show an info toast
   */
  function showInfo(message, options = {}) {
    return showError(message, { ...options, type: 'info', title: options.title || 'Info' });
  }

  /**
   * Wrap an async function with error handling
   * @param {Function} fn - The async function to wrap
   * @param {object} options - Error display options
   */
  function withErrorHandling(fn, options = {}) {
    return async function(...args) {
      try {
        return await fn.apply(this, args);
      } catch (error) {
        showError(error, options);
        throw error; // Re-throw for caller to handle if needed
      }
    };
  }

  /**
   * Handle API response errors
   * @param {Response} response - Fetch response object
   * @param {string} context - Context for error message (e.g., "loading devices")
   */
  async function handleApiError(response, context = '') {
    if (response.ok) return;

    let errorMessage = '';
    try {
      const data = await response.json();
      errorMessage = data.error || data.message || '';
    } catch {
      errorMessage = response.statusText;
    }

    const error = new Error(errorMessage || `Failed${context ? ' ' + context : ''}`);
    error.status = response.status;

    // Handle auth errors specially
    if (response.status === 401) {
      showError(error, { title: 'Session Expired' });
      setTimeout(() => {
        if (window.Auth) {
          window.Auth.clearAuth();
        }
        window.location.href = '/login.html';
      }, 2000);
      throw error;
    }

    showError(error, { title: context ? `Error ${context}` : 'Error' });
    throw error;
  }

  // Expose the error handler module
  window.ErrorHandler = {
    init,
    showError,
    showSuccess,
    showWarning,
    showInfo,
    withErrorHandling,
    handleApiError,
    getFriendlyMessage
  };

})(window);
