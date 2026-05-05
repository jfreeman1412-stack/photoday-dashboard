const photodayService = require('./photodayService');
const shipstationService = require('./shipstationService');
const orderDatabase = require('./orderDatabase');
const fileService = require('./fileService');
const darkroomService = require('./darkroomService');
const impositionService = require('./impositionService');
const packingSlipService = require('./packingSlipService');
const teamDividerService = require('./teamDividerService');
const packagingService = require('./packagingService');
const bulkOrderService = require('./bulkOrderService');
const fs = require('fs-extra');

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
              if (order.isBulkOrder) {
                await this.processBulkOrder(order.num, { autoProcess: true });
              } else {
                await this.processOrder(order.num, { autoProcess: true });
              }
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

    // `order` is mutable: if the download step refreshes asset URLs from PhotoDay,
    // the rest of this method should operate on the freshly fetched order data.
    let order = localOrder.orderData;

    // Log asset URLs being used
    for (const item of order.items || []) {
      for (const img of item.images || []) {
        console.log(`[Scheduler] Image URL for ${img.filename}: ${img.assetUrl}`);
      }
    }

    // 1. Download images (with auto-refresh of expired asset URLs from PhotoDay)
    let downloadResult;
    let workingOrder = order;
    try {
      const dlOptions = {
        ...options,
        downloadPath: options.userDownloadPath || options.downloadPath,
      };
      const dl = await this._downloadWithRefresh(order, dlOptions, localOrder.status);
      downloadResult = dl.downloadResult;
      workingOrder = dl.freshOrder;

      // If still failing after the refresh attempt (or refresh wasn't possible), abort
      if (downloadResult.errorCount > 0) {
        const failedFiles = downloadResult.errors?.map(e => e.filename).join(', ') || 'unknown';
        console.error(`[Scheduler] ${downloadResult.errorCount} image(s) still failed for ${orderNum} after refresh attempt: ${failedFiles}`);
        console.error(`[Scheduler] Aborting processing for ${orderNum} — order stays unprocessed, will retry on next fetch`);

        if (downloadResult.successCount > 0) {
          console.log(`[Scheduler] ${downloadResult.successCount} image(s) downloaded successfully, but all images are required`);
        }

        throw new Error(`Failed to download ${downloadResult.errorCount} of ${downloadResult.totalImages} images — asset URLs may have expired and refresh did not resolve them. Order will retry on next fetch.`);
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

    // If a URL refresh happened, work with the fresh order data from here on
    order = workingOrder;

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

    // 4. Generate Darkroom txt (slip placement: 'first' or 'last' from gallery/global setting)
    let txtResult = null;
    try {
      console.log(`[Scheduler] Starting Darkroom txt for ${orderNum}, orderDir: ${downloadResult.orderDir}`);
      const slipPosition = await this._resolveSlipPosition(order.gallery);
      txtResult = await darkroomService.processOrder(order, {
        ...options,
        orderDir: downloadResult.orderDir,
        packingSlipPath: packingSlipResult?.filePath || null,
        slipPosition,
      });
      console.log(`[Scheduler] Darkroom txt generated for ${orderNum}: ${txtResult.filePath} (slipPosition=${slipPosition})`);
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
        if (ssPayload && ssPayload.__skipShipStation) {
          // Specialty-only order — drop-shipped from another lab. No SS order needed.
          console.log(`[Scheduler] ShipStation skipped for ${orderNum}: ${ssPayload.message}`);
          shipstationResult = {
            skipped: true,
            reason: ssPayload.reason,
            message: ssPayload.message,
          };
          shipstationStepOk = true;
        } else {
          shipstationResult = await shipstationService.createOrder(ssPayload);
          const sentPkg = ssPayload.packageCode;
          const storedPkg = shipstationResult.packageCode;
          const drift = sentPkg !== storedPkg ? ` ⚠ drift: sent=${sentPkg}, stored=${storedPkg}` : '';
          console.log(`[Scheduler] ShipStation order created for ${orderNum}: SS#${shipstationResult.orderId} (packageCode=${storedPkg})${drift}`);
          shipstationStepOk = true;
        }
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
        const isBulk = !!localOrder?.orderData?.isBulkOrder;
        const result = isBulk
          ? await this.processBulkOrder(localOrder.orderNum, options)
          : await this.processOrder(localOrder.orderNum, options);
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

  /**
   * Process a batch of orders, grouped by team. For each order in the batch:
   *   - Filter the order's items by team(s) — only those items are processed in this run
   *   - Download images, run imposition, generate per-team packing slips
   *   - Mark the processed items in the local DB; if all items are now done, mark
   *     the order processed and ping PhotoDay
   * Then write ONE batch Darkroom txt with team-divider sheets between teams.
   *
   * @param {Array<{ orderNum, teams }>} requests
   *   Each entry: { orderNum, teams: [team1, team2, ...] } — the teams to process for this order.
   *   To process ALL teams in an order, pass teams: null or 'all'.
   * @param {object} options - { batchLabel: 'TeamA' | 'AllTeams' | ... }
   * @returns {Promise<{ batchTxt, ordersProcessed, teamsProcessed, errors }>}
   */
  async processBatchByTeam(requests, options = {}) {
    if (!Array.isArray(requests) || requests.length === 0) {
      throw new Error('No orders requested for batch processing');
    }

    // Group output bucket: team → [{ orderData, items, packingSlipPath, orderDir }]
    const teamGroups = new Map();
    const errors = [];
    const fullyProcessedOrders = []; // track for PhotoDay marking
    let firstGallery = '';

    for (const req of requests) {
      const orderNum = req.orderNum;
      try {
        const localOrder = await orderDatabase.getOrder(orderNum);
        if (!localOrder) {
          errors.push({ orderNum, error: 'Order not found in local DB' });
          continue;
        }

        // Refuse if Skip ShipStation isn't enabled for this gallery (team batches
        // need hand-delivery semantics; per-team labels aren't implemented yet).
        const gallerySettings = await this._getGalleryConfig(localOrder.gallery);
        if (!gallerySettings.skipShipStation) {
          errors.push({
            orderNum,
            error: `Team processing requires "Skip ShipStation" to be enabled for gallery "${localOrder.gallery}". Enable it in the gallery settings before running team batches.`,
          });
          continue;
        }
        if (!firstGallery) firstGallery = localOrder.gallery;

        // `order` is mutable: if download refreshes asset URLs from PhotoDay,
        // subsequent steps should operate on the fresh data.
        let order = localOrder.orderData;

        // Determine which teams' items we're processing this run
        const requestedTeams = (req.teams === null || req.teams === 'all' || !req.teams)
          ? this._collectTeamsFromOrder(order)
          : (Array.isArray(req.teams) ? req.teams : [req.teams]);

        if (requestedTeams.length === 0) {
          errors.push({ orderNum, error: 'No teams found on this order' });
          continue;
        }

        // Items unprocessed AND in any of the requested teams
        const allItems = await orderDatabase.getOrderItems(orderNum, { unprocessedOnly: true });
        const itemsForThisRun = allItems.filter(it =>
          (it.tags || []).some(t => requestedTeams.includes(t))
        );

        if (itemsForThisRun.length === 0) {
          console.log(`[Scheduler] No unprocessed items for ${orderNum} matching teams [${requestedTeams.join(', ')}] — skipping`);
          continue;
        }

        // ─── Download all images for this order ────────────
        // We download ALL the order's images (not just team-filtered) because images
        // can be referenced by multiple items. Imposition will only run on team items
        // and the txt will only reference team items. If asset URLs have expired,
        // _downloadWithRefresh will pull fresh URLs from PhotoDay and retry once.
        const dlOptions = options.userDownloadPath ? { downloadPath: options.userDownloadPath } : {};
        const dl = await this._downloadWithRefresh(order, dlOptions, localOrder.status);
        const downloadResult = dl.downloadResult;
        order = dl.freshOrder; // use refreshed data if a refresh happened
        if (downloadResult.errorCount > 0) {
          throw new Error(`Failed to download ${downloadResult.errorCount} of ${downloadResult.totalImages} images${dl.freshOrder !== localOrder.orderData ? ' even after URL refresh' : ''}`);
        }

        // ─── Imposition for team items only ───────────────
        // Build a synthetic order with only the items this run cares about,
        // then run imposition on it. Imposition operates on file paths in orderDir
        // so the synthetic order shares the real orderDir.
        const teamItemUuids = new Set(itemsForThisRun.map(it => it.id));
        const fullItemObjects = (order.items || []).filter(i => teamItemUuids.has(i.id));
        const syntheticOrder = { ...order, items: fullItemObjects };
        try {
          const impResults = await impositionService.processOrder(syntheticOrder, downloadResult.orderDir);
          const imposedCount = impResults.filter(r => r.imposed).length;
          if (imposedCount > 0) {
            console.log(`[Scheduler] Imposition: ${imposedCount} item(s) composed for ${orderNum} (team subset)`);
          }
        } catch (impErr) {
          console.error(`[Scheduler] Imposition error for ${orderNum}: ${impErr.message}`);
        }

        // ─── Group team items by team for output bucketing ───
        // A single item can belong to multiple teams technically, but in practice
        // each player-tagged item has one team. We bucket by the FIRST matching
        // requested team to keep output clean.
        const itemsByTeam = new Map();
        for (const item of fullItemObjects) {
          const itemTags = (await orderDatabase.getOrderItems(orderNum)).find(i => i.id === item.id)?.tags || [];
          const matchedTeam = requestedTeams.find(t => itemTags.includes(t));
          if (!matchedTeam) continue;
          if (!itemsByTeam.has(matchedTeam)) itemsByTeam.set(matchedTeam, []);
          itemsByTeam.get(matchedTeam).push(item);
        }

        // ─── Per-team: generate packing slip, add to team group ───
        for (const [teamName, teamItems] of itemsByTeam.entries()) {
          const teamItemIds = teamItems.map(i => i.id);
          let packingSlipPath = null;
          try {
            const ps = await packingSlipService.generateSlip(order, downloadResult.orderDir, {
              team: teamName,
              teamItems: teamItemIds,
            });
            packingSlipPath = ps.filePath;
          } catch (psErr) {
            console.error(`[Scheduler] Packing slip error for ${orderNum} team ${teamName}: ${psErr.message}`);
          }

          if (!teamGroups.has(teamName)) {
            teamGroups.set(teamName, { team: teamName, gallery: localOrder.gallery, orders: [] });
          }
          teamGroups.get(teamName).orders.push({
            orderNum,
            orderData: order,
            items: teamItems,
            packingSlipPath,
            orderDir: downloadResult.orderDir,
          });
        }

        // ─── Mark these items processed in DB; resolve order status ──
        const result = await orderDatabase.markItemsProcessed(orderNum, [...teamItemUuids]);
        console.log(`[Scheduler] Marked ${teamItemUuids.size} items processed for ${orderNum} → status=${result.newStatus} (${result.processedCount}/${result.totalCount})`);

        if (result.allItemsProcessed) {
          fullyProcessedOrders.push({ orderNum, downloadPath: downloadResult.orderDir });
        }

      } catch (err) {
        console.error(`[Scheduler] Error processing ${orderNum}:`, err.message, err.stack);
        errors.push({ orderNum, error: err.message });
      }
    }

    // ─── Write per-order batch txts (one per team-order pair) ──────────
    if (teamGroups.size === 0) {
      return { batchFiles: [], ordersProcessed: 0, teamsProcessed: 0, errors };
    }

    // Sort teams alphabetically for deterministic print order
    const sortedGroups = [...teamGroups.values()].sort((a, b) => a.team.localeCompare(b.team));
    const totalOrders = sortedGroups.reduce((n, g) => n + g.orders.length, 0);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const galleryLabel = this._safeName(firstGallery || 'Batch');

    // Resolve slip position once per gallery (same setting for all orders in this batch)
    const slipPosition = await this._resolveSlipPosition(firstGallery);

    const batchFiles = [];

    for (let teamIdx = 0; teamIdx < sortedGroups.length; teamIdx++) {
      const group = sortedGroups[teamIdx];
      const teamLabel = this._safeName(group.team);
      // Numeric prefix ensures alphabetical sort = team print order (zero-padded so 10+ teams sort right)
      const teamPrefix = String(teamIdx + 1).padStart(3, '0');
      // outputDir for the team's divider — pick the first order in this team's orderDir
      const teamOutputDir = group.orders[0]?.orderDir || (await this._defaultOutputDir());

      for (const orderEntry of group.orders) {
        // For each (team, order) pair, write a per-order Darkroom txt
        // with the team-filtered items, packing slip, and batch-prefixed filename.
        const order = orderEntry.orderData;
        // Synthetic order with only this team's items so darkroomService writes the right things
        const teamFilteredOrder = { ...order, items: orderEntry.items };
        const batchFilename = `BATCH_${ts}_${galleryLabel}_${teamPrefix}-${teamLabel}_${orderEntry.orderNum}`;
        try {
          const txtResult = await darkroomService.processOrder(teamFilteredOrder, {
            orderDir: orderEntry.orderDir,
            packingSlipPath: orderEntry.packingSlipPath,
            slipPosition,
            batchFilename,
          });
          batchFiles.push(txtResult.filePath);
          console.log(`[Scheduler] Batch txt: ${txtResult.filename}`);
        } catch (txtErr) {
          console.error(`[Scheduler] Batch txt error for ${orderEntry.orderNum} team ${group.team}: ${txtErr.message}`);
          errors.push({ orderNum: orderEntry.orderNum, error: `Failed to write team batch txt: ${txtErr.message}` });
        }
      }

      // Standalone team-divider txt at end of team's section.
      // Filename uses 'zzzz' so it sorts after all order files within this team's prefix.
      try {
        const totalTeamItems = group.orders.reduce((n, o) => n + (o.items || []).length, 0);
        const divider = await teamDividerService.generateDivider(group.team, teamOutputDir, {
          customerCount: group.orders.length,
          itemCount: totalTeamItems,
          gallery: group.gallery || '',
        });
        const dividerFilename = `BATCH_${ts}_${galleryLabel}_${teamPrefix}-${teamLabel}_zzzz_DIVIDER`;
        const dividerTxt = await darkroomService.writeDividerTxt(divider.filePath, teamOutputDir, dividerFilename, group.team);
        batchFiles.push(dividerTxt.filePath);
        console.log(`[Scheduler] Team divider txt: ${dividerTxt.filename}`);
      } catch (divErr) {
        console.error(`[Scheduler] Team divider error for ${group.team}: ${divErr.message}`);
        errors.push({ team: group.team, error: `Failed to write team divider: ${divErr.message}` });
      }
    }

    console.log(`[Scheduler] Batch processed: ${totalOrders} orders, ${sortedGroups.length} team(s), ${batchFiles.length} txt file(s) written, slipPosition=${slipPosition}`);

    // ─── Mark fully-processed orders in PhotoDay ──────────
    for (const { orderNum, downloadPath } of fullyProcessedOrders) {
      try {
        await photodayService.markAsProcessed(orderNum);
        await orderDatabase.updateOrder(orderNum, { photodaySynced: true, downloadPath });
      } catch (pdErr) {
        console.warn(`[Scheduler] PhotoDay mark processed for ${orderNum}: ${pdErr.message}`);
      }
    }

    return {
      batchFiles,
      batchFileCount: batchFiles.length,
      ordersProcessed: totalOrders,
      teamsProcessed: sortedGroups.length,
      fullyProcessedCount: fullyProcessedOrders.length,
      slipPosition,
      errors,
    };
  }

  /**
   * Download an order's images, with one-shot auto-refresh of asset URLs from
   * PhotoDay if any image returns a 403/expired error. PhotoDay's asset URLs are
   * signed and rotate when the order is updated/resent, which is the most common
   * cause of download failures here.
   *
   * On a refresh, the local DB record for this order is updated with the fresh
   * orderData (URLs and any other field changes), and the caller can use the
   * returned `freshOrder` to keep working with up-to-date data.
   *
   * @param {object} order - The order object whose items have asset URLs to download
   * @param {object} dlOptions - Options forwarded to fileService.downloadOrderImages
   * @param {string} statusForSave - Status to preserve when saving refreshed data (default 'unprocessed')
   * @returns {Promise<{ downloadResult, freshOrder }>}
   *   - downloadResult: same shape as fileService.downloadOrderImages
   *   - freshOrder: the refreshed order if a refresh happened, else the original
   */
  async _downloadWithRefresh(order, dlOptions = {}, statusForSave = 'unprocessed') {
    const orderNum = order.num;
    let downloadResult = await fileService.downloadOrderImages(order, dlOptions);

    if (downloadResult.errorCount === 0) {
      return { downloadResult, freshOrder: order };
    }

    const failedFiles = downloadResult.errors?.map(e => e.filename).join(', ') || 'unknown';
    const sample403 = (downloadResult.errors || []).find(e => /403|expired/i.test(e.error || ''));
    console.warn(`[Scheduler] ${downloadResult.errorCount} image(s) failed for ${orderNum}: ${failedFiles}${sample403 ? ' (likely expired URLs)' : ''}`);
    console.log(`[Scheduler] Attempting URL refresh from PhotoDay for ${orderNum}...`);

    let freshOrder = null;
    try {
      const freshOrders = await photodayService.getOrders();
      freshOrder = freshOrders.find(o => o.num === orderNum);
    } catch (refreshErr) {
      console.warn(`[Scheduler] URL refresh failed for ${orderNum}: ${refreshErr.message}`);
    }

    if (!freshOrder) {
      console.warn(`[Scheduler] ${orderNum} not in PhotoDay's queue (already marked processed there?) — cannot refresh URLs`);
      return { downloadResult, freshOrder: order };
    }

    console.log(`[Scheduler] Got fresh URLs for ${orderNum}; updating local DB and retrying download`);
    await orderDatabase.saveOrder(freshOrder, statusForSave);
    downloadResult = await fileService.downloadOrderImages(freshOrder, dlOptions);
    return { downloadResult, freshOrder };
  }

  /**
   * Resolve packing-slip position from gallery setting (if 'first' or 'last') falling back
   * to global packaging config (default 'first').
   */
  async _resolveSlipPosition(gallery) {
    try {
      const galleryConfig = await this._getGalleryConfig(gallery);
      if (galleryConfig?.packingSlipPosition === 'first' || galleryConfig?.packingSlipPosition === 'last') {
        return galleryConfig.packingSlipPosition;
      }
    } catch {}
    try {
      const pkgConfig = await packagingService.getConfig();
      if (pkgConfig?.packingSlipPosition === 'first' || pkgConfig?.packingSlipPosition === 'last') {
        return pkgConfig.packingSlipPosition;
      }
    } catch {}
    return 'first';
  }

  /**
   * Collect all team tags from an order's items.
   */
  _collectTeamsFromOrder(order) {
    const teams = new Set();
    for (const item of order.items || []) {
      const tags = item.photoTags || [];
      for (const tag of tags) teams.add(tag);
    }
    return [...teams];
  }

  _safeName(s) {
    return String(s || '').replace(/[<>:"/\\|?*\s]/g, '_').replace(/_+/g, '_').slice(0, 60);
  }

  async _defaultOutputDir() {
    const config = require('../config');
    return config.paths.txtOutput || config.paths.downloadBase;
  }

  /**
   * Process a Bulk Shipping order — one PhotoDay order containing many groups
   * (one group per dancer/athlete), all destined for a single studio shipment.
   *
   * Flow:
   *   1. Bucket items by dancer (by group). Same-name dancers are merged.
   *   2. Sort buckets alphabetically by last name (then first name).
   *   3. For each dancer: download → impose → per-dancer slip with big athlete
   *      name → per-dancer Darkroom txt with batch-prefixed filename for stack
   *      ordering.
   *   4. Skip ShipStation entirely (Bulk = pickup/drop-off).
   *   5. Mark all items processed; mark order processed in DB and PhotoDay.
   *
   * @param {string} orderNum
   * @param {object} options - { userDownloadPath, reprocess }
   */
  async processBulkOrder(orderNum, options = {}) {
    const localOrder = await orderDatabase.getOrder(orderNum);
    if (!localOrder) throw new Error(`Order ${orderNum} not found`);
    if (localOrder.status !== 'unprocessed' && !options.reprocess) {
      throw new Error(`Order ${orderNum} is already ${localOrder.status}`);
    }

    let order = localOrder.orderData;
    if (!order.isBulkOrder) {
      throw new Error(`Order ${orderNum} is not flagged as a Bulk order — use processOrder instead`);
    }
    if (!Array.isArray(order.groups) || order.groups.length === 0) {
      throw new Error(`Bulk order ${orderNum} has no groups — cannot bucket by dancer`);
    }

    // ─── 1. Download images (with auto-refresh of expired URLs) ──────────
    const dlOptions = {
      ...options,
      downloadPath: options.userDownloadPath || options.downloadPath,
    };
    const dl = await this._downloadWithRefresh(order, dlOptions, localOrder.status);
    const downloadResult = dl.downloadResult;
    order = dl.freshOrder;

    if (downloadResult.errorCount > 0) {
      throw new Error(`Failed to download ${downloadResult.errorCount} of ${downloadResult.totalImages} images for ${orderNum} — asset URLs may have expired and refresh did not resolve them.`);
    }

    // ─── 2. Run imposition for the WHOLE order ─────────────────────────
    // Imposition's _buildContext is now group-aware, so each item's overlay
    // gets the correct athlete name from its group.
    try {
      const impResults = await impositionService.processOrder(order, downloadResult.orderDir);
      const imposedCount = impResults.filter(r => r.imposed).length;
      if (imposedCount > 0) {
        console.log(`[Scheduler-Bulk] Imposition: ${imposedCount} item(s) composed for ${orderNum}`);
      }
    } catch (impErr) {
      console.error(`[Scheduler-Bulk] Imposition error for ${orderNum}: ${impErr.message}`);
    }

    // ─── 3. Bucket items by dancer ───────────────────────────────────────
    // ─── 3. Bucket items by dancer (delegated to bulkOrderService) ──────
    // bulkOrderService.listDancers handles bucketing, sorting, and dancerNum
    // assignment. The same helper is used by the reprint flow so per-dancer
    // numbering and merging behavior stay in lockstep across both paths.
    const sortedDancers = bulkOrderService.listDancers(order);

    // Warn about any items skipped (no matching group / no name)
    const groupedItemIds = new Set(sortedDancers.flatMap(d => d.itemUuids));
    for (const item of order.items || []) {
      if (groupedItemIds.has(item.id)) continue;
      const group = (order.groups || []).find(g => g.id === item.groupId);
      if (!group) {
        console.warn(`[Scheduler-Bulk] Item ${item.id} has groupId=${item.groupId} but no matching group — skipping`);
      } else {
        console.warn(`[Scheduler-Bulk] Group ${group.id} has no first_name/last_name — skipping item ${item.id}`);
      }
    }

    if (sortedDancers.length === 0) {
      throw new Error(`No dancers found in bulk order ${orderNum} — order has groups but no items mapped to them`);
    }

    console.log(`[Scheduler-Bulk] ${orderNum}: ${sortedDancers.length} dancer(s), ${(order.items || []).length} total items`);

    // ─── 5. Resolve slip position once (gallery override > global > 'last' default for Bulk) ──
    // For Bulk, 'last' is the operationally correct default since the slip ends up
    // on top of each dancer's pile when the studio sorts the stack. We still honor
    // explicit gallery/global overrides if set.
    let slipPosition = await this._resolveSlipPosition(order.gallery);
    // If neither gallery nor global is explicitly set, default to 'last' for Bulk
    if (!slipPosition || slipPosition === 'first') {
      // Check if it was explicitly set or just defaulted
      const galleryConfig = await this._getGalleryConfig(order.gallery).catch(() => ({}));
      const explicitGallerySetting = galleryConfig?.packingSlipPosition === 'first' || galleryConfig?.packingSlipPosition === 'last';
      if (!explicitGallerySetting) {
        slipPosition = 'last';
      }
    }

    // ─── 6. Per-dancer processing: slip + Darkroom txt ───────────────────
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const galleryLabel = this._safeName(order.gallery || 'Bulk');
    const batchFiles = [];

    for (const dancer of sortedDancers) {
      const result = await this._processOneDancer(order, dancer, {
        orderDir: downloadResult.orderDir,
        slipPosition,
        batchFilenamePrefix: `BATCH_${ts}_${galleryLabel}`,
      });
      if (result.txtFilePath) batchFiles.push(result.txtFilePath);
    }

    // ─── 7. Mark all items processed ──────────────────────────────────────
    const allItemUuids = (order.items || []).map(i => i.id).filter(Boolean);
    const result = await orderDatabase.markItemsProcessed(orderNum, allItemUuids);
    console.log(`[Scheduler-Bulk] Marked ${allItemUuids.length} items processed for ${orderNum} → status=${result.newStatus}`);

    // ─── 8. PhotoDay: mark order processed (Bulk skips ShipStation entirely) ─
    if (result.allItemsProcessed) {
      try {
        await photodayService.markAsProcessed(orderNum);
        await orderDatabase.updateOrder(orderNum, { photodaySynced: true, downloadPath: downloadResult.orderDir });
      } catch (pdErr) {
        console.warn(`[Scheduler-Bulk] PhotoDay mark processed for ${orderNum}: ${pdErr.message}`);
      }
    }

    return {
      orderNum,
      mode: 'bulk',
      dancersProcessed: sortedDancers.length,
      totalItems: allItemUuids.length,
      batchFiles,
      slipPosition,
      shipstationSkipped: true,
    };
  }

  /**
   * Process one dancer's items: build sub-order → packing slip → Darkroom txt.
   *
   * Used by both processBulkOrder (initial batch) and reprintBulkDancer (reprint).
   * Pure per-dancer concern — does NOT download images, run imposition, mark
   * processed, or talk to PhotoDay. Caller is responsible for those.
   *
   * @param {object} order - Full PDX order (parent bulk order)
   * @param {DancerBucket} dancer - From bulkOrderService.listDancers
   * @param {object} options
   * @param {string}  options.orderDir            - Where imposed images live; slip is also written here
   * @param {string}  options.batchFilenamePrefix - Prefix for txt filename, e.g. "BATCH_<ts>_<gallery>"
   *                                                  or "REPRINT_<ts>". Dancer suffix is appended.
   * @param {string}  [options.slipPosition]      - 'first' | 'last' (forwarded to darkroomService)
   * @param {boolean} [options.skipSlip]          - Skip slip generation (used by single-item reprints)
   * @param {string}  [options.itemId]            - If set, restrict items to just this one
   * @param {string}  [options.logPrefix]         - Log tag, defaults to '[Scheduler-Bulk]'
   * @returns {Promise<{ txtFilePath: string|null, txtFilename: string|null,
   *                     slipFilePath: string|null, dancerNum: string }>}
   */
  async _processOneDancer(order, dancer, options = {}) {
    const logPrefix = options.logPrefix || '[Scheduler-Bulk]';
    const { dancerNum } = dancer;
    const safeLast = this._safeName(dancer.lastName || 'Unknown');
    const safeFirst = this._safeName(dancer.firstName || '');

    // Order num shown on slip: dancer's own when unambiguous, parent bulk num
    // when this dancer's items came in under multiple sub-orders.
    const dancerOrderNum = bulkOrderService.resolveDancerOrderNum(dancer, order.num);

    // Synthetic sub-order: only this dancer's items + groups (and optionally
    // restricted to one item for single-item reprints).
    const subOrder = bulkOrderService.buildSubOrder(order, dancer, { itemId: options.itemId });

    if (!subOrder.items || subOrder.items.length === 0) {
      console.warn(`${logPrefix} No items to process for ${dancer.lastName}, ${dancer.firstName}${options.itemId ? ` (itemId=${options.itemId})` : ''}`);
      return { txtFilePath: null, txtFilename: null, slipFilePath: null, dancerNum };
    }

    // Customer name as a single combined "LastName, FirstName" field — packed
    // into firstName slot with empty lastName so Darkroom displays it as one
    // label that sorts by last name. (See darkroomService customerNameOverride.)
    const customerLine = (dancer.lastName && dancer.firstName)
      ? `${dancer.lastName}, ${dancer.firstName}`
      : (dancer.lastName || dancer.firstName || 'Unknown');
    const customerNameOverride = { firstName: customerLine, lastName: '' };

    // Packing slip — bulk-style "athlete name big" header. Filename is unique
    // per-dancer so concurrent slip writes never overwrite each other.
    let packingSlipPath = null;
    if (!options.skipSlip) {
      const slipFilename = `${dancerNum}_${safeLast}_${safeFirst}_packing_slip.jpg`;
      try {
        const ps = await packingSlipService.generateSlip(subOrder, options.orderDir, {
          athlete: {
            firstName: dancer.firstName,
            lastName: dancer.lastName,
            customerOrderNum: dancerOrderNum,
          },
          filenameOverride: slipFilename,
        });
        packingSlipPath = ps.filePath;
      } catch (psErr) {
        console.error(`${logPrefix} Packing slip error for ${dancer.lastName}, ${dancer.firstName}: ${psErr.message}`);
      }

      // Verify slip is on disk before referencing it from a Darkroom txt.
      if (packingSlipPath) {
        try {
          const exists = await fs.pathExists(packingSlipPath);
          if (!exists) {
            console.error(`${logPrefix} Slip path missing on disk for ${dancer.lastName}, ${dancer.firstName}: ${packingSlipPath} — skipping txt generation`);
            return { txtFilePath: null, txtFilename: null, slipFilePath: null, dancerNum };
          }
        } catch (existsErr) {
          console.error(`${logPrefix} Slip existence check failed for ${dancer.lastName}, ${dancer.firstName}: ${existsErr.message}`);
          return { txtFilePath: null, txtFilename: null, slipFilePath: null, dancerNum };
        }
      }
    }

    // Darkroom txt
    const itemSuffix = options.itemId ? `_item_${options.itemId.slice(0, 8)}` : '';
    const batchFilename = `${options.batchFilenamePrefix}_${dancerNum}-${safeLast}_${safeFirst}${itemSuffix}`;
    try {
      const txtResult = await darkroomService.processOrder(subOrder, {
        orderDir: options.orderDir,
        packingSlipPath,
        slipPosition: options.slipPosition,
        batchFilename,
        customerNameOverride,
      });
      console.log(`${logPrefix} Dancer ${dancerNum} ${dancer.lastName}, ${dancer.firstName} (${subOrder.items.length} items): ${txtResult.filename}`);
      return {
        txtFilePath: txtResult.filePath,
        txtFilename: txtResult.filename,
        slipFilePath: packingSlipPath,
        dancerNum,
      };
    } catch (txtErr) {
      console.error(`${logPrefix} Darkroom txt error for ${dancer.lastName}, ${dancer.firstName}: ${txtErr.message}`);
      return { txtFilePath: null, txtFilename: null, slipFilePath: packingSlipPath, dancerNum };
    }
  }

  /**
   * Reprint a single dancer's order (or one item from it) from a bulk order.
   *
   * Always pulls fresh asset URLs from PhotoDay so the lab gets whatever is
   * currently uploaded — this is the whole point of a reprint, since the
   * studio is typically reprinting because something was fixed/replaced.
   *
   * Reprints write artifacts (images, imposed JPGs, slip, txt) into today's
   * date folder via fileService.getOrderDir, so they never collide with the
   * original batch's outputs and Darkroom picks them up as a fresh batch.
   *
   * @param {string} orderNum   - Parent bulk order number
   * @param {string} dancerKey  - From bulkOrderService.makeDancerKey
   * @param {object} [options]
   * @param {string} [options.itemId]            - If set, reprint only this one item (no slip)
   * @param {string} [options.userDownloadPath]  - Per-user override (from auth profile)
   * @returns {Promise<object>} reprint summary
   */
  async reprintBulkDancer(orderNum, dancerKey, options = {}) {
    const localOrder = await orderDatabase.getOrder(orderNum);
    if (!localOrder) throw new Error(`Order ${orderNum} not found`);
    if (!localOrder.orderData?.isBulkOrder) {
      throw new Error(`Order ${orderNum} is not a bulk order`);
    }

    // ─── 1. Fresh order data from PhotoDay ─────────────────────────────
    // Reprints exist because something needs fixing/replacing — always pull
    // the newest URLs and item data, never serve from stale local cache.
    let order = localOrder.orderData;
    try {
      console.log(`[Reprint-Bulk] Fetching fresh order data from PhotoDay for ${orderNum}...`);
      const freshOrders = await photodayService.getOrders();
      const freshOrder = freshOrders.find(o => o.num === orderNum);
      if (freshOrder) {
        await orderDatabase.saveOrder(freshOrder, localOrder.status);
        order = freshOrder;
        console.log(`[Reprint-Bulk] Updated stored data with fresh URLs`);
      } else {
        console.warn(`[Reprint-Bulk] ${orderNum} not in PhotoDay's queue — using stored data (URLs may have expired)`);
      }
    } catch (fetchErr) {
      console.warn(`[Reprint-Bulk] Could not fetch from PhotoDay: ${fetchErr.message} — using stored data`);
    }

    // ─── 2. Find the dancer ────────────────────────────────────────────
    const dancer = bulkOrderService.getDancerByKey(order, dancerKey);
    if (!dancer) {
      throw new Error(`Dancer "${dancerKey}" not found in order ${orderNum}`);
    }

    // If a specific item was requested, validate it belongs to this dancer
    if (options.itemId) {
      const owned = dancer.items.some(i => i.id === options.itemId);
      if (!owned) {
        throw new Error(`Item ${options.itemId} does not belong to dancer ${dancer.lastName}, ${dancer.firstName}`);
      }
    }

    // ─── 3. Resolve target dir ──────────────────────────────────────────
    // Reprints go into today's date folder, not the original batch's folder.
    // Honors userDownloadPath the same way as initial processing.
    const subOrder = bulkOrderService.buildSubOrder(order, dancer, { itemId: options.itemId });
    const orderDir = await fileService.getOrderDir(subOrder, {
      downloadPath: options.userDownloadPath || null,
    });
    await fs.ensureDir(orderDir);
    console.log(`[Reprint-Bulk] Output dir: ${orderDir}`);

    // ─── 4. Download fresh images for just this dancer's items ─────────
    // Pass the synthetic sub-order so we don't redownload all 408 items.
    // _downloadWithRefresh handles the URL-refresh retry loop too.
    const dlOptions = {
      downloadPath: options.userDownloadPath || null,
      forceRedownload: true,
    };
    const dl = await this._downloadWithRefresh(subOrder, dlOptions, localOrder.status);
    if (dl.downloadResult.errorCount > 0) {
      throw new Error(`Failed to download ${dl.downloadResult.errorCount} of ${dl.downloadResult.totalImages} images for reprint`);
    }
    // _downloadWithRefresh may give us back a refreshed full order; re-derive
    // the dancer/sub-order from that so we're working with the freshest data.
    const finalOrder = dl.freshOrder || order;
    const finalDancer = bulkOrderService.getDancerByKey(finalOrder, dancerKey) || dancer;

    // ─── 5. Re-impose this dancer's items ───────────────────────────────
    const subOrderForImposition = bulkOrderService.buildSubOrder(finalOrder, finalDancer, { itemId: options.itemId });
    try {
      const impResults = await impositionService.processOrder(subOrderForImposition, dl.downloadResult.orderDir || orderDir);
      const imposedCount = impResults.filter(r => r.imposed).length;
      console.log(`[Reprint-Bulk] Imposition: ${imposedCount} item(s) composed`);
    } catch (impErr) {
      console.error(`[Reprint-Bulk] Imposition error: ${impErr.message}`);
    }

    // ─── 6. Slip + Darkroom txt via shared helper ───────────────────────
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slipPosition = await this._resolveSlipPosition(finalOrder.gallery);
    const result = await this._processOneDancer(finalOrder, finalDancer, {
      orderDir: dl.downloadResult.orderDir || orderDir,
      slipPosition,
      batchFilenamePrefix: `REPRINT_${ts}`,
      skipSlip: !!options.itemId, // single-item reprints get no slip (matches existing /reprint-item behavior)
      itemId: options.itemId || null,
      logPrefix: '[Reprint-Bulk]',
    });

    return {
      orderNum,
      dancerKey,
      dancerNum: finalDancer.dancerNum,
      dancerName: `${finalDancer.lastName}, ${finalDancer.firstName}`,
      mode: options.itemId ? 'reprint-item' : 'reprint-dancer',
      itemId: options.itemId || null,
      txtFile: result.txtFilename,
      txtFilePath: result.txtFilePath,
      slipFilePath: result.slipFilePath,
      orderDir: dl.downloadResult.orderDir || orderDir,
    };
  }

}

module.exports = new SchedulerService();
