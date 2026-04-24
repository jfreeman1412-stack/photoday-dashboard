const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');
const bcrypt = require('bcrypt');

const DB_PATH = path.join(__dirname, '..', 'config', 'sportsline.db');
const OLD_JSON_PATH = path.join(__dirname, '..', 'config', 'orders-db.json');

class DatabaseService {
  constructor() {
    this.db = null;
  }

  /**
   * Initialize the database — create tables, run migrations, seed defaults.
   */
  async init() {
    this.db = new Database(DB_PATH);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Create tables
    this._createTables();

    // Seed default admin user if no users exist
    await this._seedDefaultUser();

    // Migrate from JSON if needed
    await this._migrateFromJson();

    console.log('[Database] SQLite initialized');
    return this;
  }

  _createTables() {
    this.db.exec(`
      -- ═══ USERS ══════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'operator' CHECK(role IN ('admin', 'operator', 'viewer')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_login_at TEXT
      );

      -- ═══ ORDERS ═════════════════════════════════════════
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_num TEXT UNIQUE NOT NULL,
        order_uuid TEXT,
        status TEXT NOT NULL DEFAULT 'unprocessed' CHECK(status IN ('unprocessed', 'partially_processed', 'processed', 'shipped')),
        gallery TEXT DEFAULT '',
        studio_name TEXT DEFAULT '',
        is_bulk INTEGER DEFAULT 0,
        placed_at TEXT,
        fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
        processed_at TEXT,
        shipped_at TEXT,
        carrier TEXT,
        tracking_number TEXT,
        shipstation_order_id TEXT,
        photoday_synced INTEGER DEFAULT 0,
        download_path TEXT,
        txt_file TEXT,
        packing_slip TEXT,
        order_data TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ═══ ORDER ITEMS ════════════════════════════════════
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_num TEXT NOT NULL,
        item_uuid TEXT,
        description TEXT DEFAULT '',
        external_id TEXT DEFAULT '',
        quantity INTEGER DEFAULT 1,
        image_count INTEGER DEFAULT 0,
        tags TEXT DEFAULT '[]',
        processed INTEGER DEFAULT 0,
        processed_at TEXT,
        processed_by INTEGER,
        FOREIGN KEY (order_num) REFERENCES orders(order_num) ON DELETE CASCADE,
        FOREIGN KEY (processed_by) REFERENCES users(id)
      );

      -- ═══ ORDER ITEM IMAGES ══════════════════════════════
      CREATE TABLE IF NOT EXISTS order_item_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_num TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        asset_url TEXT,
        external_id TEXT DEFAULT '',
        orientation TEXT DEFAULT '',
        downloaded INTEGER DEFAULT 0,
        download_path TEXT,
        FOREIGN KEY (order_num) REFERENCES orders(order_num) ON DELETE CASCADE,
        FOREIGN KEY (item_id) REFERENCES order_items(id) ON DELETE CASCADE
      );

      -- ═══ ACTIVITY LOG ═══════════════════════════════════
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT DEFAULT 'system',
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        details TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      -- ═══ SETTINGS ═══════════════════════════════════════
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_by INTEGER,
        FOREIGN KEY (updated_by) REFERENCES users(id)
      );

      -- ═══ SESSIONS ═══════════════════════════════════════
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      -- ═══ INDEXES ════════════════════════════════════════
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_gallery ON orders(gallery);
      CREATE INDEX IF NOT EXISTS idx_orders_placed_at ON orders(placed_at);
      CREATE INDEX IF NOT EXISTS idx_order_items_order_num ON order_items(order_num);
      CREATE INDEX IF NOT EXISTS idx_order_items_tags ON order_items(tags);
      CREATE INDEX IF NOT EXISTS idx_order_item_images_order_num ON order_item_images(order_num);
      CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    `);
  }

  async _seedDefaultUser() {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM users').get();
    if (count.count === 0) {
      const hash = await bcrypt.hash('admin', 10);
      this.db.prepare(`
        INSERT INTO users (username, password_hash, display_name, role)
        VALUES (?, ?, ?, ?)
      `).run('admin', hash, 'Administrator', 'admin');
      console.log('[Database] Default admin user created (username: admin, password: admin)');
    }
  }

  async _migrateFromJson() {
    if (!fs.existsSync(OLD_JSON_PATH)) return;

    // Check if we already migrated
    const orderCount = this.db.prepare('SELECT COUNT(*) as count FROM orders').get();
    if (orderCount.count > 0) {
      console.log('[Database] Orders already exist, skipping JSON migration');
      return;
    }

    console.log('[Database] Migrating from orders-db.json...');

    try {
      const jsonData = await fs.readJson(OLD_JSON_PATH);
      const orders = Object.values(jsonData.orders || {});

      if (orders.length === 0) {
        console.log('[Database] No orders to migrate');
        return;
      }

      const insertOrder = this.db.prepare(`
        INSERT OR IGNORE INTO orders (
          order_num, order_uuid, status, gallery, studio_name, is_bulk,
          placed_at, fetched_at, processed_at, shipped_at,
          carrier, tracking_number, shipstation_order_id, photoday_synced,
          download_path, txt_file, packing_slip, order_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertItem = this.db.prepare(`
        INSERT INTO order_items (order_num, item_uuid, description, external_id, quantity, image_count, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const insertImage = this.db.prepare(`
        INSERT INTO order_item_images (order_num, item_id, filename, asset_url, external_id, orientation)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const migrateAll = this.db.transaction(() => {
        for (const order of orders) {
          const orderData = order.orderData || {};

          insertOrder.run(
            order.orderNum,
            order.orderId || orderData.id || null,
            order.status || 'unprocessed',
            order.gallery || orderData.gallery || '',
            order.studioName || orderData.studio?.name || '',
            order.isBulk ? 1 : 0,
            order.placedAt || orderData.placedAt || null,
            order.fetchedAt || new Date().toISOString(),
            order.processedAt || null,
            order.shippedAt || null,
            order.carrier || null,
            order.trackingNumber || null,
            order.shipstationOrderId ? String(order.shipstationOrderId) : null,
            order.photodaySynced ? 1 : 0,
            order.downloadPath || null,
            order.txtFile || null,
            order.packingSlip || null,
            JSON.stringify(orderData)
          );

          // Migrate items
          for (const item of orderData.items || []) {
            const tags = item.photoTags || [];
            const result = insertItem.run(
              order.orderNum,
              item.id || null,
              item.description || '',
              item.externalId || '',
              item.quantity || 1,
              item.images?.length || 0,
              JSON.stringify(tags)
            );

            // Migrate images
            const itemId = result.lastInsertRowid;
            for (const image of item.images || []) {
              insertImage.run(
                order.orderNum,
                itemId,
                image.filename || '',
                image.assetUrl || '',
                image.externalId || '',
                image.orientation || ''
              );
            }
          }
        }
      });

      migrateAll();

      // Migrate auto-fetch settings
      if (jsonData.autoFetchEnabled !== undefined) {
        this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
          'autoFetchEnabled', JSON.stringify(jsonData.autoFetchEnabled)
        );
      }
      if (jsonData.autoFetchIntervalMinutes !== undefined) {
        this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
          'autoFetchIntervalMinutes', JSON.stringify(jsonData.autoFetchIntervalMinutes)
        );
      }
      if (jsonData.lastFetch) {
        this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
          'lastFetch', JSON.stringify(jsonData.lastFetch)
        );
      }

      console.log(`[Database] Migrated ${orders.length} orders from JSON`);

      // Rename old file as backup
      const backupPath = OLD_JSON_PATH.replace('.json', '.json.bak');
      await fs.rename(OLD_JSON_PATH, backupPath);
      console.log(`[Database] Backed up old JSON to ${backupPath}`);

    } catch (err) {
      console.error('[Database] Migration error:', err.message);
    }
  }

  // ─── HELPERS ──────────────────────────────────────────────

  /**
   * Log an activity.
   */
  logActivity(userId, username, action, entityType, entityId, details = {}) {
    this.db.prepare(`
      INSERT INTO activity_log (user_id, username, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId || null, username || 'system', action, entityType || null, entityId || null, JSON.stringify(details));
  }

  /**
   * Get the raw database connection for direct queries.
   */
  getDb() {
    return this.db;
  }

  /**
   * Close the database connection gracefully.
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = new DatabaseService();
