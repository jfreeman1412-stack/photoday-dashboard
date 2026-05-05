const databaseService = require('./database');

/**
 * Order database — SQLite-backed replacement for orders-db.json.
 * Maintains the same API surface so all existing code works unchanged.
 */
class OrderDatabase {

  get db() {
    return databaseService.getDb();
  }

  // ─── ORDER CRUD ───────────────────────────────────────────

  /**
   * Save or update an order in the database.
   */
  async saveOrder(order, status = 'unprocessed') {
    const orderNum = order.num;
    const existing = this.db.prepare('SELECT order_num, status FROM orders WHERE order_num = ?').get(orderNum);

    if (existing) {
      // Don't downgrade status
      const statusOrder = { unprocessed: 0, partially_processed: 1, processed: 2, shipped: 3 };
      const keepStatus = (statusOrder[existing.status] || 0) >= (statusOrder[status] || 0) ? existing.status : status;

      // Update order data but keep higher status
      this.db.prepare(`
        UPDATE orders SET
          order_uuid = ?, status = ?, gallery = ?, studio_name = ?, is_bulk = ?,
          placed_at = ?, order_data = ?, updated_at = datetime('now')
        WHERE order_num = ?
      `).run(
        order.id || null,
        keepStatus,
        order.gallery || '',
        order.studio?.name || '',
        (order.groups || []).length > 1 ? 1 : 0,
        order.placedAt || null,
        JSON.stringify(order),
        orderNum
      );

      // Update items and images
      this._upsertItems(orderNum, order);

      return this.getOrder(orderNum);
    }

    // Insert new order
    this.db.prepare(`
      INSERT INTO orders (
        order_num, order_uuid, status, gallery, studio_name, is_bulk,
        placed_at, fetched_at, order_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `).run(
      orderNum,
      order.id || null,
      status,
      order.gallery || '',
      order.studio?.name || '',
      (order.groups || []).length > 1 ? 1 : 0,
      order.placedAt || null,
      JSON.stringify(order)
    );

    // Insert items and images
    this._upsertItems(orderNum, order);

    return this.getOrder(orderNum);
  }

  /**
   * Upsert order items and their images.
   */
  _upsertItems(orderNum, order) {
    // Delete existing items and images for this order (they'll be re-inserted)
    this.db.prepare('DELETE FROM order_item_images WHERE order_num = ?').run(orderNum);
    this.db.prepare('DELETE FROM order_items WHERE order_num = ?').run(orderNum);

    const insertItem = this.db.prepare(`
      INSERT INTO order_items (order_num, item_uuid, description, external_id, quantity, image_count, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertImage = this.db.prepare(`
      INSERT INTO order_item_images (order_num, item_id, filename, asset_url, external_id, orientation)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const item of order.items || []) {
      const tags = item.photoTags || [];
      const result = insertItem.run(
        orderNum,
        item.id || null,
        item.description || '',
        item.externalId || '',
        item.quantity || 1,
        item.images?.length || 0,
        JSON.stringify(tags)
      );

      const itemId = result.lastInsertRowid;
      for (const image of item.images || []) {
        insertImage.run(
          orderNum,
          itemId,
          image.filename || '',
          image.assetUrl || '',
          image.externalId || '',
          image.orientation || ''
        );
      }
    }
  }

  /**
   * Update order fields.
   */
  async updateOrder(orderNum, updates) {
    const existing = this.db.prepare('SELECT * FROM orders WHERE order_num = ?').get(orderNum);
    if (!existing) throw new Error(`Order ${orderNum} not found in database`);

    // Build dynamic UPDATE
    const fields = [];
    const values = [];

    const directFields = {
      status: 'status', gallery: 'gallery', studioName: 'studio_name',
      carrier: 'carrier', trackingNumber: 'tracking_number',
      shipstationOrderId: 'shipstation_order_id', downloadPath: 'download_path',
      txtFile: 'txt_file', packingSlip: 'packing_slip',
      processedAt: 'processed_at', shippedAt: 'shipped_at',
    };

    for (const [jsKey, dbKey] of Object.entries(directFields)) {
      if (updates[jsKey] !== undefined) {
        fields.push(`${dbKey} = ?`);
        values.push(updates[jsKey]);
      }
    }

    // Handle boolean fields
    if (updates.photodaySynced !== undefined) {
      fields.push('photoday_synced = ?');
      values.push(updates.photodaySynced ? 1 : 0);
    }

    // Handle orderData (full JSON)
    if (updates.orderData) {
      fields.push('order_data = ?');
      values.push(JSON.stringify(updates.orderData));

      // Also update items
      this._upsertItems(orderNum, updates.orderData);
    }

    // Handle items array update (without full orderData)
    if (updates.items && !updates.orderData) {
      // Update the stored order_data JSON with new items
      const currentData = JSON.parse(existing.order_data || '{}');
      currentData.items = updates.items;
      fields.push('order_data = ?');
      values.push(JSON.stringify(currentData));
    }

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      values.push(orderNum);
      this.db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE order_num = ?`).run(...values);
    }

    return this.getOrder(orderNum);
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
   * Mark a subset of items as processed within an order, and update the order's
   * status accordingly:
   *   - If all items are now processed → status = 'processed'
   *   - Otherwise → status = 'partially_processed'
   *
   * Returns { allItemsProcessed, processedCount, totalCount, newStatus }.
   *
   * @param {string} orderNum
   * @param {string[]} itemUuids - UUIDs of items to mark as processed (item.id from PDX)
   */
  async markItemsProcessed(orderNum, itemUuids = []) {
    const order = this.db.prepare('SELECT * FROM orders WHERE order_num = ?').get(orderNum);
    if (!order) throw new Error(`Order ${orderNum} not found`);

    if (itemUuids.length > 0) {
      const placeholders = itemUuids.map(() => '?').join(',');
      this.db.prepare(`
        UPDATE order_items
        SET processed = 1, processed_at = datetime('now')
        WHERE order_num = ? AND item_uuid IN (${placeholders})
      `).run(orderNum, ...itemUuids);
    }

    // Determine new status from current item state
    const counts = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN processed = 1 THEN 1 ELSE 0 END) as processed_count
      FROM order_items
      WHERE order_num = ?
    `).get(orderNum);

    const total = counts.total || 0;
    const processedCount = counts.processed_count || 0;
    const allItemsProcessed = total > 0 && processedCount >= total;
    const newStatus = allItemsProcessed ? 'processed' : (processedCount > 0 ? 'partially_processed' : order.status);

    if (newStatus !== order.status) {
      const updates = { status: newStatus };
      if (newStatus === 'processed') updates.processedAt = new Date().toISOString();
      await this.updateOrder(orderNum, updates);
    }

    return {
      allItemsProcessed,
      processedCount,
      totalCount: total,
      newStatus,
    };
  }

  /**
   * Get the items of an order, optionally filtered by team tag.
   * Returns array of item objects (id = item_uuid, plus tags, processed, etc.)
   */
  async getOrderItems(orderNum, { team = null, unprocessedOnly = false } = {}) {
    const items = this.db.prepare('SELECT * FROM order_items WHERE order_num = ?').all(orderNum);
    return items
      .map(item => ({
        id: item.item_uuid,
        description: item.description,
        externalId: item.external_id,
        quantity: item.quantity,
        imageCount: item.image_count,
        tags: JSON.parse(item.tags || '[]'),
        processed: !!item.processed,
        processedAt: item.processed_at,
      }))
      .filter(item => {
        if (unprocessedOnly && item.processed) return false;
        if (team && !(item.tags || []).includes(team)) return false;
        return true;
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
   * Convert a raw database row to the order object format the frontend expects.
   */
  _rowToOrder(row) {
    if (!row) return null;

    const orderData = JSON.parse(row.order_data || '{}');

    // Get items from the items table
    const items = this.db.prepare('SELECT * FROM order_items WHERE order_num = ?').all(row.order_num);

    return {
      orderNum: row.order_num,
      orderId: row.order_uuid,
      status: row.status,
      gallery: row.gallery,
      studioName: row.studio_name,
      isBulk: !!row.is_bulk,
      placedAt: row.placed_at,
      fetchedAt: row.fetched_at,
      processedAt: row.processed_at,
      shippedAt: row.shipped_at,
      carrier: row.carrier,
      trackingNumber: row.tracking_number,
      shipstationOrderId: row.shipstation_order_id,
      photodaySynced: !!row.photoday_synced,
      downloadPath: row.download_path,
      txtFile: row.txt_file,
      packingSlip: row.packing_slip,
      itemCount: items.length,
      items: items.map(item => ({
        id: item.item_uuid,
        description: item.description,
        externalId: item.external_id,
        quantity: item.quantity,
        imageCount: item.image_count,
        tags: JSON.parse(item.tags || '[]'),
        processed: !!item.processed,
        processedAt: item.processed_at,
      })),
      // Include full order data for processing
      orderData,
      shipping: orderData.shipping || null,
      customerName: this._getCustomerName(orderData),
      updatedAt: row.updated_at,
    };
  }

  /**
   * Extract customer name from order data.
   */
  _getCustomerName(orderData) {
    if (orderData.shipping?.destination?.recipient) {
      return orderData.shipping.destination.recipient;
    }
    if (orderData.groups?.length > 0) {
      const fields = orderData.groups[0].fields || [];
      const first = fields.find(f => f.key === 'first_name')?.value || '';
      const last = fields.find(f => f.key === 'last_name')?.value || '';
      return `${first} ${last}`.trim();
    }
    return '';
  }

  // ─── SEARCH ───────────────────────────────────────────────

  /**
   * Search orders by order number or customer name across all statuses.
   */
  async searchOrders(query) {
    if (!query || query.trim().length < 2) return [];

    const searchTerm = `%${query.trim()}%`;

    // Search by order number or by recipient name in the JSON order data
    const rows = this.db.prepare(`
      SELECT * FROM orders
      WHERE order_num LIKE ?
         OR order_data LIKE ?
      ORDER BY placed_at DESC
      LIMIT 50
    `).all(searchTerm, `%"recipient":"${query.trim()}%`);

    // Also try a broader search on the JSON for first/last name
    const nameRows = this.db.prepare(`
      SELECT * FROM orders
      WHERE order_data LIKE ?
      ORDER BY placed_at DESC
      LIMIT 50
    `).all(`%${query.trim()}%`);

    // Merge and deduplicate
    const seen = new Set(rows.map(r => r.order_num));
    for (const r of nameRows) {
      if (!seen.has(r.order_num)) {
        // Filter: only include if the query matches the recipient name
        const data = JSON.parse(r.order_data || '{}');
        const recipient = (data.shipping?.destination?.recipient || '').toLowerCase();
        if (recipient.includes(query.trim().toLowerCase())) {
          rows.push(r);
          seen.add(r.order_num);
        }
      }
    }

    return rows.map(r => this._rowToOrder(r));
  }

  /**
   * Get all orders, optionally filtered by status.
   */
  async getOrders(status = null) {
    let rows;
    if (status) {
      rows = this.db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY placed_at DESC').all(status);
    } else {
      rows = this.db.prepare('SELECT * FROM orders ORDER BY placed_at DESC').all();
    }
    return rows.map(r => this._rowToOrder(r));
  }

  async getUnprocessedOrders() { return this.getOrders('unprocessed'); }
  async getProcessedOrders() { return this.getOrders('processed'); }
  async getShippedOrders() { return this.getOrders('shipped'); }

  async getOrder(orderNum) {
    const row = this.db.prepare('SELECT * FROM orders WHERE order_num = ?').get(orderNum);
    return this._rowToOrder(row);
  }

  /**
   * Get order counts by status.
   */
  async getCounts() {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM orders GROUP BY status
    `).all();

    const counts = { total: 0, unprocessed: 0, partially_processed: 0, processed: 0, shipped: 0 };
    for (const row of rows) {
      counts[row.status] = row.count;
      counts.total += row.count;
    }
    return counts;
  }

  /**
   * Check if an order exists.
   */
  async hasOrder(orderNum) {
    const row = this.db.prepare('SELECT 1 FROM orders WHERE order_num = ?').get(orderNum);
    return !!row;
  }

  // ─── TEAM QUERIES ─────────────────────────────────────────

  /**
   * Get all unique teams (tags) across all orders, optionally filtered by gallery.
   */
  async getTeams(gallery = null) {
    let rows;
    if (gallery) {
      rows = this.db.prepare(`
        SELECT DISTINCT oi.tags FROM order_items oi
        JOIN orders o ON o.order_num = oi.order_num
        WHERE o.gallery = ? AND oi.tags != '[]'
      `).all(gallery);
    } else {
      rows = this.db.prepare("SELECT DISTINCT tags FROM order_items WHERE tags != '[]'").all();
    }

    const teams = new Set();
    for (const row of rows) {
      const tags = JSON.parse(row.tags || '[]');
      tags.forEach(t => teams.add(t));
    }
    return [...teams].sort();
  }

  /**
   * Get orders filtered by team tag.
   */
  async getOrdersByTeam(team, status = null) {
    let query = `
      SELECT DISTINCT o.* FROM orders o
      JOIN order_items oi ON o.order_num = oi.order_num
      WHERE oi.tags LIKE ?
    `;
    const params = [`%"${team}"%`];

    if (status) {
      query += ' AND o.status = ?';
      params.push(status);
    }

    query += ' ORDER BY o.placed_at DESC';

    const rows = this.db.prepare(query).all(...params);
    return rows.map(r => this._rowToOrder(r));
  }

  // ─── AUTO-FETCH SETTINGS ─────────────────────────────────

  async getAutoFetchSettings() {
    const getVal = (key, defaultVal) => {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row ? JSON.parse(row.value) : defaultVal;
    };

    return {
      enabled: getVal('autoFetchEnabled', false),
      intervalMinutes: getVal('autoFetchIntervalMinutes', 30),
      lastFetch: getVal('lastFetch', null),
    };
  }

  async updateAutoFetchSettings(settings) {
    const upsert = this.db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))');

    if (settings.enabled !== undefined) upsert.run('autoFetchEnabled', JSON.stringify(settings.enabled));
    if (settings.intervalMinutes !== undefined) upsert.run('autoFetchIntervalMinutes', JSON.stringify(settings.intervalMinutes));

    return this.getAutoFetchSettings();
  }

  async updateLastFetch() {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('lastFetch', ?, datetime('now'))").run(
      JSON.stringify(new Date().toISOString())
    );
  }

  // ─── CLEANUP ──────────────────────────────────────────────

  async removeOrder(orderNum) {
    this.db.prepare('DELETE FROM orders WHERE order_num = ?').run(orderNum);
  }

  async clearByStatus(status) {
    this.db.prepare('DELETE FROM orders WHERE status = ?').run(status);
  }
}

module.exports = new OrderDatabase();
