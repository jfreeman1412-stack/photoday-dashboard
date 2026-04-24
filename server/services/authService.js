const databaseService = require('./database');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const SESSION_DURATION_HOURS = 24;

class AuthService {
  get db() {
    return databaseService.getDb();
  }

  // ─── AUTHENTICATION ─────────────────────────────────────

  /**
   * Authenticate a user and create a session.
   */
  async login(username, password) {
    const user = this.db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
    if (!user) throw new Error('Invalid username or password');

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new Error('Invalid username or password');

    // Create session
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();

    this.db.prepare(`
      INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)
    `).run(sessionId, user.id, expiresAt);

    // Update last login
    this.db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);

    // Log activity
    databaseService.logActivity(user.id, user.username, 'login', 'user', String(user.id));

    return {
      sessionId,
      user: this._sanitizeUser(user),
      expiresAt,
    };
  }

  /**
   * Validate a session and return the user.
   */
  async validateSession(sessionId) {
    if (!sessionId) return null;

    const session = this.db.prepare(`
      SELECT s.*, u.* FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > datetime('now') AND u.active = 1
    `).get(sessionId);

    if (!session) return null;

    return this._sanitizeUser(session);
  }

  /**
   * Logout — delete session.
   */
  async logout(sessionId) {
    const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (session) {
      databaseService.logActivity(session.user_id, null, 'logout', 'user', String(session.user_id));
    }
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  /**
   * Cleanup expired sessions.
   */
  cleanupSessions() {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  }

  // ─── USER MANAGEMENT ───────────────────────────────────

  /**
   * Create a new user.
   */
  async createUser(username, password, displayName, role = 'operator') {
    const existing = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) throw new Error(`Username "${username}" already exists`);

    if (!['admin', 'operator', 'viewer'].includes(role)) {
      throw new Error('Invalid role. Must be admin, operator, or viewer');
    }

    const hash = await bcrypt.hash(password, 10);
    const result = this.db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role)
      VALUES (?, ?, ?, ?)
    `).run(username, hash, displayName || username, role);

    databaseService.logActivity(null, 'system', 'create_user', 'user', String(result.lastInsertRowid), { username, role });

    return this.getUser(result.lastInsertRowid);
  }

  /**
   * Update user details.
   */
  async updateUser(userId, updates) {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');

    const fields = [];
    const values = [];

    if (updates.displayName !== undefined) { fields.push('display_name = ?'); values.push(updates.displayName); }
    if (updates.role !== undefined) {
      if (!['admin', 'operator', 'viewer'].includes(updates.role)) throw new Error('Invalid role');
      fields.push('role = ?'); values.push(updates.role);
    }
    if (updates.active !== undefined) { fields.push('active = ?'); values.push(updates.active ? 1 : 0); }
    if (updates.password) {
      const hash = await bcrypt.hash(updates.password, 10);
      fields.push('password_hash = ?'); values.push(hash);
    }

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      values.push(userId);
      this.db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    databaseService.logActivity(null, 'system', 'update_user', 'user', String(userId), { fields: Object.keys(updates) });

    return this.getUser(userId);
  }

  /**
   * Delete a user (deactivate).
   */
  async deactivateUser(userId) {
    return this.updateUser(userId, { active: false });
  }

  /**
   * Get a user by ID.
   */
  getUser(userId) {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return user ? this._sanitizeUser(user) : null;
  }

  /**
   * Get all users.
   */
  getAllUsers() {
    const users = this.db.prepare('SELECT * FROM users ORDER BY created_at').all();
    return users.map(u => this._sanitizeUser(u));
  }

  /**
   * Remove password hash from user object.
   */
  _sanitizeUser(user) {
    return {
      id: user.id || user.user_id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      active: !!user.active,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      lastLoginAt: user.last_login_at,
    };
  }
}

module.exports = new AuthService();
