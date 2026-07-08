const serviceConfig = require('../config/service');

const API_BASE_OVERRIDE_KEY = 'hailin-api-base-url';

function safeWxCall(methodName, fallback) {
  try {
    if (typeof wx === 'undefined' || !wx || typeof wx[methodName] !== 'function') {
      return fallback;
    }
    return wx[methodName]();
  } catch (error) {
    return fallback;
  }
}

function isDevtools() {
  const info = safeWxCall('getSystemInfoSync', {});
  return info && info.platform === 'devtools';
}

function storageApiBaseUrl() {
  try {
    if (typeof wx === 'undefined' || !wx || typeof wx.getStorageSync !== 'function') {
      return '';
    }
    return String(wx.getStorageSync(API_BASE_OVERRIDE_KEY) || '').trim();
  } catch (error) {
    return '';
  }
}

function resolveApiBaseUrl() {
  const overrideUrl = storageApiBaseUrl();
  if (overrideUrl) return overrideUrl;
  if (isDevtools() && serviceConfig.devApiBaseUrl) return serviceConfig.devApiBaseUrl;
  return serviceConfig.apiBaseUrl || '';
}

function hasBackend() {
  return Boolean(resolveApiBaseUrl().trim());
}

function joinUrl(baseUrl, endpoint) {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${cleanBase}${cleanEndpoint}`;
}

function normalizePayload(response) {
  if (!response) return null;
  if (response.data && response.data.data) return response.data.data;
  if (response.data) return response.data;
  return response;
}

function request(endpoint, options = {}) {
  if (!hasBackend()) {
    return Promise.reject(new Error('Backend is not configured'));
  }

  const method = options.method || 'GET';
  const data = options.data || {};
  const url = joinUrl(resolveApiBaseUrl(), endpoint);

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      timeout: serviceConfig.requestTimeout,
      header: {
        'content-type': 'application/json'
      },
      success(result) {
        if (result.statusCode >= 200 && result.statusCode < 300) {
          resolve(normalizePayload(result));
          return;
        }
        reject(new Error(`Request failed with status ${result.statusCode}`));
      },
      fail(error) {
        reject(error);
      }
    });
  });
}

function serviceModeText() {
  const baseUrl = resolveApiBaseUrl();
  if (!baseUrl) return '本地内容兜底';
  return baseUrl === serviceConfig.devApiBaseUrl ? '本地后端已连接' : '真实服务已连接';
}

module.exports = {
  hasBackend,
  resolveApiBaseUrl,
  request,
  serviceModeText,
  serviceConfig
};
