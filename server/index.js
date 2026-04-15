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
app.use('/api/photoday', require('./routes/photoday'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/shipstation', require('./routes/shipstation'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/print-sheets', require('./routes/printSheets'));

// ─── HEALTH CHECK ───────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    environment: config.env,
    timestamp: new Date().toISOString(),
    services: {
      photoday: !!(config.photoday.secret && config.photoday.labId),
      shipstation: !!config.shipstation.apiKey,
    },
    photoday: {
      baseUrl: config.photoday.baseUrl,
      labId: config.photoday.labId ? `${config.photoday.labId.substring(0, 8)}...` : 'not set',
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
║   🏀 Sportsline Photography Production Dashboard v2     ║
║      Powered by PhotoDay PDX API                         ║
║                                                          ║
║   Server running on port ${config.port}                         ║
║   Environment: ${config.env.padEnd(39)}║
║                                                          ║
║   API Endpoints:                                         ║
║   • /api/photoday    - PDX order retrieval & updates     ║
║   • /api/orders      - Order management & processing     ║
║   • /api/shipstation - ShipStation integration           ║
║   • /api/settings    - Template mappings & config        ║
║   • /api/print-sheets - Print sheet generation           ║
║   • /api/health      - Health check                      ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);

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
});

module.exports = app;
