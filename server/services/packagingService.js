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

        // Magnet threshold: this many or more magnet sets forces PACKAGE
        magnetPackageThreshold: 3,
        magnetSKU: '15',

        // Framed pano SKUs (to be configured when new SKUs are added)
        framedPanoSmallSKUs: [],  // e.g. ['34'] for framed 8x24
        framedPanoLargeSKUs: [],  // e.g. ['37'] for framed 10x30
      };

      fs.writeJsonSync(CONFIG_PATH, defaultConfig, { spaces: 2 });
    }
  }

  // ─── CONFIG MANAGEMENT ──────────────────────────────────

  async getConfig() {
    return fs.readJson(CONFIG_PATH);
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
   * Returns: { packageType, dimensions, weight, serviceCode, packageCode, carrierCode, notes }
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
      return this._buildResult('flat_9x11', config, 4, ['Digital-only order, using default flat']);
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

    // ─── Determine packaging type (priority order) ────────

    // 1. Framed Large Pano (10x30)
    const hasFramedLargePano = (config.framedPanoLargeSKUs || []).some(s => skuSet.has(s));
    if (hasFramedLargePano) {
      notes.push('Framed 10x30 Pano detected');
      return this._buildResult('pano_frame_lg', config, totalWeight, notes);
    }

    // 2. Framed Small Pano (8x24)
    const hasFramedSmallPano = (config.framedPanoSmallSKUs || []).some(s => skuSet.has(s));
    if (hasFramedSmallPano) {
      notes.push('Framed 8x24 Pano detected');
      return this._buildResult('pano_frame_sm', config, totalWeight, notes);
    }

    // 3. Has Coffee Mug
    const hasMug = skuSet.has('20');
    if (hasMug) {
      const otherPhysical = physicalItems.filter(i => String(i.externalId) !== '20' && (config.productWeights[String(i.externalId)]?.category !== 'digital'));
      if (otherPhysical.length === 0 || (otherPhysical.length === 1 && config.productWeights[String(otherPhysical[0].externalId)]?.category === 'digital')) {
        notes.push('Coffee Mug alone → Small Box');
        return this._buildResult('small_box', config, totalWeight, notes);
      } else {
        notes.push('Coffee Mug + other items → Large Box');
        return this._buildResult('large_box', config, totalWeight, notes);
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
        return this._buildResult('pano_tube', config, totalWeight, notes);
      } else {
        notes.push('Pano + other items → Medium Box');
        return this._buildResult('medium_box', config, totalWeight, notes);
      }
    }

    // 5. Has Plaque (21 or 22)
    if (skuSet.has('21') || skuSet.has('22')) {
      notes.push('Plaque item → Medium Box');
      return this._buildResult('medium_box', config, totalWeight, notes);
    }

    // 6. Has Mouse Pad (19) — goes in medium box
    if (skuSet.has('19')) {
      notes.push('Mouse Pad → Medium Box');
      return this._buildResult('medium_box', config, totalWeight, notes);
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

    // Check magnet threshold
    const magnetSKU = config.magnetSKU || '15';
    const magnetCount = skuMap[magnetSKU] || 0;
    if (magnetCount >= (config.magnetPackageThreshold || 3)) {
      notes.push(`${magnetCount} magnet sets (≥${config.magnetPackageThreshold}) → Package service`);
      forcePackage = true;
    }

    // If forced to package but no box trigger, use 9x11 as package
    if (forcePackage) {
      notes.push('Using 9x11 as Package');
      const result = this._buildResult('flat_9x11', config, totalWeight, notes);
      // Override service to package
      result.serviceCode = this._getServiceCode(totalWeight, 'package');
      result.packageCode = 'package';
      // Set height to 0.5 for package mailer
      result.dimensions.height = 0.5;
      return result;
    }

    // ─── Default: Flat mailer based on largest item ────────
    // Check if any item is larger than 5x7
    let hasLargeItem = false;
    for (const item of physicalItems) {
      const sku = String(item.externalId || '');
      const pw = config.productWeights[sku];
      // Items with SKUs 6, 8, 9, 22 are 8x10 size
      if (['6', '8', '9', '22'].includes(sku)) {
        hasLargeItem = true;
      }
      // Package bundles contain 8x10 items
      if (config.packageBundles[sku]) {
        hasLargeItem = true;
      }
    }

    if (hasLargeItem) {
      notes.push('Has 8x10+ items → 9x11 Flat Mailer');
      return this._buildResult('flat_9x11', config, totalWeight, notes);
    }

    // Check if all items fit in 6x8
    notes.push('All items ≤ 5x7 → 6x8 Flat Mailer');
    return this._buildResult('flat_6x8', config, totalWeight, notes);
  }

  /**
   * Build the result object from a packaging type.
   */
  _buildResult(packageTypeId, config, itemWeight, notes) {
    const pkgType = config.packagingTypes[packageTypeId];
    if (!pkgType) {
      return {
        packageType: 'flat_9x11',
        packageTypeName: 'Default 9x11 Flat',
        dimensions: { length: 9, width: 11, height: 0.5, units: 'inches' },
        weight: { value: Math.ceil(itemWeight + 2), units: 'ounces' },
        carrierCode: 'stamps_com',
        serviceCode: 'usps_first_class_mail',
        packageCode: 'large_envelope_or_flat',
        notes,
      };
    }

    const totalWeight = Math.ceil(itemWeight + (pkgType.baseWeight || 0));
    const serviceCode = this._getServiceCode(totalWeight, pkgType.service);
    const carrierCode = this._getCarrierCode(totalWeight, packageTypeId);

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
