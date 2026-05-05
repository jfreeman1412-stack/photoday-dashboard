const API_BASE = process.env.REACT_APP_API_URL || `http://${window.location.hostname}:3001/api`;

class ApiService {
  constructor() {
    this.sessionId = localStorage.getItem('sessionId') || null;
    this.onAuthError = null; // Callback for 401 errors
  }

  setSession(sessionId) {
    this.sessionId = sessionId;
    if (sessionId) {
      localStorage.setItem('sessionId', sessionId);
    } else {
      localStorage.removeItem('sessionId');
    }
  }

  getSession() {
    return this.sessionId;
  }

  async _fetch(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...options.headers };

    // Add session header if we have one
    if (this.sessionId) {
      headers['X-Session-Id'] = this.sessionId;
    }

    const response = await fetch(url, { headers, ...options });

    if (response.status === 401) {
      // Session expired or invalid
      const error = await response.json().catch(() => ({}));
      if (error.code === 'INVALID_SESSION' || error.code === 'NO_SESSION') {
        this.setSession(null);
        if (this.onAuthError) this.onAuthError();
      }
      throw new Error(error.error || 'Authentication required');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `API Error: ${response.status}`);
    }
    if (response.headers.get('content-type')?.includes('image/')) return response.blob();
    return response.json();
  }

  // ─── AUTH ─────────────────────────────────────────────────
  async login(username, password) {
    const result = await this._fetch('/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
    });
    this.setSession(result.sessionId);
    return result;
  }

  async logout() {
    try { await this._fetch('/auth/logout', { method: 'POST' }); } catch (e) { /* silent */ }
    this.setSession(null);
  }

  async validateSession() {
    if (!this.sessionId) return null;
    try {
      const result = await this._fetch('/auth/session');
      return result.user;
    } catch (e) {
      this.setSession(null);
      return null;
    }
  }

  // User management
  getUsers() { return this._fetch('/auth/users'); }
  createUser(data) { return this._fetch('/auth/users', { method: 'POST', body: JSON.stringify(data) }); }
  updateUser(id, data) { return this._fetch(`/auth/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }); }
  deleteUser(id) { return this._fetch(`/auth/users/${id}`, { method: 'DELETE' }); }

  // Update own profile (any authenticated user)
  updateProfile(data) { return this._fetch('/auth/profile', { method: 'PUT', body: JSON.stringify(data) }); }

  // Activity log
  getActivityLog(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this._fetch(`/auth/activity${qs ? '?' + qs : ''}`);
  }

  // ─── ORDER MANAGEMENT ───────────────────────────────────
  getOrderCounts() { return this._fetch('/orders/counts'); }
  getDashboardAnalytics() { return this._fetch('/orders/dashboard'); }
  getUnprocessedOrders() { return this._fetch('/orders/unprocessed'); }
  getProcessedOrders() { return this._fetch('/orders/processed'); }
  getShippedOrders() { return this._fetch('/orders/shipped'); }
  getAllOrders() { return this._fetch('/orders/all'); }
  getOrder(orderNum) { return this._fetch(`/orders/${orderNum}`); }
  getTeams(gallery = null) {
    const qs = gallery ? `?gallery=${encodeURIComponent(gallery)}` : '';
    return this._fetch(`/orders/meta/teams${qs}`);
  }
  getGallerySettings() { return this._fetch('/orders/meta/gallery-settings'); }
  updateGallerySettings(gallery, settings) {
    return this._fetch('/orders/meta/gallery-settings', {
      method: 'PUT', body: JSON.stringify({ gallery, settings }),
    });
  }

  // Fetch new from PhotoDay
  fetchNewOrders() { return this._fetch('/orders/fetch', { method: 'POST' }); }

  // Auto-fetch settings
  getAutoFetchSettings() { return this._fetch('/orders/settings/auto-fetch'); }
  updateAutoFetch(enabled, intervalMinutes) {
    return this._fetch('/orders/settings/auto-fetch', {
      method: 'PUT', body: JSON.stringify({ enabled, intervalMinutes }),
    });
  }

  // Process orders
  processOrderByNum(orderNum, options = {}) {
    return this._fetch(`/orders/process/${orderNum}`, { method: 'POST', body: JSON.stringify(options) });
  }
  reprocessOrder(orderNum) {
    return this._fetch(`/orders/reprocess/${orderNum}`, { method: 'POST', body: '{}' });
  }
  reprintItem(orderNum, itemId) {
    return this._fetch(`/orders/${orderNum}/reprint-item`, {
      method: 'POST', body: JSON.stringify({ itemId }),
    });
  }

  // Bulk-order dancer endpoints
  getBulkDancers(orderNum) {
    return this._fetch(`/orders/${orderNum}/dancers`);
  }
  reprintBulkDancer(orderNum, dancerKey) {
    return this._fetch(`/orders/${orderNum}/dancers/${encodeURIComponent(dancerKey)}/reprint`, {
      method: 'POST', body: '{}',
    });
  }
  reprintBulkDancerItem(orderNum, dancerKey, itemId) {
    return this._fetch(`/orders/${orderNum}/dancers/${encodeURIComponent(dancerKey)}/reprint-item`, {
      method: 'POST', body: JSON.stringify({ itemId }),
    });
  }
  updateOrderData(orderNum, orderData) {
    return this._fetch(`/orders/${orderNum}/update-data`, { method: 'PUT', body: JSON.stringify(orderData) });
  }
  processAllOrders(options = {}) {
    return this._fetch('/orders/process-all', { method: 'POST', body: JSON.stringify(options) });
  }
  processOrderByTeam(orderNum, team) {
    return this._fetch(`/orders/process-team/${orderNum}`, {
      method: 'POST', body: JSON.stringify({ team }),
    });
  }

  // Ship orders
  shipOrderByNum(orderNum, carrier, trackingNumber) {
    return this._fetch(`/orders/${orderNum}/ship`, {
      method: 'POST', body: JSON.stringify({ carrier, trackingNumber }),
    });
  }
  batchShipOrders(carrier, trackingNumber, gallery = null) {
    return this._fetch('/orders/batch-ship', {
      method: 'POST', body: JSON.stringify({ carrier, trackingNumber, gallery }),
    });
  }
  syncShippedToPhotoDay(gallery = null) {
    return this._fetch('/orders/sync-shipped', {
      method: 'POST', body: JSON.stringify({ gallery }),
    });
  }

  // Check ShipStation for shipped orders
  checkShipments() { return this._fetch('/orders/check-shipments', { method: 'POST' }); }

  // QR sheets
  generateQRSheet(data) {
    return this._fetch('/orders/qr-sheet', { method: 'POST', body: JSON.stringify(data) });
  }

  // ─── PHOTODAY PDX (direct) ──────────────────────────────
  pdxGetOrders() { return this._fetch('/photoday/orders'); }
  pdxMarkProcessed(orderNum) {
    return this._fetch(`/photoday/orders/${orderNum}/processed`, { method: 'POST', body: '{}' });
  }
  pdxMarkShipped(orderNum, carrier, trackingNumber) {
    return this._fetch(`/photoday/orders/${orderNum}/shipped`, {
      method: 'POST', body: JSON.stringify({ carrier, trackingNumber }),
    });
  }

  // ─── SHIPSTATION ────────────────────────────────────────
  createOrdersFromPDX(overrides = {}) {
    return this._fetch('/shipstation/orders/from-pdx', { method: 'POST', body: JSON.stringify(overrides) });
  }
  getShipstationOrders(params) {
    return this._fetch(`/shipstation/orders?${new URLSearchParams(params)}`);
  }
  deleteShipstationOrder(orderId) {
    return this._fetch(`/shipstation/orders/${orderId}`, { method: 'DELETE' });
  }
  deleteShipstationBatchOrders(orderIds) {
    return this._fetch('/shipstation/orders/batch-delete', { method: 'POST', body: JSON.stringify({ orderIds }) });
  }
  shipSSOrder(ssOrderId, data) {
    return this._fetch(`/shipstation/orders/${ssOrderId}/ship`, { method: 'POST', body: JSON.stringify(data) });
  }
  getCarriers() { return this._fetch('/shipstation/carriers'); }

  // ─── SETTINGS ───────────────────────────────────────────
  // Path settings
  getPathSettings() { return this._fetch('/settings/paths'); }
  updatePathSettings(paths) {
    return this._fetch('/settings/paths', { method: 'PUT', body: JSON.stringify(paths) });
  }

  // App settings (env overrides)
  getAppSettings() { return this._fetch('/settings/app-settings'); }
  updateAppSettings(settings) {
    return this._fetch('/settings/app-settings', { method: 'PUT', body: JSON.stringify(settings) });
  }

  getTemplateMappings() { return this._fetch('/settings/template-mappings'); }
  addTemplateMapping(mapping) {
    return this._fetch('/settings/template-mappings', { method: 'POST', body: JSON.stringify(mapping) });
  }
  updateTemplateMapping(id, updates) {
    return this._fetch(`/settings/template-mappings/${id}`, { method: 'PUT', body: JSON.stringify(updates) });
  }
  deleteTemplateMapping(id) {
    return this._fetch(`/settings/template-mappings/${id}`, { method: 'DELETE' });
  }

  // Size Mappings (externalId → print size)
  getSizeMappings() { return this._fetch('/settings/size-mappings'); }
  addSizeMapping(mapping) {
    return this._fetch('/settings/size-mappings', { method: 'POST', body: JSON.stringify(mapping) });
  }
  deleteSizeMapping(externalId) {
    return this._fetch(`/settings/size-mappings/${externalId}`, { method: 'DELETE' });
  }

  // Specialty Products
  getSpecialtyConfig() { return this._fetch('/settings/specialty'); }
  setSpecialtyBasePath(basePath) {
    return this._fetch('/settings/specialty/base-path', { method: 'PUT', body: JSON.stringify({ basePath }) });
  }
  addSpecialtyProduct(product) {
    return this._fetch('/settings/specialty/products', { method: 'POST', body: JSON.stringify(product) });
  }
  updateSpecialtyProduct(externalId, updates) {
    return this._fetch(`/settings/specialty/products/${externalId}`, { method: 'PUT', body: JSON.stringify(updates) });
  }
  deleteSpecialtyProduct(externalId) {
    return this._fetch(`/settings/specialty/products/${externalId}`, { method: 'DELETE' });
  }
  setHighlightColors(colors) {
    return this._fetch('/settings/specialty/highlight-colors', { method: 'PUT', body: JSON.stringify(colors) });
  }

  getFileNameConfig() { return this._fetch('/settings/filename-config'); }
  updateFileNameConfig(config) {
    return this._fetch('/settings/filename-config', { method: 'PUT', body: JSON.stringify(config) });
  }
  getAppConfig() { return this._fetch('/settings/app-config'); }
  getPrintLayouts() { return this._fetch('/settings/print-layouts'); }

  // Folder Sort
  getFolderSortOptions() { return this._fetch('/settings/folder-sort/options'); }
  getFolderSort() { return this._fetch('/settings/folder-sort'); }
  updateFolderSort(sortLevels) {
    return this._fetch('/settings/folder-sort', { method: 'PUT', body: JSON.stringify({ sortLevels }) });
  }

  // Imposition Layouts
  getImpositionLayouts() { return this._fetch('/settings/imposition/layouts'); }
  getImpositionTextVariables() { return this._fetch('/settings/imposition/text-variables'); }
  addImpositionLayout(layout) {
    return this._fetch('/settings/imposition/layouts', { method: 'POST', body: JSON.stringify(layout) });
  }
  updateImpositionLayout(id, updates) {
    return this._fetch(`/settings/imposition/layouts/${id}`, { method: 'PUT', body: JSON.stringify(updates) });
  }
  deleteImpositionLayout(id) {
    return this._fetch(`/settings/imposition/layouts/${id}`, { method: 'DELETE' });
  }

  // Imposition Mappings (externalId → layout, optionally per orientation)
  getImpositionMappings() { return this._fetch('/settings/imposition/mappings'); }
  addImpositionMapping(externalId, layoutId, orientation = null) {
    return this._fetch('/settings/imposition/mappings', {
      method: 'POST',
      body: JSON.stringify({ externalId, layoutId, orientation }),
    });
  }
  // updates: { layoutId?, orientation? } — orientation may be '' to mean "any".
  // oldOrientation identifies which row to update (null/'' for an existing "any" mapping).
  updateImpositionMapping(externalId, oldOrientation, updates) {
    const qs = oldOrientation ? `?orientation=${encodeURIComponent(oldOrientation)}` : '';
    return this._fetch(`/settings/imposition/mappings/${externalId}${qs}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }
  deleteImpositionMapping(externalId, orientation = null) {
    const qs = orientation ? `?orientation=${encodeURIComponent(orientation)}` : '';
    return this._fetch(`/settings/imposition/mappings/${externalId}${qs}`, { method: 'DELETE' });
  }

  // ─── PRINT SHEETS ──────────────────────────────────────
  generatePrintSheet(data) {
    return this._fetch('/print-sheets/generate', { method: 'POST', body: JSON.stringify(data) });
  }

  // ─── HEALTH ─────────────────────────────────────────────
  healthCheck() { return this._fetch('/health'); }
}

const api = new ApiService();
export default api;
