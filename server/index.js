const express = require('express');
const cors = require('cors');
const config = require('./config');

const app = express();

// ─── MIDDLEWARE ──────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

if (config.env === 'development') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ─── API ROUTES ─────────────────────────────────────────────
// Auth routes (no authentication required)
app.use('/api/auth', require('./routes/auth'));

// Protected routes (use optionalAuth for now — will switch to requireAuth after users are set up)
const { optionalAuth } = require('./middleware/auth');
app.use('/api/photoday', optionalAuth, require('./routes/photoday'));
app.use('/api/orders', optionalAuth, require('./routes/orders'));
app.use('/api/shipstation', optionalAuth, require('./routes/shipstation'));
app.use('/api/settings', optionalAuth, require('./routes/settings'));
app.use('/api/print-sheets', optionalAuth, require('./routes/printSheets'));

// ─── HEALTH CHECK ───────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '3.0.0',
    environment: config.env,
    timestamp: new Date().toISOString(),
    database: 'sqlite',
    services: {
      photoday: !!(config.photoday.secret && config.photoday.labId),
      shipstation: !!config.shipstation.apiKey,
    },
  });
});

// ─── ERROR HANDLING ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    error: config.env === 'development' ? err.message : 'Internal server error',
    ...(config.env === 'development' && { stack: err.stack }),
  });
});

// ─── START SERVER ───────────────────────────────────────────
app.listen(config.port, async () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🏀 Sportsline Photography Production Dashboard v3     ║
║      Powered by PhotoDay PDX API + SQLite               ║
║                                                          ║
║   Server running on port ${config.port}                         ║
║   Environment: ${config.env.padEnd(39)}║
║                                                          ║
║   API Endpoints:                                         ║
║   • /api/auth        - Authentication & user management  ║
║   • /api/photoday    - PDX order retrieval & updates     ║
║   • /api/orders      - Order management & processing     ║
║   • /api/shipstation - ShipStation integration           ║
║   • /api/settings    - Template mappings & config        ║
║   • /api/print-sheets - Print sheet generation           ║
║   • /api/health      - Health check                      ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);

  // Initialize database (SQLite) — must be first
  try {
    const databaseService = require('./services/database');
    await databaseService.init();
  } catch (err) {
    console.error('[Database] Init FATAL:', err.message);
    process.exit(1);
  }

  // Initialize app settings (apply saved env overrides)
  try {
    const appSettings = require('./config/appSettings');
    await appSettings.init();
    console.log('[AppSettings] Initialized — saved overrides applied');
  } catch (err) {
    console.error('[AppSettings] Init error:', err.message);
  }

  // Initialize scheduler (auto-fetch + ShipStation polling)
  try {
    const schedulerService = require('./services/schedulerService');
    await schedulerService.init();
  } catch (err) {
    console.error('[Scheduler] Init error:', err.message);
  }

  // Cleanup expired sessions every hour
  setInterval(() => {
    try {
      const authService = require('./services/authService');
      authService.cleanupSessions();
    } catch (err) { /* silent */ }
  }, 60 * 60 * 1000);
});

module.exports = app;
