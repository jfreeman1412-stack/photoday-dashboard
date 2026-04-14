const photodayService = require('./photodayService');
const shipstationService = require('./shipstationService');
const orderDatabase = require('./orderDatabase');
const fileService = require('./fileService');
const darkroomService = require('./darkroomService');
const impositionService = require('./impositionService');
const packingSlipService = require('./packingSlipService');

class SchedulerService {
  constructor() {
    this.fetchTimer = null;
    this.shipstationTimer = null;
    this.isFetching = false;
    this.isCheckingShipments = false;
    this.listeners = []; // For SSE/websocket updates later
  }

  /**
   * Start the auto-fetch scheduler based on saved settings.
   */
  async init() {
    const settings = await orderDatabase.getAutoFetchSettings();
    if (settings.enabled) {
      this.startAutoFetch(settings.intervalMinutes);
    }
    // Always poll ShipStation every 5 minutes for shipped orders
    this.startShipStationPolling(5);
    console.log('[Scheduler] Initialized');
  }

  // ─── AUTO-FETCH FROM PHOTODAY ─────────────────────────────

  startAutoFetch(intervalMinutes) {
    this.stopAutoFetch();
    const ms = intervalMinutes * 60 * 1000;
    console.log(`[Scheduler] Auto-fetch started: every ${intervalMinutes} minutes`);

    // Run immediately, then on interval
    this.fetchNewOrders();
    this.fetchTimer = setInterval(() => this.fetchNewOrders(), ms);
  }

  stopAutoFetch() {
    if (this.fetchTimer) {
      clearInterval(this.fetchTimer);
      this.fetchTimer = null;
      console.log('[Scheduler] Auto-fetch stopped');
    }
  }

  async updateAutoFetch(enabled, intervalMinutes) {
    await orderDatabase.updateAutoFetchSettings({ enabled, intervalMinutes });
    if (enabled) {
      this.startAutoFetch(intervalMinutes);
    } else {
      this.stopAutoFetch();
    }
  }

  /**
   * Fetch new orders from PhotoDay and save to local database.
   * Does NOT mark them as processed in PhotoDay — that happens when user processes them.
   */
  async fetchNewOrders() {
    if (this.isFetching) {
      console.log('[Scheduler] Fetch already in progress, skipping');
      return { skipped: true };
    }

    this.isFetching = true;
    try {
      console.log('[Scheduler] Fetching new orders from PhotoDay...');
      const orders = await photodayService.getOrders();

      let newCount = 0;
      for (const order of orders) {
        const exists = await orderDatabase.hasOrder(order.num);
        if (!exists) {
          await orderDatabase.saveOrder(order, 'unprocessed');
          newCount++;
        }
      }

      await orderDatabase.updateLastFetch();
      console.log(`[Scheduler] Fetched ${orders.length} orders, ${newCount} new`);

      return {
        fetched: orders.length,
        newOrders: newCount,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[Scheduler] Fetch error:', error.message);
      return { error: error.message };
    } finally {
      this.isFetching = false;
    }
  }

  // ─── SHIPSTATION POLLING ──────────────────────────────────

  startShipStationPolling(intervalMinutes = 5) {
    this.stopShipStationPolling();
    const ms = intervalMinutes * 60 * 1000;
    console.log(`[Scheduler] ShipStation polling started: every ${intervalMinutes} minutes`);
    this.shipstationTimer = setInterval(() => this.checkShipStationForShippedOrders(), ms);
  }

  stopShipStationPolling() {
    if (this.shipstationTimer) {
      clearInterval(this.shipstationTimer);
      this.shipstationTimer = null;
    }
  }

  /**
   * Check ShipStation for orders that have been shipped (label printed/paid).
   * When found, send the shipped callback to PhotoDay and update local DB.
   */
  async checkShipStationForShippedOrders() {
    if (this.isCheckingShipments) return;
    this.isCheckingShipments = true;

    try {
      // Get all processed (not yet shipped) orders from our database
      const processedOrders = await orderDatabase.getProcessedOrders();
      if (processedOrders.length === 0) {
        this.isCheckingShipments = false;
        return;
      }

      console.log(`[Scheduler] Checking ShipStation for ${processedOrders.length} processed orders...`);

      // Check ShipStation for shipped orders
      const ssResult = await shipstationService.listOrders({
        orderStatus: 'shipped',
        pageSize: 100,
      });

      if (!ssResult?.orders) {
        this.isCheckingShipments = false;
        return;
      }

      // Build a map of ShipStation shipped orders by orderNumber
      const shippedMap = new Map();
      for (const ssOrder of ssResult.orders) {
        if (ssOrder.orderNumber) {
          shippedMap.set(ssOrder.orderNumber, ssOrder);
        }
      }

      // Match against our processed orders
      for (const localOrder of processedOrders) {
        const ssOrder = shippedMap.get(localOrder.orderNum);
        if (!ssOrder) continue;

        // Found a shipped order! Extract tracking info if available
        const shipments = ssOrder.shipments || [];
        const latestShipment = shipments[shipments.length - 1];
        const trackingNumber = latestShipment?.trackingNumber || ssOrder.trackingNumber || '';
        const carrierCode = latestShipment?.carrierCode || ssOrder.carrierCode || 'usps';

        // Map ShipStation carrier to PhotoDay carrier format
        const pdCarrier = this._mapCarrier(carrierCode);

        try {
          // Send shipped callback to PhotoDay (always, even without tracking)
          try {
            await photodayService.markAsShipped(localOrder.orderNum, pdCarrier, trackingNumber);
          } catch (pdErr) {
            console.warn(`[Scheduler] PhotoDay callback for ${localOrder.orderNum}: ${pdErr.message}`);
          }

          // Update local database
          await orderDatabase.markShipped(localOrder.orderNum, pdCarrier, trackingNumber || 'No tracking', {
            shipstationOrderId: ssOrder.orderId,
            photodaySynced: true,
          });

          console.log(`[Scheduler] Order ${localOrder.orderNum} auto-shipped: ${pdCarrier} ${trackingNumber || '(no tracking)'}`);
        } catch (err) {
          console.error(`[Scheduler] Failed to mark ${localOrder.orderNum} as shipped:`, err.message);
        }
      }
    } catch (error) {
      console.error('[Scheduler] ShipStation polling error:', error.message);
    } finally {
      this.isCheckingShipments = false;
    }
  }

  /**
   * Map ShipStation carrier codes to PhotoDay carrier codes.
   */
  _mapCarrier(ssCarrier) {
    const map = {
      'usps': 'USPS',
      'ups': 'UPS',
      'ups_walleted': 'UPSMI',
      'fedex': 'FEDEX',
      'dhl': 'DHL',
      'dhl_express': 'DHL',
    };
    return map[ssCarrier?.toLowerCase()] || 'USPS';
  }

  /**
   * Process an order: download images, impose sheets, generate txt, create in ShipStation, mark as processed.
   */
  async processOrder(orderNum, options = {}) {
    const localOrder = await orderDatabase.getOrder(orderNum);
    if (!localOrder) throw new Error(`Order ${orderNum} not found`);
    if (localOrder.status !== 'unprocessed') throw new Error(`Order ${orderNum} is already ${localOrder.status}`);

    const order = localOrder.orderData;

    // 1. Download images
    const downloadResult = await fileService.downloadOrderImages(order, options);

    // 2. Apply imposition rules (e.g., 8 wallets on 8x10 sheet)
    //    This replaces original images with composed sheets where applicable
    let impositionResults = [];
    try {
      impositionResults = await impositionService.processOrder(order, downloadResult.orderDir);
      const imposedCount = impositionResults.filter(r => r.imposed).length;
      if (imposedCount > 0) {
        console.log(`[Scheduler] Imposition: ${imposedCount} item(s) composed for ${orderNum}`);
      }
    } catch (impError) {
      console.error(`[Scheduler] Imposition error for ${orderNum}:`, impError.message);
    }

    // 3. Generate packing slip (before txt so we can include it as a print item)
    let packingSlipResult = null;
    try {
      packingSlipResult = await packingSlipService.generateSlip(order, downloadResult.orderDir);
      console.log(`[Scheduler] Packing slip generated for ${orderNum}: ${packingSlipResult.filename}`);
    } catch (psError) {
      console.error(`[Scheduler] Packing slip error for ${orderNum}:`, psError.message);
      packingSlipResult = { error: psError.message };
    }

    // 4. Generate Darkroom txt (packing slip is first print item at 5x8)
    const txtResult = await darkroomService.processOrder(order, {
      ...options,
      orderDir: downloadResult.orderDir,
      packingSlipPath: packingSlipResult?.filePath || null,
    });

    // 5. Create order in ShipStation (awaiting_shipment — label not purchased)
    let shipstationResult = null;
    try {
      const ssPayload = shipstationService.buildOrderFromPDX(order, options.shipstation || {});
      shipstationResult = await shipstationService.createOrder(ssPayload);
      console.log(`[Scheduler] ShipStation order created for ${orderNum}: SS#${shipstationResult.orderId}`);
    } catch (ssError) {
      console.error(`[Scheduler] ShipStation creation failed for ${orderNum}:`, ssError.message);
      shipstationResult = { error: ssError.message };
    }

    // 6. Mark as processed in PhotoDay
    await photodayService.markAsProcessed(orderNum);

    // 7. Update local database
    await orderDatabase.markProcessed(orderNum, {
      txtFile: txtResult.filePath,
      packingSlip: packingSlipResult?.filePath || null,
      downloadPath: downloadResult.orderDir,
      shipstationOrderId: shipstationResult?.orderId || null,
      shipstationError: shipstationResult?.error || null,
    });

    return {
      orderNum,
      downloads: downloadResult,
      imposition: impositionResults,
      txtFile: txtResult,
      packingSlip: packingSlipResult,
      shipstation: shipstationResult,
    };
  }

  /**
   * Process all unprocessed orders, optionally filtered by gallery.
   */
  async processAllUnprocessed(options = {}) {
    let unprocessed = await orderDatabase.getUnprocessedOrders();

    // Filter by gallery if specified
    if (options.gallery) {
      unprocessed = unprocessed.filter(o => o.gallery === options.gallery);
    }

    const results = [];

    for (const localOrder of unprocessed) {
      try {
        const result = await this.processOrder(localOrder.orderNum, options);
        results.push({ orderNum: localOrder.orderNum, success: true, ...result });
      } catch (err) {
        results.push({ orderNum: localOrder.orderNum, success: false, error: err.message });
      }
    }

    return {
      total: unprocessed.length,
      gallery: options.gallery || null,
      successCount: results.filter(r => r.success).length,
      errorCount: results.filter(r => !r.success).length,
      results,
    };
  }
}

module.exports = new SchedulerService();
