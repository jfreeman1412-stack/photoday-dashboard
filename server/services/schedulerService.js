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
      let updatedCount = 0;
      const autoProcessed = [];

      for (const order of orders) {
        const exists = await orderDatabase.hasOrder(order.num);
        if (!exists) {
          await orderDatabase.saveOrder(order, 'unprocessed');
          newCount++;

          // Download images immediately while asset URLs are fresh
          // This ensures images are on disk when the user clicks Process later
          let shouldAutoProcess = false;
          try {
            console.log(`[Scheduler] Downloading images for new order ${order.num}...`);
            const dlResult = await fileService.downloadOrderImages(order);
            if (dlResult.successCount > 0) {
              console.log(`[Scheduler] Downloaded ${dlResult.successCount} images for ${order.num} → ${dlResult.orderDir}`);
              await orderDatabase.updateOrder(order.num, { downloadPath: dlResult.orderDir });
            }
          } catch (dlErr) {
            console.error(`[Scheduler] Image download error for ${order.num}: ${dlErr.message}`);
          }

          // Check if this gallery has auto-process enabled
          try {
            const galleryConfig = await this._getGalleryConfig(order.gallery);
            if (galleryConfig.autoProcess) {
              // If team processing is also on, only auto-process orders without team tags
              const hasTags = (order.items || []).some(item => item.photoTags && item.photoTags.length > 0);
              if (!galleryConfig.teamEnabled || !hasTags) {
                shouldAutoProcess = true;
              } else {
                console.log(`[Scheduler] Skipping auto-process for ${order.num} — has team tags, requires manual team selection`);
              }
            }
          } catch (gcErr) {
            // No gallery config — just skip auto-process
          }

          if (shouldAutoProcess) {
            console.log(`[Scheduler] Auto-processing ${order.num} from "${order.gallery}"`);
            try {
              await this.processOrder(order.num, { autoProcess: true });
              autoProcessed.push(order.num);
              console.log(`[Scheduler] Auto-processed ${order.num} successfully`);
            } catch (apErr) {
              console.error(`[Scheduler] Auto-process failed for ${order.num}: ${apErr.message}`);
            }
          }
        } else {
          // Always update orderData to keep asset URLs fresh
          await orderDatabase.saveOrder(order, 'unprocessed');
          updatedCount++;
          console.log(`[Scheduler] Updated asset URLs for existing order ${order.num}`);
        }
      }

      await orderDatabase.updateLastFetch();
      console.log(`[Scheduler] Fetched ${orders.length} orders, ${newCount} new, ${updatedCount} updated, ${autoProcessed.length} auto-processed`);

      return {
        fetched: orders.length,
        newOrders: newCount,
        newCount,
        autoProcessed: autoProcessed.length,
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
      console.log(`[Scheduler] Looking for order numbers: ${processedOrders.map(o => o.orderNum).join(', ')}`);

      // Check ShipStation for shipped orders
      // Only look at orders shipped in the last 7 days, sorted newest first
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const shipDateStart = sevenDaysAgo.toISOString().split('T')[0];

      const ssResult = await shipstationService.listOrders({
        orderStatus: 'shipped',
        pageSize: 100,
        sortBy: 'ModifyDate',
        sortDir: 'DESC',
        modifyDateStart: shipDateStart,
      });

      if (!ssResult?.orders) {
        console.log(`[Scheduler] ShipStation returned no orders`);
        this.isCheckingShipments = false;
        return;
      }

      console.log(`[Scheduler] ShipStation returned ${ssResult.orders.length} shipped orders`);

      // Build a map of ShipStation shipped orders by orderNumber
      const shippedMap = new Map();
      for (const ssOrder of ssResult.orders) {
        if (ssOrder.orderNumber) {
          shippedMap.set(ssOrder.orderNumber, ssOrder);
        }
      }

      console.log(`[Scheduler] ShipStation shipped order numbers: ${[...shippedMap.keys()].join(', ')}`);

      // Match against our processed orders
      for (const localOrder of processedOrders) {
        const ssOrder = shippedMap.get(localOrder.orderNum);
        if (!ssOrder) {
          console.log(`[Scheduler] No ShipStation match for ${localOrder.orderNum}`);
          continue;
        }

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

    // Allow reprocessing if explicitly requested
    if (localOrder.status !== 'unprocessed' && !options.reprocess) {
      throw new Error(`Order ${orderNum} is already ${localOrder.status}`);
    }

    const order = localOrder.orderData;

    // Log asset URLs being used
    for (const item of order.items || []) {
      for (const img of item.images || []) {
        console.log(`[Scheduler] Image URL for ${img.filename}: ${img.assetUrl}`);
      }
    }

    // 1. Download images
    let downloadResult;
    try {
      downloadResult = await fileService.downloadOrderImages(order, options);
      
      // If any images failed to download, abort processing
      // Leave the order as unprocessed so the next fetch cycle refreshes URLs
      if (downloadResult.errorCount > 0) {
        const failedFiles = downloadResult.errors?.map(e => e.filename).join(', ') || 'unknown';
        console.error(`[Scheduler] ${downloadResult.errorCount} image(s) failed to download for ${orderNum}: ${failedFiles}`);
        console.error(`[Scheduler] Aborting processing for ${orderNum} — order stays unprocessed, URLs will refresh on next fetch`);
        
        // If we have SOME images from a previous download, note that
        if (downloadResult.successCount > 0) {
          console.log(`[Scheduler] ${downloadResult.successCount} image(s) downloaded successfully, but all images are required`);
        }
        
        throw new Error(`Failed to download ${downloadResult.errorCount} of ${downloadResult.totalImages} images — asset URLs may have expired. Order will retry on next fetch.`);
      }
    } catch (dlError) {
      // If it's our abort error, re-throw it
      if (dlError.message.includes('Failed to download')) throw dlError;
      
      console.error(`[Scheduler] Download error for ${orderNum}: ${dlError.message}`);
      if (localOrder.downloadPath) {
        console.log(`[Scheduler] Falling back to previous download path: ${localOrder.downloadPath}`);
        downloadResult = { orderDir: localOrder.downloadPath, downloaded: [], errors: [], successCount: 0, errorCount: 0 };
      } else {
        throw dlError;
      }
    }

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
    let txtResult = null;
    try {
      console.log(`[Scheduler] Starting Darkroom txt for ${orderNum}, orderDir: ${downloadResult.orderDir}`);
      txtResult = await darkroomService.processOrder(order, {
        ...options,
        orderDir: downloadResult.orderDir,
        packingSlipPath: packingSlipResult?.filePath || null,
      });
      console.log(`[Scheduler] Darkroom txt generated for ${orderNum}: ${txtResult.filePath}`);
    } catch (txtError) {
      console.error(`[Scheduler] Darkroom txt error for ${orderNum}:`, txtError.message, txtError.stack);
      txtResult = { error: txtError.message };
    }

    // 5. Create order in ShipStation (awaiting_shipment — label not purchased)
    //    Behavior:
    //      - First-time process (options.reprocess !== true): always create.
    //      - Reprocess: check if order already exists in ShipStation by orderNumber.
    //        If found → skip create (operator must edit in SS UI or delete+reprocess).
    //        If not found → create as if it were a first-time process.
    let shipstationResult = null;
    let shipstationStepOk = false;
    try {
      let existingOrder = null;
      if (options.reprocess) {
        try {
          const lookup = await shipstationService.listOrders({ orderNumber: orderNum });
          const found = (lookup?.orders || []).find(o => o.orderNumber === orderNum);
          if (found) existingOrder = found;
        } catch (lookupErr) {
          // Lookup failure — don't blindly create, surface error and stop the SS step.
          console.error(`[Scheduler] ShipStation lookup failed for ${orderNum}: ${lookupErr.message}`);
          shipstationResult = { error: `Lookup failed: ${lookupErr.message}` };
          throw lookupErr; // jump to outer catch — preserves shipstationStepOk = false
        }
      }

      if (existingOrder) {
        console.log(`[Scheduler] ShipStation order already exists for ${orderNum} (SS#${existingOrder.orderId}, status: ${existingOrder.orderStatus}) — skipping create`);
        shipstationResult = {
          orderId: existingOrder.orderId,
          orderStatus: existingOrder.orderStatus,
          skipped: true,
          reason: 'Order already exists in ShipStation',
        };
        shipstationStepOk = true;
      } else {
        const ssPayload = await shipstationService.buildOrderFromPDX(order, options.shipstation || {});
        shipstationResult = await shipstationService.createOrder(ssPayload);
        const sentPkg = ssPayload.packageCode;
        const storedPkg = shipstationResult.packageCode;
        const drift = sentPkg !== storedPkg ? ` ⚠ drift: sent=${sentPkg}, stored=${storedPkg}` : '';
        console.log(`[Scheduler] ShipStation order created for ${orderNum}: SS#${shipstationResult.orderId} (packageCode=${storedPkg})${drift}`);
        shipstationStepOk = true;
      }
    } catch (ssError) {
      console.error(`[Scheduler] ShipStation creation failed for ${orderNum}:`, ssError.message);
      // Preserve the lookup-failure error if we set one before throwing
      if (!shipstationResult) shipstationResult = { error: ssError.message };
      shipstationStepOk = false;
    }

    // 6. Mark as processed in PhotoDay — ONLY if the ShipStation step succeeded
    //    (succeeded includes "skipped because already exists"). On failure, leave it
    //    unmarked so the operator notices and can retry without going out of sync.
    if (shipstationStepOk) {
      try {
        await photodayService.markAsProcessed(orderNum);
      } catch (pdErr) {
        console.warn(`[Scheduler] PhotoDay mark processed for ${orderNum}: ${pdErr.message}`);
      }
    } else {
      console.warn(`[Scheduler] ShipStation step failed for ${orderNum} — NOT marking as processed in PhotoDay. Fix the issue and reprocess.`);
    }

    // 7. Update local database
    await orderDatabase.markProcessed(orderNum, {
      txtFile: txtResult?.filePath || null,
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

  /**
   * Get per-gallery configuration from the database.
   */
  async _getGalleryConfig(gallery) {
    if (!gallery) return { teamEnabled: false, autoProcess: false, folderSort: null };
    try {
      const databaseService = require('./database');
      const db = databaseService.getDb();
      const row = db.prepare("SELECT value FROM settings WHERE key = 'gallerySettings'").get();
      const allSettings = row ? JSON.parse(row.value) : {};
      return allSettings[gallery] || { teamEnabled: false, autoProcess: false, folderSort: null };
    } catch (err) {
      return { teamEnabled: false, autoProcess: false, folderSort: null };
    }
  }
}

module.exports = new SchedulerService();
