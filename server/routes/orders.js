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
