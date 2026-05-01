const fs = require('fs-extra');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'packaging-config.json');

/**
 * Packaging Rules Engine
 *
 * Determines packaging type, dimensions, weight, and USPS service
 * based on order contents. Rules are configurable via the Settings UI.
 */
class PackagingService {

  constructor() {
    this._ensureConfig();
  }

  _ensureConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
      const defaultConfig = {
        // Product weight table: externalId → weight in ounces
        productWeights: {
          '6':  { weight: 1.5, name: 'Memory Mate',          category: 'flat' },
          '8':  { weight: 1.5, name: '8x10 Individual',      category: 'flat' },
          '9':  { weight: 1.5, name: '8x10 Team Photo',      category: 'flat' },
          '10': { weight: 0.5, name: '5x7 Individual Print',  category: 'flat' },
          '11': { weight: 0.5, name: '5x7 Team Photo',        category: 'flat' },
          '12': { weight: 0.5, name: '8 Wallets',             category: 'flat' },
          '13': { weight: 0.5, name: 'Collector Cards',       category: 'rigid' },
          '15': { weight: 0.5, name: '2 Large Magnets',       category: 'flat' },
          '16': { weight: 1.0, name: 'Photo Button',          category: 'rigid' },
          '17': { weight: 0.5, name: '4 Mini Magnets',        category: 'flat' },
          '19': { weight: 4.0, name: 'Mouse Pad',             category: 'rigid' },
          '20': { weight: 12.0, name: 'Coffee Mug',           category: 'bulky' },
          '21': { weight: 6.0, name: '5x7 Plaque',            category: 'rigid' },
          '22': { weight: 8.0, name: '8x10 Plaque',           category: 'rigid' },
          '25': { weight: 0.0, name: 'Digital Download',       category: 'digital' },
          '27': { weight: 0.5, name: '4-3.5x5 Prints',        category: 'flat' },
          '32': { weight: 3.0, name: '8x24 Pano',             category: 'pano' },
          '33': { weight: 4.0, name: '10x30 Pano',            category: 'pano' },
          '7':  { weight: 1.0, name: 'Key Chain',             category: 'rigid' },
          '18': { weight: 0.5, name: 'Bagtag',                category: 'flat' },
          '35': { weight: 1.0, name: 'Trading Cards',         category: 'rigid' },
          '36': { weight: 1.0, name: 'Item 36',               category: 'flat' },
          '45': { weight: 1.0, name: 'Item 45',               category: 'flat' },
        },

        // Package bundles: externalId → expanded item list for weight calculation
        packageBundles: {
          '1': { name: 'Gold Package', weight: 8.0, forcePackage: true },
          '2': { name: 'Silver Package', weight: 6.0, forcePackage: false },
          '3': { name: 'Bronze Package', weight: 2.0, forcePackage: false },
        },

        // Packaging types with dimensions
        packagingTypes: {
          'flat_6x8':      { name: '6x8 Flat Mailer',     length: 6,  width: 8,  height: 0.5, baseWeight: 1, service: 'large_envelope_or_flat' },
          'flat_9x11':     { name: '9x11 Flat Mailer',    length: 9,  width: 11, height: 0.5, baseWeight: 2, service: 'large_envelope_or_flat' },
          'pano_tube':     { name: 'Pano Tube',           length: 12, width: 2,  height: 2,   baseWeight: 3, service: 'package' },
          'small_box':     { name: 'Small Box',           length: 6,  width: 6,  height: 6,   baseWeight: 4, service: 'package' },
          'medium_box':    { name: 'Medium Box',          length: 12, width: 10, height: 2,   baseWeight: 4, service: 'package' },
          'pano_frame_sm': { name: '8x24 Pano Frame',     length: 26, width: 10, height: 2,   baseWeight: 8, service: 'package' },
          'pano_frame_lg': { name: '10x30 Pano Frame',    length: 31, width: 11, height: 2,   baseWeight: 10, service: 'package' },
          'large_box':     { name: 'Large Box',           length: 14, width: 10, height: 6,   baseWeight: 6, service: 'package' },
        },

        // SKUs that force PACKAGE service (not flat envelope)
        forcePackageSKUs: ['13', '16', '7', '32', '33', '21', '22', '19', '20', '35'],

        // Magnet threshold: combined count of any listed SKU that forces PACKAGE service.
        // The total count across all listed SKUs is compared against the threshold.
        // Example: skus ['15','17'] with threshold 3 fires for 1×15 + 2×17, 3×15, 5×17, etc.
        magnetThreshold: {
          skus: ['15'],
          threshold: 3,
        },

        // Framed pano SKUs (to be configured when new SKUs are added)
        framedPanoSmallSKUs: [],  // e.g. ['34'] for framed 8x24
        framedPanoLargeSKUs: [],  // e.g. ['37'] for framed 10x30

        // Weight in oz of the 5x8 packing slip included with every order.
        // Default 0.4oz (typical 250gsm photo paper). Adjust if you use heavier/lighter stock.
        packingSlipWeightOz: 0.4,
      };

      fs.writeJsonSync(CONFIG_PATH, defaultConfig, { spaces: 2 });
    }
  }

  // ─── CONFIG MANAGEMENT ──────────────────────────────────

  async getConfig() {
    const config = await fs.readJson(CONFIG_PATH);
    return this._migrateConfig(config);
  }

  /**
   * Apply backward-compatible migrations to a loaded config.
   * Returns the (possibly modified) config object. Persists to disk if changed.
   */
  _migrateConfig(config) {
    let dirty = false;

    // Migrate old magnetSKU + magnetPackageThreshold → magnetThreshold { skus, threshold }
    if (!config.magnetThreshold && (config.magnetSKU || config.magnetPackageThreshold)) {
      config.magnetThreshold = {
        skus: config.magnetSKU ? [String(config.magnetSKU)] : ['15'],
        threshold: config.magnetPackageThreshold || 3,
      };
      delete config.magnetSKU;
      delete config.magnetPackageThreshold;
      dirty = true;
    }
    // Defensive: ensure required substructure exists even on partial configs
    if (!config.magnetThreshold) {
      config.magnetThreshold = { skus: ['15'], threshold: 3 };
      dirty = true;
    }
    if (!Array.isArray(config.magnetThreshold.skus)) {
      config.magnetThreshold.skus = [];
      dirty = true;
    }

    if (dirty) {
      // Fire-and-forget write — if it fails, we still return the in-memory migrated copy
      fs.writeJson(CONFIG_PATH, config, { spaces: 2 }).catch(err => {
        console.warn('[PackagingService] Migration write failed:', err.message);
      });
    }
    return config;
  }

  async updateConfig(updates) {
    const config = await this.getConfig();
    Object.assign(config, updates);
    await fs.writeJson(CONFIG_PATH, config, { spaces: 2 });
    return config;
  }

  async getProductWeights() {
    const config = await this.getConfig();
    return config.productWeights || {};
  }

  async setProductWeight(externalId, data) {
    const config = await this.getConfig();
    config.productWeights[String(externalId)] = {
      weight: parseFloat(data.weight) || 0,
      name: data.name || '',
      category: data.category || 'flat',
    };
    await fs.writeJson(CONFIG_PATH, config, { spaces: 2 });
    return config.productWeights;
  }

  async deleteProductWeight(externalId) {
    const config = await this.getConfig();
    delete config.productWeights[String(externalId)];
    await fs.writeJson(CONFIG_PATH, config, { spaces: 2 });
    return config.productWeights;
  }

  async getPackagingTypes() {
    const config = await this.getConfig();
    return config.packagingTypes || {};
  }

  // ─── PACKAGING RULES ENGINE ─────────────────────────────

  /**
   * Determine packaging for a PDX order.
   *
   * Returns: { packageType, dimensions, weight, serviceCode, packageCode, carrierCode, notes, itemWeights }
   *
   * itemWeights is a map keyed by item id → weight in oz for that line item (qty × unit weight).
   * The packaging baseWeight is added to the first non-digital line item so the sum matches the
   * order-level weight. This is needed because ShipStation sums line-item weights and uses that
   * total over the order-level weight when product records exist with default weights.
   */
  async determinePackaging(pdxOrder) {
    const config = await this.getConfig();
    const items = pdxOrder.items || [];

    // Ignore digital-only items
    const physicalItems = items.filter(item => {
      const pw = config.productWeights[String(item.externalId)];
      return !pw || pw.category !== 'digital';
    });

    if (physicalItems.length === 0) {
      return this._buildResult('flat_9x11', config, 4, ['Digital-only order, using default flat'], pdxOrder);
    }

    // Collect all SKUs with quantities
    const skuMap = {};
    for (const item of physicalItems) {
      const sku = String(item.externalId || '');
      skuMap[sku] = (skuMap[sku] || 0) + (item.quantity || 1);
    }
    const skuSet = new Set(Object.keys(skuMap));

    const notes = [];

    // ─── Calculate total weight ───────────────────────────
    let totalWeight = 0;
    for (const item of physicalItems) {
      const sku = String(item.externalId || '');
      const qty = item.quantity || 1;

      // Check if it's a package bundle
      const bundle = config.packageBundles[sku];
      if (bundle) {
        totalWeight += (bundle.weight || 0) * qty;
      } else {
        const pw = config.productWeights[sku];
        totalWeight += (pw?.weight || 1) * qty;
      }
    }

    // Every order ships with a 5x8 packing slip on photo paper.
    // Add its weight so the total reflects what's actually in the package.
    const packingSlipWeightOz = config.packingSlipWeightOz ?? 0.4;
    if (packingSlipWeightOz > 0) {
      totalWeight += packingSlipWeightOz;
      notes.push(`+${packingSlipWeightOz}oz packing slip`);
    }

    // ─── Determine packaging type (priority order) ────────

    // 1. Framed Large Pano (10x30)
    const hasFramedLargePano = (config.framedPanoLargeSKUs || []).some(s => skuSet.has(s));
    if (hasFramedLargePano) {
      notes.push('Framed 10x30 Pano detected');
      return this._buildResult('pano_frame_lg', config, totalWeight, notes, pdxOrder);
    }

    // 2. Framed Small Pano (8x24)
    const hasFramedSmallPano = (config.framedPanoSmallSKUs || []).some(s => skuSet.has(s));
    if (hasFramedSmallPano) {
      notes.push('Framed 8x24 Pano detected');
      return this._buildResult('pano_frame_sm', config, totalWeight, notes, pdxOrder);
    }

    // 3. Has Coffee Mug
    const hasMug = skuSet.has('20');
    if (hasMug) {
      const otherPhysical = physicalItems.filter(i => String(i.externalId) !== '20' && (config.productWeights[String(i.externalId)]?.category !== 'digital'));
      if (otherPhysical.length === 0 || (otherPhysical.length === 1 && config.productWeights[String(otherPhysical[0].externalId)]?.category === 'digital')) {
        notes.push('Coffee Mug alone → Small Box');
        return this._buildResult('small_box', config, totalWeight, notes, pdxOrder);
      } else {
        notes.push('Coffee Mug + other items → Large Box');
        return this._buildResult('large_box', config, totalWeight, notes, pdxOrder);
      }
    }

    // 4. Has Pano (32 or 33)
    const hasPano32 = skuSet.has('32');
    const hasPano33 = skuSet.has('33');
    const hasPano = hasPano32 || hasPano33;

    if (hasPano) {
      // Check if pano is alone (only other items are digital or pano)
      const nonPanoPhysical = physicalItems.filter(i => {
        const sku = String(i.externalId);
        const pw = config.productWeights[sku];
        return sku !== '32' && sku !== '33' && sku !== '25' && pw?.category !== 'digital';
      });

      if (nonPanoPhysical.length === 0) {
        notes.push('Pano alone → Pano Tube');
        return this._buildResult('pano_tube', config, totalWeight, notes, pdxOrder);
      } else {
        notes.push('Pano + other items → Medium Box');
        return this._buildResult('medium_box', config, totalWeight, notes, pdxOrder);
      }
    }

    // 5. Has Plaque (21 or 22)
    if (skuSet.has('21') || skuSet.has('22')) {
      notes.push('Plaque item → Medium Box');
      return this._buildResult('medium_box', config, totalWeight, notes, pdxOrder);
    }

    // 6. Has Mouse Pad (19) — goes in medium box
    if (skuSet.has('19')) {
      notes.push('Mouse Pad → Medium Box');
      return this._buildResult('medium_box', config, totalWeight, notes, pdxOrder);
    }

    // ─── Determine service type (flat vs package) ─────────

    // Check if any SKU forces package service
    let forcePackage = false;
    for (const sku of skuSet) {
      if ((config.forcePackageSKUs || []).includes(sku)) {
        const pw = config.productWeights[sku];
        notes.push(`SKU ${sku} (${pw?.name || 'unknown'}) forces Package service`);
        forcePackage = true;
      }
      // Check package bundles
      const bundle = config.packageBundles[sku];
      if (bundle?.forcePackage) {
        notes.push(`${bundle.name} (SKU ${sku}) forces Package service`);
        forcePackage = true;
      }
    }

    // Check magnet threshold — combined count across all listed magnet SKUs
    const magnetRule = config.magnetThreshold || { skus: [], threshold: Infinity };
    const magnetSkus = Array.isArray(magnetRule.skus) ? magnetRule.skus.map(String) : [];
    const magnetThreshold = magnetRule.threshold || 0;
    if (magnetSkus.length > 0 && magnetThreshold > 0) {
      const combinedMagnetCount = magnetSkus.reduce((sum, sku) => sum + (skuMap[sku] || 0), 0);
      if (combinedMagnetCount >= magnetThreshold) {
        notes.push(`${combinedMagnetCount} magnet set(s) across [${magnetSkus.join(', ')}] (≥${magnetThreshold}) → Package service`);
        forcePackage = true;
      }
    }

    // If forced to package but no box trigger, use 9x11 as package
    if (forcePackage) {
      notes.push('Using 9x11 as Package');
      const result = this._buildResult('flat_9x11', config, totalWeight, notes, pdxOrder);
      // Override service to package
      result.serviceCode = this._getServiceCode(totalWeight, 'package');
      result.packageCode = 'package';
      // Set height to 0.5 for package mailer
      result.dimensions.height = 0.5;
      return result;
    }

    // ─── Default: Flat mailer based on largest item ────────
    // Determine each item's effective print size by consulting the imposition engine.
    // If an item is imposed onto a sheet larger than 6×8, it needs a 9×11 mailer.
    // Items without an imposition layout fall back to the SKU heuristic
    // (since 8×10 individual prints, memory mates etc. aren't imposed but are still 8×10).
    const FLAT_6X8_MAX_DIM = 8;     // longest side that fits in a 6x8 mailer
    const FLAT_6X8_SHORT_DIM = 6;   // shorter side
    let hasLargeItem = false;
    let largeReason = '';

    let impositionService;
    try {
      impositionService = require('./impositionService');
    } catch (e) {
      // Imposition service unreachable — fall back to SKU heuristic only
      impositionService = null;
    }

    for (const item of physicalItems) {
      const sku = String(item.externalId || '');

      // First, ask the imposition engine for this SKU's actual sheet size
      let layout = null;
      if (impositionService) {
        try {
          layout = await impositionService.findRule(sku);
        } catch (e) { /* missing/corrupt layouts file — fall through */ }
      }

      if (layout) {
        const longSide = Math.max(layout.sheetWidth || 0, layout.sheetHeight || 0);
        const shortSide = Math.min(layout.sheetWidth || 0, layout.sheetHeight || 0);
        // Won't fit in a 6×8 if either dimension exceeds the mailer
        if (longSide > FLAT_6X8_MAX_DIM || shortSide > FLAT_6X8_SHORT_DIM) {
          hasLargeItem = true;
          largeReason = `SKU ${sku} imposed on ${layout.sheetWidth}x${layout.sheetHeight} sheet`;
          break;
        }
        continue; // imposition layout fits in 6x8, no need to check the SKU list
      }

      // No imposition layout — fall back to the SKU heuristic for known 8×10-size products
      if (['6', '8', '9', '22'].includes(sku)) {
        hasLargeItem = true;
        largeReason = `SKU ${sku} is an 8x10-size product`;
        break;
      }
      // Package bundles contain 8×10 items
      if (config.packageBundles[sku]) {
        hasLargeItem = true;
        largeReason = `SKU ${sku} (${config.packageBundles[sku].name}) bundle contains 8x10 items`;
        break;
      }
    }

    if (hasLargeItem) {
      notes.push(`${largeReason} → 9x11 Flat Mailer`);
      return this._buildResult('flat_9x11', config, totalWeight, notes, pdxOrder);
    }

    // Check if all items fit in 6x8
    notes.push('All items fit in 6x8 → 6x8 Flat Mailer');
    return this._buildResult('flat_6x8', config, totalWeight, notes, pdxOrder);
  }

  /**
   * Build per-item weight map.
   *
   * The packaging baseWeight + any ceiling rounding gets rolled onto the first non-digital
   * line item so the sum of item weights equals targetTotalOz exactly. This matters because
   * ShipStation sums line-item weights and replaces the order weight with that sum when
   * Product Defaults are set on any line-item SKU.
   *
   * Returns: { items: [{ lineItemKey, sku, weightOz }], totalOz }
   */
  _buildItemWeights(pdxOrder, config, targetTotalOz) {
    const items = pdxOrder?.items || [];
    const result = [];
    let firstPhysicalIndex = -1;
    let physicalSubtotal = 0;

    for (const item of items) {
      const sku = String(item.externalId || '');
      const qty = item.quantity || 1;
      const lineItemKey = String(item.id || '');
      const pw = config.productWeights[sku];
      const bundle = config.packageBundles[sku];

      // Digital items get 0 weight
      if (pw?.category === 'digital') {
        result.push({ lineItemKey, sku, weightOz: 0 });
        continue;
      }

      let unitWeight;
      if (bundle) {
        unitWeight = bundle.weight || 0;
      } else {
        unitWeight = pw?.weight ?? 1; // default 1oz when unknown
      }

      const lineWeight = unitWeight * qty;
      if (firstPhysicalIndex === -1) firstPhysicalIndex = result.length;
      physicalSubtotal += lineWeight;
      result.push({ lineItemKey, sku, weightOz: lineWeight });
    }

    // Add the remainder (baseWeight + ceiling rounding) onto the first physical item
    // so the sum of all per-item weights == targetTotalOz exactly.
    if (firstPhysicalIndex >= 0) {
      const remainder = targetTotalOz - physicalSubtotal;
      if (remainder > 0) result[firstPhysicalIndex].weightOz += remainder;
    }

    const totalOz = result.reduce((s, r) => s + r.weightOz, 0);
    return { items: result, totalOz };
  }

  /**
   * Build the result object from a packaging type.
   */
  _buildResult(packageTypeId, config, itemWeight, notes, pdxOrder) {
    const pkgType = config.packagingTypes[packageTypeId];
    if (!pkgType) {
      const fallbackTotal = Math.ceil(itemWeight + 2);
      const itemWeightInfo = this._buildItemWeights(pdxOrder, config, fallbackTotal);
      return {
        packageType: 'flat_9x11',
        packageTypeName: 'Default 9x11 Flat',
        dimensions: { length: 9, width: 11, height: 0.5, units: 'inches' },
        weight: { value: fallbackTotal, units: 'ounces' },
        carrierCode: 'stamps_com',
        serviceCode: 'usps_first_class_mail',
        packageCode: 'large_envelope_or_flat',
        notes,
        itemWeights: itemWeightInfo.items,
      };
    }

    const baseWeight = pkgType.baseWeight || 0;
    const totalWeight = Math.ceil(itemWeight + baseWeight);
    const serviceCode = this._getServiceCode(totalWeight, pkgType.service);
    const carrierCode = this._getCarrierCode(totalWeight, packageTypeId);

    // Per-item weights — packaging baseWeight + ceiling rounding rolls onto first physical
    // item. The sum equals totalWeight exactly so ShipStation displays the right total
    // even when its product-default weight rules are summing line items.
    const itemWeightInfo = this._buildItemWeights(pdxOrder, config, totalWeight);

    return {
      packageType: packageTypeId,
      packageTypeName: pkgType.name,
      dimensions: {
        length: pkgType.length,
        width: pkgType.width,
        height: pkgType.height,
        units: 'inches',
      },
      weight: {
        value: totalWeight,
        units: 'ounces',
      },
      carrierCode,
      serviceCode,
      packageCode: pkgType.service === 'large_envelope_or_flat' ? 'large_envelope_or_flat' : 'package',
      notes,
      itemWeights: itemWeightInfo.items,
    };
  }

  /**
   * Determine USPS service code based on weight.
   */
  _getServiceCode(weightOz, defaultService) {
    if (weightOz > 16) {
      return 'usps_ground_advantage';
    }
    if (weightOz > 13) {
      return 'usps_ground_advantage';
    }
    if (defaultService === 'package') {
      return 'usps_first_class_mail';
    }
    return 'usps_first_class_mail';
  }

  /**
   * Determine carrier based on weight and package type.
   */
  _getCarrierCode(weightOz, packageTypeId) {
    // Framed panos always go UPS
    if (packageTypeId === 'pano_frame_sm' || packageTypeId === 'pano_frame_lg') {
      return 'ups_walleted';
    }
    // Very heavy packages go UPS
    if (weightOz > 48) {
      return 'ups_walleted';
    }
    return 'stamps_com';
  }
}

module.exports = new PackagingService();
