const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

const DB_PATH = path.join(__dirname, '..', 'config', 'orders-db.json');

class OrderDatabase {
  constructor() {
    this._ensureDb();
  }

  _ensureDb() {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeJsonSync(DB_PATH, {
        orders: {},
        lastFetch: null,
        autoFetchEnabled: false,
        autoFetchIntervalMinutes: 30,
      }, { spaces: 2 });
    }
  }

  async _read() {
    return fs.readJson(DB_PATH);
  }

  async _write(data) {
    await fs.writeJson(DB_PATH, data, { spaces: 2 });
  }

  // ─── ORDER CRUD ───────────────────────────────────────────

  /**
   * Save or update an order in the local database.
   * Status: 'unprocessed' | 'processed' | 'shipped'
   */
  async saveOrder(order, status = 'unprocessed') {
    const db = await this._read();
    const orderNum = order.num;

    // Don't overwrite if it already exists at a later status
    if (db.orders[orderNum]) {
      const existingStatus = db.orders[orderNum].status;
      const statusOrder = { unprocessed: 0, processed: 1, shipped: 2 };
      if (statusOrder[existingStatus] >= statusOrder[status]) {
        // Update order data but keep the higher status
        db.orders[orderNum] = {
          ...db.orders[orderNum],
          orderData: order,
          updatedAt: new Date().toISOString(),
        };
        await this._write(db);
        return db.orders[orderNum];
      }
    }

    db.orders[orderNum] = {
      orderNum,
      orderId: order.id,
      status,
      orderData: order,
      gallery: order.gallery || '',
      studioName: order.studio?.name || '',
      placedAt: order.placedAt,
      itemCount: order.items?.length || 0,
      items: (order.items || []).map(item => ({
        description: item.description,
        externalId: item.externalId,
        quantity: item.quantity,
        imageCount: item.images?.length || 0,
      })),
      isBulk: (order.groups || []).length > 1,
      shipping: order.shipping || null,
      // Tracking
      fetchedAt: new Date().toISOString(),
      processedAt: status === 'processed' ? new Date().toISOString() : null,
      shippedAt: status === 'shipped' ? new Date().toISOString() : null,
      carrier: null,
      trackingNumber: null,
      shipstationOrderId: null,
      txtFile: null,
      downloadPath: null,
      updatedAt: new Date().toISOString(),
    };

    await this._write(db);
    return db.orders[orderNum];
  }

  /**
   * Update order status and metadata.
   */
  async updateOrder(orderNum, updates) {
    const db = await this._read();
    if (!db.orders[orderNum]) {
      throw new Error(`Order ${orderNum} not found in database`);
    }
    db.orders[orderNum] = {
      ...db.orders[orderNum],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await this._write(db);
    return db.orders[orderNum];
  }

  /**
   * Mark order as processed.
   */
  async markProcessed(orderNum, metadata = {}) {
    return this.updateOrder(orderNum, {
      status: 'processed',
      processedAt: new Date().toISOString(),
      ...metadata,
    });
  }

  /**
   * Mark order as shipped.
   */
  async markShipped(orderNum, carrier, trackingNumber, metadata = {}) {
    return this.updateOrder(orderNum, {
      status: 'shipped',
      shippedAt: new Date().toISOString(),
      carrier,
      trackingNumber,
      ...metadata,
    });
  }

  // ─── QUERIES ──────────────────────────────────────────────

  /**
   * Get all orders, optionally filtered by status.
   */
  async getOrders(status = null) {
    const db = await this._read();
    let orders = Object.values(db.orders);

    if (status) {
      orders = orders.filter(o => o.status === status);
    }

    // Sort by placedAt descending (newest first)
    orders.sort((a, b) => new Date(b.placedAt || 0) - new Date(a.placedAt || 0));
    return orders;
  }

  async getUnprocessedOrders() {
    return this.getOrders('unprocessed');
  }

  async getProcessedOrders() {
    return this.getOrders('processed');
  }

  async getShippedOrders() {
    return this.getOrders('shipped');
  }

  async getOrder(orderNum) {
    const db = await this._read();
    return db.orders[orderNum] || null;
  }

  /**
   * Get order counts by status.
   */
  async getCounts() {
    const db = await this._read();
    const orders = Object.values(db.orders);
    return {
      total: orders.length,
      unprocessed: orders.filter(o => o.status === 'unprocessed').length,
      processed: orders.filter(o => o.status === 'processed').length,
      shipped: orders.filter(o => o.status === 'shipped').length,
    };
  }

  /**
   * Check if an order exists in the database.
   */
  async hasOrder(orderNum) {
    const db = await this._read();
    return !!db.orders[orderNum];
  }

  // ─── AUTO-FETCH SETTINGS ─────────────────────────────────

  async getAutoFetchSettings() {
    const db = await this._read();
    return {
      enabled: db.autoFetchEnabled || false,
      intervalMinutes: db.autoFetchIntervalMinutes || 30,
      lastFetch: db.lastFetch,
    };
  }

  async updateAutoFetchSettings(settings) {
    const db = await this._read();
    if (settings.enabled !== undefined) db.autoFetchEnabled = settings.enabled;
    if (settings.intervalMinutes !== undefined) db.autoFetchIntervalMinutes = settings.intervalMinutes;
    await this._write(db);
    return this.getAutoFetchSettings();
  }

  async updateLastFetch() {
    const db = await this._read();
    db.lastFetch = new Date().toISOString();
    await this._write(db);
  }

  // ─── CLEANUP ──────────────────────────────────────────────

  /**
   * Remove an order from the database.
   */
  async removeOrder(orderNum) {
    const db = await this._read();
    delete db.orders[orderNum];
    await this._write(db);
  }

  /**
   * Clear all orders with a given status.
   */
  async clearByStatus(status) {
    const db = await this._read();
    for (const key of Object.keys(db.orders)) {
      if (db.orders[key].status === status) {
        delete db.orders[key];
      }
    }
    await this._write(db);
  }
}

module.exports = new OrderDatabase();
