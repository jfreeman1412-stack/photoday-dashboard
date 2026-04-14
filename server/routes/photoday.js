const express = require('express');
const router = express.Router();
const photodayService = require('../services/photodayService');

// ─── GET UNPROCESSED ORDERS ─────────────────────────────────
// Returns up to 50 unprocessed orders (oldest first)
router.get('/orders', async (req, res) => {
  try {
    const orders = await photodayService.getOrders();
    res.json({
      count: orders.length,
      orders,
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// ─── GET ALL UNPROCESSED ORDERS ─────────────────────────────
// Fetches all orders across multiple batches
router.get('/orders/all', async (req, res) => {
  try {
    const autoProcess = req.query.autoProcess === 'true';
    const orders = await photodayService.getAllOrders({ autoProcess });
    res.json({
      count: orders.length,
      orders,
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// ─── MARK ORDER AS PROCESSED ────────────────────────────────
router.post('/orders/:orderNum/processed', async (req, res) => {
  try {
    const { orderNum } = req.params;
    const { externalId } = req.body;
    const result = await photodayService.markAsProcessed(orderNum, externalId || null);
    res.json({ success: true, orderNum, result });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// ─── MARK ORDER AS SHIPPED ──────────────────────────────────
router.post('/orders/:orderNum/shipped', async (req, res) => {
  try {
    const { orderNum } = req.params;
    const { carrier, trackingNumber } = req.body;

    if (!carrier || !trackingNumber) {
      return res.status(400).json({ error: 'carrier and trackingNumber are required' });
    }

    const validCarriers = ['UPS', 'UPSMI', 'FEDEX', 'USPS', 'DHL'];
    if (!validCarriers.includes(carrier.toUpperCase())) {
      return res.status(400).json({ error: `carrier must be one of: ${validCarriers.join(', ')}` });
    }

    const result = await photodayService.markAsShipped(orderNum, carrier.toUpperCase(), trackingNumber);
    res.json({ success: true, orderNum, carrier, trackingNumber, result });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// ─── BATCH MARK AS PROCESSED ────────────────────────────────
router.post('/orders/batch-processed', async (req, res) => {
  try {
    const { orderNums } = req.body;
    if (!orderNums || orderNums.length === 0) {
      return res.status(400).json({ error: 'orderNums array is required' });
    }

    const results = [];
    for (const num of orderNums) {
      try {
        await photodayService.markAsProcessed(num);
        results.push({ orderNum: num, success: true });
      } catch (err) {
        results.push({ orderNum: num, success: false, error: err.message });
      }
    }

    res.json({
      total: orderNums.length,
      successCount: results.filter(r => r.success).length,
      errorCount: results.filter(r => !r.success).length,
      results,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── BATCH MARK AS SHIPPED ──────────────────────────────────
router.post('/orders/batch-shipped', async (req, res) => {
  try {
    const { shipments } = req.body;
    // shipments: [{ orderNum, carrier, trackingNumber }, ...]
    if (!shipments || shipments.length === 0) {
      return res.status(400).json({ error: 'shipments array is required' });
    }

    const results = [];
    for (const s of shipments) {
      try {
        await photodayService.markAsShipped(s.orderNum, s.carrier, s.trackingNumber);
        results.push({ orderNum: s.orderNum, success: true });
      } catch (err) {
        results.push({ orderNum: s.orderNum, success: false, error: err.message });
      }
    }

    res.json({
      total: shipments.length,
      successCount: results.filter(r => r.success).length,
      errorCount: results.filter(r => !r.success).length,
      results,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
