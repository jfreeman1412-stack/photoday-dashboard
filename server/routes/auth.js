const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const databaseService = require('../services/database');

// ─── LOGIN ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const result = await authService.login(username, password);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// ─── LOGOUT ───────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) await authService.logout(sessionId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── VALIDATE SESSION ─────────────────────────────────────────
router.get('/session', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    const user = await authService.validateSession(sessionId);
    if (!user) return res.status(401).json({ error: 'Invalid or expired session' });
    res.json({ user });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// ─── UPDATE OWN PROFILE ───────────────────────────────────────
// Lets any authenticated user update their own profile fields.
// Currently allows: downloadPath, displayName, password.
// Role / active flag changes still require admin via /users/:id.
router.put('/profile', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    const me = await authService.validateSession(sessionId);
    if (!me) return res.status(401).json({ error: 'Invalid or expired session' });

    const { downloadPath, displayName, password } = req.body;
    const allowedUpdates = {};
    if (downloadPath !== undefined) allowedUpdates.downloadPath = downloadPath;
    if (displayName !== undefined) allowedUpdates.displayName = displayName;
    if (password) allowedUpdates.password = password;

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    const updated = await authService.updateUser(me.id, allowedUpdates);
    res.json({ success: true, user: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── USER MANAGEMENT (admin only) ─────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const users = authService.getAllUsers();
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { username, password, displayName, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const user = await authService.createUser(username, password, displayName, role);
    res.json({ success: true, user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const user = await authService.updateUser(parseInt(req.params.id), req.body);
    res.json({ success: true, user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    await authService.deactivateUser(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── ACTIVITY LOG ─────────────────────────────────────────────
router.get('/activity', async (req, res) => {
  try {
    const { limit = 50, offset = 0, entity_type, entity_id } = req.query;
    const db = databaseService.getDb();

    let query = 'SELECT * FROM activity_log';
    const params = [];
    const conditions = [];

    if (entity_type) { conditions.push('entity_type = ?'); params.push(entity_type); }
    if (entity_id) { conditions.push('entity_id = ?'); params.push(entity_id); }

    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const logs = db.prepare(query).all(...params);
    const total = db.prepare('SELECT COUNT(*) as count FROM activity_log').get().count;

    res.json({
      logs: logs.map(l => ({ ...l, details: JSON.parse(l.details || '{}') })),
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
