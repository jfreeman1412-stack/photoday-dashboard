const express = require('express');
const router = express.Router();
const orderDatabase = require('../services/orderDatabase');
const schedulerService = require('../services/schedulerService');
const qrcodeService = require('../services/qrcodeService');
const fileService = require('../services/fileService');

// ─── ORDER COUNTS / DASHBOARD ───────────────────────────────
router.get('/counts', async (req, res) => {
  try {
    const counts = await orderDatabase.getCounts();
    const fetchSettings = await orderDatabase.getAutoFetchSettings();
    res.json({ ...counts, autoFetch: fetchSettings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── DASHBOARD ANALYTICS ────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const allOrders = await orderDatabase.getOrders();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Order counts by status
    const unprocessed = allOrders.filter(o => o.status === 'unprocessed');
    const processed = allOrders.filter(o => o.status === 'processed');
    const shipped = allOrders.filter(o => o.status === 'shipped');

    // Orders processed in time ranges
    const processedToday = allOrders.filter(o => o.processedAt && new Date(o.processedAt) >= todayStart).length;
    const processedThisWeek = allOrders.filter(o => o.processedAt && new Date(o.processedAt) >= weekStart).length;
    const processedThisMonth = allOrders.filter(o => o.processedAt && new Date(o.processedAt) >= monthStart).length;

    // Average processing time (fetchedAt → processedAt)
    const processTimes = allOrders
      .filter(o => o.fetchedAt && o.processedAt)
      .map(o => new Date(o.processedAt) - new Date(o.fetchedAt));
    const avgProcessTimeMs = processTimes.length > 0
      ? processTimes.reduce((a, b) => a + b, 0) / processTimes.length
      : 0;

    // Items by product type
    const productCounts = {};
    let totalImages = 0;
    let totalImagesThisWeek = 0;
    let specialtyPending = 0;

    const specialtyService = require('../services/specialtyService');
    const specialtyProducts = await specialtyService.getProducts();
    const specialtyIds = new Set(specialtyProducts.map(p => p.externalId));

    for (const order of allOrders) {
      for (const item of order.items || []) {
        const key = item.description || `SKU: ${item.externalId}`;
        const qty = item.quantity || 1;
        const imgCount = item.imageCount || 0;
        productCounts[key] = (productCounts[key] || 0) + qty;
        totalImages += imgCount * qty;

        if (order.processedAt && new Date(order.processedAt) >= weekStart) {
          totalImagesThisWeek += imgCount * qty;
        }

        if (order.status === 'unprocessed' && specialtyIds.has(String(item.externalId))) {
          specialtyPending += qty;
        }
      }
    }

    // Sort product counts descending
    const productBreakdown = Object.entries(productCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Gallery overview
    const galleryMap = {};
    for (const order of allOrders) {
      const g = order.gallery || 'No Gallery';
      if (!galleryMap[g]) galleryMap[g] = { total: 0, unprocessed: 0, processed: 0, shipped: 0 };
      galleryMap[g].total++;
      galleryMap[g][order.status]++;
    }
    const galleries = Object.entries(galleryMap)
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.unprocessed - a.unprocessed || b.total - a.total);

    // Order volume by day (last 14 days)
    const volumeByDay = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(todayStart);
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().split('T')[0];
      const dayEnd = new Date(d); dayEnd.setDate(dayEnd.getDate() + 1);
      const fetched = allOrders.filter(o => o.fetchedAt && new Date(o.fetchedAt) >= d && new Date(o.fetchedAt) < dayEnd).length;
      const processedDay = allOrders.filter(o => o.processedAt && new Date(o.processedAt) >= d && new Date(o.processedAt) < dayEnd).length;
      const shippedDay = allOrders.filter(o => o.shippedAt && new Date(o.shippedAt) >= d && new Date(o.shippedAt) < dayEnd).length;
      volumeByDay.push({ date: dayStr, label: `${d.getMonth() + 1}/${d.getDate()}`, fetched, processed: processedDay, shipped: shippedDay });
    }

    // Recent orders (last 10 processed/shipped)
    const recentOrders = allOrders
      .filter(o => o.processedAt)
      .sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt))
      .slice(0, 10)
      .map(o => ({
        orderNum: o.orderNum,
        orderId: o.orderId,
        gallery: o.gallery,
        status: o.status,
        isBulk: o.isBulk,
        processedAt: o.processedAt,
        shippedAt: o.shippedAt,
        itemCount: o.items?.length || 0,
      }));

    res.json({
      counts: { unprocessed: unprocessed.length, processed: processed.length, shipped: shipped.length, total: allOrders.length },
      throughput: { today: processedToday, thisWeek: processedThisWeek, thisMonth: processedThisMonth },
      avgProcessTimeMs,
      totalImages,
      totalImagesThisWeek,
      specialtyPending,
      productBreakdown,
      galleries,
      volumeByDay,
      recentOrders,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── LIST ORDERS BY STATUS ──────────────────────────────────
router.get('/unprocessed', async (req, res) => {
  try {
    const orders = await orderDatabase.getUnprocessedOrders();
    res.json({ count: orders.length, orders });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/processed', async (req, res) => {
  try {
    const orders = await orderDatabase.getProcessedOrders();
    res.json({ count: orders.length, orders });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/shipped', async (req, res) => {
  try {
    const orders = await orderDatabase.getShippedOrders();
    res.json({ count: orders.length, orders });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/all', async (req, res) => {
  try {
    const orders = await orderDatabase.getOrders();
    res.json({ count: orders.length, orders });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── TEAMS ──────────────────────────────────────────────────
router.get('/meta/teams', async (req, res) => {
  try {
    const { gallery } = req.query;
    const teams = await orderDatabase.getTeams(gallery || null);
    res.json({ teams });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GALLERY SETTINGS (per-gallery config) ──────────────────
router.get('/meta/gallery-settings', async (req, res) => {
  try {
    const databaseService = require('../services/database');
    const db = databaseService.getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'gallerySettings'").get();
    const settings = row ? JSON.parse(row.value) : {};

    // Also return legacy teamEnabledGalleries for backward compat
    const legacyRow = db.prepare("SELECT value FROM settings WHERE key = 'teamEnabledGalleries'").get();
    const legacyTeamEnabled = legacyRow ? JSON.parse(legacyRow.value) : [];

    // Merge legacy into new format if needed
    for (const gallery of legacyTeamEnabled) {
      if (!settings[gallery]) {
        settings[gallery] = { teamEnabled: true, autoProcess: false, folderSort: null };
      }
    }

    res.json({ gallerySettings: settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/meta/gallery-settings', async (req, res) => {
  try {
    const { gallery, settings } = req.body;
    if (!gallery) return res.status(400).json({ error: 'Gallery name required' });

    const databaseService = require('../services/database');
    const db = databaseService.getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'gallerySettings'").get();
    const allSettings = row ? JSON.parse(row.value) : {};

    // Update this gallery's settings
    allSettings[gallery] = {
      ...(allSettings[gallery] || {}),
      ...settings,
    };

    // Remove gallery entry if all settings are default/off
    const gs = allSettings[gallery];
    if (!gs.teamEnabled && !gs.autoProcess && (!gs.folderSort || gs.folderSort.length === 0)) {
      delete allSettings[gallery];
    }

    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('gallerySettings', ?, datetime('now'))").run(JSON.stringify(allSettings));

    // Also update legacy teamEnabledGalleries for backward compat
    const teamEnabled = Object.entries(allSettings)
      .filter(([_, s]) => s.teamEnabled)
      .map(([name]) => name);
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('teamEnabledGalleries', ?, datetime('now'))").run(JSON.stringify(teamEnabled));

    console.log(`[GallerySettings] Updated settings for "${gallery}":`, JSON.stringify(settings));
    res.json({ success: true, gallerySettings: allSettings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── SINGLE ORDER ───────────────────────────────────────────
router.get('/:orderNum', async (req, res) => {
  try {
    const order = await orderDatabase.getOrder(req.params.orderNum);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── FETCH NEW ORDERS FROM PHOTODAY ─────────────────────────
// Manual fetch — pulls new orders and saves to local DB
router.post('/fetch', async (req, res) => {
  try {
    const result = await schedulerService.fetchNewOrders();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── UPDATE ORDER DATA (refresh asset URLs) ──────────────────
router.put('/:orderNum/update-data', async (req, res) => {
  try {
    const { orderNum } = req.params;
    const orderData = req.body;

    if (!orderData || !orderData.items) {
      return res.status(400).json({ error: 'Valid order JSON with items required' });
    }

    // Update the stored order data with fresh URLs
    await orderDatabase.updateOrder(orderNum, {
      orderData,
      items: (orderData.items || []).map(item => ({
        description: item.description,
        externalId: item.externalId,
        quantity: item.quantity,
        imageCount: item.images?.length || 0,
      })),
    });

    console.log(`[Orders] Updated order data for ${orderNum} with fresh asset URLs`);

    // Try to download images with the fresh URLs
    try {
      const downloadResult = await fileService.downloadOrderImages(orderData, { forceRedownload: true });
      console.log(`[Orders] Downloaded ${downloadResult.successCount} images for ${orderNum}`);
      await orderDatabase.updateOrder(orderNum, { downloadPath: downloadResult.orderDir });
      res.json({ success: true, orderNum, downloads: downloadResult.successCount, errors: downloadResult.errorCount });
    } catch (dlError) {
      res.json({ success: true, orderNum, message: 'Order data updated but image download failed: ' + dlError.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── AUTO-FETCH SETTINGS ────────────────────────────────────
router.get('/settings/auto-fetch', async (req, res) => {
  try {
    const settings = await orderDatabase.getAutoFetchSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/settings/auto-fetch', async (req, res) => {
  try {
    const { enabled, intervalMinutes } = req.body;
    await schedulerService.updateAutoFetch(enabled, intervalMinutes);
    const settings = await orderDatabase.getAutoFetchSettings();
    res.json({ success: true, ...settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── PROCESS ORDERS ─────────────────────────────────────────
// Process a single order (download images, generate txt, mark processed)
router.post('/process/:orderNum', async (req, res) => {
  try {
    const result = await schedulerService.processOrder(req.params.orderNum, req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reprocess an order (re-download images, re-generate txt, etc.)
router.post('/reprocess/:orderNum', async (req, res) => {
  try {
    const result = await schedulerService.processOrder(req.params.orderNum, {
      ...req.body,
      reprocess: true,
      forceRedownload: true,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Process all unprocessed orders
router.post('/process-all', async (req, res) => {
  try {
    const result = await schedulerService.processAllUnprocessed(req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── MARK SHIPPED MANUALLY ─────────────────────────────────
router.post('/:orderNum/ship', async (req, res) => {
  try {
    const { orderNum } = req.params;
    const { carrier, trackingNumber } = req.body;

    const shipCarrier = (carrier || 'USPS').toUpperCase();
    const shipTracking = trackingNumber || '';

    const photodayService = require('../services/photodayService');

    // Always send callback to PhotoDay
    let pdCallback = null;
    try {
      await photodayService.markAsShipped(orderNum, shipCarrier, shipTracking);
      pdCallback = 'sent';
    } catch (pdErr) {
      // Handle gracefully — order may already be shipped in PhotoDay
      console.warn(`[Ship] PhotoDay callback for ${orderNum}: ${pdErr.message}`);
      pdCallback = 'failed (may already be shipped)';
    }

    // Update local DB
    await orderDatabase.markShipped(orderNum, shipCarrier, shipTracking || 'No tracking', {
      photodaySynced: true,
    });

    res.json({ success: true, orderNum, carrier: shipCarrier, trackingNumber: shipTracking, photodayCallback: pdCallback });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── BATCH MARK SHIPPED ─────────────────────────────────────
// Mark multiple processed orders as shipped, optionally filtered by gallery
router.post('/batch-ship', async (req, res) => {
  try {
    const { carrier, trackingNumber, gallery } = req.body;

    const shipCarrier = (carrier || 'USPS').toUpperCase();
    const shipTracking = trackingNumber || '';

    const photodayService = require('../services/photodayService');
    let processedOrders = await orderDatabase.getProcessedOrders();

    // Filter by gallery if specified
    if (gallery) {
      processedOrders = processedOrders.filter(o => o.gallery === gallery);
    }

    if (processedOrders.length === 0) {
      return res.json({ success: true, message: 'No orders to ship', results: [] });
    }

    const results = [];
    for (const order of processedOrders) {
      try {
        // Always send callback to PhotoDay
        try {
          await photodayService.markAsShipped(order.orderNum, shipCarrier, shipTracking);
        } catch (pdErr) {
          console.warn(`[BatchShip] PhotoDay callback for ${order.orderNum}: ${pdErr.message}`);
        }
        await orderDatabase.markShipped(order.orderNum, shipCarrier, shipTracking || 'No tracking', {
          photodaySynced: true,
        });
        results.push({ orderNum: order.orderNum, success: true });
      } catch (err) {
        results.push({ orderNum: order.orderNum, success: false, error: err.message });
      }
    }

    res.json({
      success: true,
      total: processedOrders.length,
      gallery: gallery || null,
      successCount: results.filter(r => r.success).length,
      errorCount: results.filter(r => !r.success).length,
      results,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── SYNC SHIPPED ORDERS TO PHOTODAY ────────────────────────
// Resend shipped callbacks for orders that may not have been synced
router.post('/sync-shipped', async (req, res) => {
  try {
    const { gallery } = req.body;
    const photodayService = require('../services/photodayService');
    let shippedOrders = await orderDatabase.getShippedOrders();

    // Filter by gallery if specified
    if (gallery) {
      shippedOrders = shippedOrders.filter(o => o.gallery === gallery);
    }

    // Only sync orders that haven't been synced yet
    const unsynced = shippedOrders.filter(o => !o.photodaySynced);

    if (unsynced.length === 0) {
      return res.json({ success: true, message: 'All shipped orders already synced to PhotoDay', total: 0 });
    }

    const results = [];
    for (const order of unsynced) {
      try {
        const carrier = order.carrier || 'USPS';
        const tracking = order.trackingNumber || '';
        await photodayService.markAsShipped(order.orderNum, carrier, tracking);
        await orderDatabase.updateOrder(order.orderNum, { photodaySynced: true });
        results.push({ orderNum: order.orderNum, success: true });
      } catch (err) {
        // If PhotoDay says already shipped, that's fine — mark as synced
        console.warn(`[Sync] PhotoDay callback for ${order.orderNum}: ${err.message}`);
        await orderDatabase.updateOrder(order.orderNum, { photodaySynced: true });
        results.push({ orderNum: order.orderNum, success: true, note: 'May already be shipped in PhotoDay' });
      }
    }

    res.json({
      success: true,
      total: unsynced.length,
      gallery: gallery || null,
      successCount: results.filter(r => r.success).length,
      results,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── CHECK SHIPSTATION FOR SHIPPED ORDERS ───────────────────
// Manual trigger for the ShipStation polling
router.post('/check-shipments', async (req, res) => {
  try {
    await schedulerService.checkShipStationForShippedOrders();
    const counts = await orderDatabase.getCounts();
    res.json({ success: true, message: 'ShipStation check complete', counts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── QR CODE SHEETS ─────────────────────────────────────────
router.post('/qr-sheet', async (req, res) => {
  try {
    const { status, items, outputDir } = req.body;

    let qrItems = items;
    if (!qrItems || qrItems.length === 0) {
      // Generate from orders with the given status
      const orders = await orderDatabase.getOrders(status || 'unprocessed');
      qrItems = orders.map(o => ({ data: o.orderNum, label: o.orderNum }));
    }

    if (qrItems.length === 0) {
      return res.json({ success: true, message: 'No orders for QR generation', totalSheets: 0 });
    }

    const result = await qrcodeService.saveQRSheets(qrItems, outputDir);
    res.json({ success: true, orderCount: qrItems.length, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── FOLDER STRUCTURE ───────────────────────────────────────
router.get('/folders/list', async (req, res) => {
  try {
    const structure = await fileService.getFolderStructure(req.query.path);
    res.json(structure);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
