const express = require('express');
const router = express.Router();
const shipstationService = require('../services/shipstationService');
const photodayService = require('../services/photodayService');

// ─── CREATE ORDERS FROM PDX ─────────────────────────────────
// Fetches unprocessed PDX orders and creates them in ShipStation
router.post('/orders/from-pdx', async (req, res) => {
  try {
    const overrides = req.body; // { carrierCode, serviceCode, weight, dimensions }
    const orders = await photodayService.getOrders();

    if (orders.length === 0) {
      return res.json({ success: true, message: 'No orders to create', results: [] });
    }

    const results = [];
    for (const pdxOrder of orders) {
      try {
        const payload = shipstationService.buildOrderFromPDX(pdxOrder, overrides);
        const result = await shipstationService.createOrder(payload);
        results.push({
          orderNum: pdxOrder.num,
          success: true,
          shipstationOrderId: result.orderId,
        });
      } catch (err) {
        results.push({ orderNum: pdxOrder.num, success: false, error: err.message });
      }
    }

    res.json({
      totalOrders: orders.length,
      successCount: results.filter(r => r.success).length,
      errorCount: results.filter(r => !r.success).length,
      results,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── CREATE SINGLE ORDER ────────────────────────────────────
// Create a ShipStation order from manually provided PDX order data
router.post('/orders', async (req, res) => {
  try {
    const { pdxOrder, overrides } = req.body;
    if (!pdxOrder) {
      return res.status(400).json({ error: 'pdxOrder object is required' });
    }
    const payload = shipstationService.buildOrderFromPDX(pdxOrder, overrides || {});
    const result = await shipstationService.createOrder(payload);
    res.json({ success: true, order: result });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// ─── LIST SHIPSTATION ORDERS ────────────────────────────────
router.get('/orders', async (req, res) => {
  try {
    const orders = await shipstationService.listOrders(req.query);
    res.json(orders);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// ─── DELETE ORDER ───────────────────────────────────────────
router.delete('/orders/:orderId', async (req, res) => {
  try {
    const result = await shipstationService.deleteOrder(req.params.orderId);
    res.json({ success: true, result });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// ─── BATCH DELETE ───────────────────────────────────────────
router.post('/orders/batch-delete', async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!orderIds || orderIds.length === 0) {
      return res.status(400).json({ error: 'orderIds array required' });
    }
    const results = await shipstationService.deleteOrders(orderIds);
    res.json({
      total: orderIds.length,
      successCount: results.filter(r => r.success).length,
      errorCount: results.filter(r => !r.success).length,
      results,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── MARK AS SHIPPED (ShipStation + PhotoDay) ───────────────
// Marks shipped in ShipStation AND sends callback to PhotoDay
router.post('/orders/:ssOrderId/ship', async (req, res) => {
  try {
    const { carrierCode, trackingNumber, shipDate, orderNum } = req.body;

    if (!trackingNumber) {
      return res.status(400).json({ error: 'trackingNumber is required' });
    }

    const carrier = carrierCode || 'usps';

    // 1. Mark as shipped in ShipStation
    const ssResult = await shipstationService.markAsShipped({
      orderId: parseInt(req.params.ssOrderId, 10),
      carrierCode: carrier.toLowerCase(),
      trackingNumber,
      shipDate: shipDate || new Date().toISOString(),
      notifyCustomer: false, // PhotoDay handles customer notification
    });

    // 2. Send shipped callback to PhotoDay (if orderNum provided)
    let pdResult = null;
    if (orderNum) {
      try {
        // Map carrier codes: ShipStation uses lowercase, PhotoDay uses uppercase
        const pdCarrier = carrier.toUpperCase();
        pdResult = await photodayService.markAsShipped(orderNum, pdCarrier, trackingNumber);
      } catch (pdError) {
        console.error(`[Ship] PhotoDay callback failed for ${orderNum}:`, pdError.message);
        pdResult = { error: pdError.message };
      }
    }

    res.json({
      success: true,
      shipstation: ssResult,
      photoday: pdResult,
      message: orderNum
        ? 'Marked as shipped in both ShipStation and PhotoDay'
        : 'Marked as shipped in ShipStation (no PhotoDay callback — orderNum not provided)',
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// ─── CARRIERS ───────────────────────────────────────────────
router.get('/carriers', async (req, res) => {
  try {
    const carriers = await shipstationService.listCarriers();
    res.json(carriers);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

router.get('/carriers/:carrierCode/services', async (req, res) => {
  try {
    const services = await shipstationService.listServices(req.params.carrierCode);
    res.json(services);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

module.exports = router;
