const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const photodayService = require('./photodayService');
const specialtyService = require('./specialtyService');

class DarkroomService {
  constructor() {
    this.mappingFilePath = path.join(__dirname, '..', 'config', 'template-mappings.json');
    this.fileNameConfigPath = path.join(__dirname, '..', 'config', 'filename-config.json');
    this.sizeMappingPath = path.join(__dirname, '..', 'config', 'size-mappings.json');
    this._ensureConfigFiles();
  }

  _ensureConfigFiles() {
    if (!fs.existsSync(this.mappingFilePath)) {
      fs.writeJsonSync(this.mappingFilePath, { mappings: [] }, { spaces: 2 });
    }
    if (!fs.existsSync(this.fileNameConfigPath)) {
      fs.writeJsonSync(this.fileNameConfigPath, {
        pattern: '{order_number}',
        extension: '.txt',
      }, { spaces: 2 });
    }
    if (!fs.existsSync(this.sizeMappingPath)) {
      fs.writeJsonSync(this.sizeMappingPath, { mappings: [] }, { spaces: 2 });
    }
  }

  // ─── SIZE MAPPINGS (externalId → print size) ───────────────

  async getSizeMappings() {
    const data = await fs.readJson(this.sizeMappingPath);
    return data.mappings || [];
  }

  async addSizeMapping(mapping) {
    const data = await fs.readJson(this.sizeMappingPath);
    const existing = data.mappings.find(m => m.externalId === String(mapping.externalId));
    if (existing) {
      throw new Error(`Size mapping already exists for externalId "${mapping.externalId}". Delete it first.`);
    }
    data.mappings.push({
      externalId: String(mapping.externalId),
      size: mapping.size,
      productName: mapping.productName || '',
    });
    await fs.writeJson(this.sizeMappingPath, data, { spaces: 2 });
    return data.mappings;
  }

  async deleteSizeMapping(externalId) {
    const data = await fs.readJson(this.sizeMappingPath);
    data.mappings = data.mappings.filter(m => m.externalId !== String(externalId));
    await fs.writeJson(this.sizeMappingPath, data, { spaces: 2 });
    return data.mappings;
  }

  /**
   * Look up the print size for an item by externalId.
   * Falls back to parsing the description if no mapping exists.
   */
  async _getSize(item) {
    // 1. Check size mappings first
    const mappings = await this.getSizeMappings();
    const match = mappings.find(m => m.externalId === String(item.externalId || ''));
    if (match) return match.size;

    // 2. Fall back to parsing description
    const desc = item.description || '';
    const sizeMatch = desc.match(/(\d+\.?\d*)\s*x\s*(\d+\.?\d*)/i);
    if (sizeMatch) return `${sizeMatch[1]}x${sizeMatch[2]}`;

    return '0x0';
  }

  // ─── TEMPLATE MAPPINGS ────────────────────────────────────

  async getMappings() {
    const data = await fs.readJson(this.mappingFilePath);
    return data.mappings || [];
  }

  async addMapping(mapping) {
    const data = await fs.readJson(this.mappingFilePath);
    const existing = data.mappings.find(
      (m) => m.productName === mapping.productName && m.externalId === mapping.externalId
    );
    if (existing) {
      throw new Error(`Mapping already exists for "${mapping.productName}"`);
    }
    data.mappings.push({
      id: require('uuid').v4(),
      productName: mapping.productName,
      externalId: mapping.externalId || null,
      size: mapping.size || null,
      templatePath: mapping.templatePath,
      createdAt: new Date().toISOString(),
    });
    await fs.writeJson(this.mappingFilePath, data, { spaces: 2 });
    return data.mappings;
  }

  async updateMapping(id, updates) {
    const data = await fs.readJson(this.mappingFilePath);
    const index = data.mappings.findIndex((m) => m.id === id);
    if (index === -1) throw new Error('Mapping not found');
    data.mappings[index] = { ...data.mappings[index], ...updates, updatedAt: new Date().toISOString() };
    await fs.writeJson(this.mappingFilePath, data, { spaces: 2 });
    return data.mappings[index];
  }

  async deleteMapping(id) {
    const data = await fs.readJson(this.mappingFilePath);
    data.mappings = data.mappings.filter((m) => m.id !== id);
    await fs.writeJson(this.mappingFilePath, data, { spaces: 2 });
    return data.mappings;
  }

  /**
   * Find template for a product by externalId first, then description/name.
   */
  async findTemplate(item) {
    const mappings = await this.getMappings();

    // Try exact match on externalId (SKU)
    if (item.externalId) {
      const match = mappings.find(m => m.externalId === item.externalId);
      if (match) return match.templatePath;
    }

    // Try match on product description
    if (item.description) {
      let match = mappings.find(m => m.productName === item.description);
      if (match) return match.templatePath;

      // Partial match
      match = mappings.find(m =>
        item.description.toLowerCase().includes(m.productName.toLowerCase())
      );
      if (match) return match.templatePath;
    }

    return null;
  }

  // ─── FILENAME CONFIG ──────────────────────────────────────

  async getFileNameConfig() {
    return fs.readJson(this.fileNameConfigPath);
  }

  async updateFileNameConfig(config) {
    await fs.writeJson(this.fileNameConfigPath, config, { spaces: 2 });
    return config;
  }

  async generateFileName(orderData) {
    const fnConfig = await this.getFileNameConfig();
    let filename = fnConfig.pattern;

    const tokens = {
      '{order_number}': orderData.orderNum || '',
      '{first_name}': orderData.firstName || '',
      '{last_name}': orderData.lastName || '',
      '{gallery}': orderData.gallery || '',
      '{date}': new Date().toISOString().split('T')[0],
    };

    for (const [token, value] of Object.entries(tokens)) {
      filename = filename.replace(new RegExp(token.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    filename = filename.replace(/[<>:"/\\|?*]/g, '_');
    return filename + (fnConfig.extension || '.txt');
  }

  /**
   * Wait until every referenced file path is fully written and stable.
   *
   * "Stable" means the file exists and its size doesn't change between two
   * stat() calls separated by `pollIntervalMs`. This catches the race where
   * Darkroom would otherwise open an image that's still being flushed to a
   * network share.
   *
   * @param {string[]} filePaths
   * @param {object} opts - { timeoutMs, pollIntervalMs, warnAfterMs }
   * @returns {{ stable: boolean, elapsedMs: number, missing: string[], unstable: string[] }}
   */
  async _waitForFilesStable(filePaths, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 30000;
    const pollIntervalMs = opts.pollIntervalMs ?? 250;
    const warnAfterMs = opts.warnAfterMs ?? 5000;
    const start = Date.now();

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const dedup = Array.from(new Set(filePaths.filter(Boolean)));

    let missing = [];
    let unstable = [];
    let warned = false;

    while (Date.now() - start < timeoutMs) {
      missing = [];
      unstable = [];

      // First pass: stat every file
      const sizes = {};
      for (const p of dedup) {
        try {
          const s = await fs.stat(p);
          sizes[p] = s.size;
        } catch (err) {
          missing.push(p);
        }
      }

      if (missing.length === 0) {
        // Second pass after a short delay — if sizes are unchanged, files are stable
        await sleep(pollIntervalMs);
        let allStable = true;
        for (const p of dedup) {
          try {
            const s = await fs.stat(p);
            if (s.size !== sizes[p]) {
              unstable.push(p);
              allStable = false;
            }
          } catch (err) {
            missing.push(p);
            allStable = false;
          }
        }
        if (allStable) {
          const elapsedMs = Date.now() - start;
          return { stable: true, elapsedMs, missing: [], unstable: [] };
        }
      }

      const elapsed = Date.now() - start;
      if (!warned && elapsed > warnAfterMs) {
        console.warn(`[Darkroom] Files not yet stable after ${elapsed}ms (${missing.length} missing, ${unstable.length} still writing). Waiting...`);
        warned = true;
      }
      await sleep(pollIntervalMs);
    }

    return {
      stable: false,
      elapsedMs: Date.now() - start,
      missing,
      unstable,
    };
  }

  // ─── TXT FILE GENERATION ─────────────────────────────────

  /**
   * Generate Darkroom-compatible txt content from a PDX order.
   *
   * PDX order items contain:
   * - item.externalId (SKU/product code)
   * - item.description (e.g., "Memory Mate-Dance")
   * - item.quantity
   * - item.images[].assetUrl (print-ready flat file)
   * - item.images[].filename
   */
  generateTxtContent(orderData) {
    const lines = [];

    // Header
    lines.push(`OrderFirstName=${orderData.firstName}`);
    lines.push(`OrderLastName=${orderData.lastName}`);
    lines.push(`OrderEmail=${orderData.email}`);
    lines.push(`ExtOrderNum=${orderData.orderNum}`);

    // Line items (packing slip is always first)
    for (const item of orderData.lineItems) {
      lines.push(`Qty=${item.qty}`);
      lines.push(`Size=${item.size || '0x0'}`);

      if (item.templatePath) {
        lines.push(`Template=${item.templatePath}`);
      }

      lines.push(`Filepath=${item.filePath}`);
    }

    return lines.join('\n');
  }

  /**
   * Write a txt file to disk.
   *
   * The write is staged: we first wait for every referenced image file to be
   * fully written and size-stable (so Darkroom doesn't try to print a partial
   * image), then write the txt to a `.tmp` filename and atomically rename it
   * to the final `.txt` name. Darkroom never sees a partial txt or a txt
   * that references unflushed images.
   *
   * @param {object} orderData - { firstName, lastName, email, orderNum, lineItems }
   * @param {string} outputDir
   * @param {string} filenameSuffix - inserted before extension (legacy)
   * @param {string} batchFilename - if provided, OVERRIDES the entire filename
   *                                  (used by team-batch flow for predictable sort order)
   */
  async writeTxtFile(orderData, outputDir, filenameSuffix = '', batchFilename = null) {
    const dir = outputDir || config.paths.txtOutput;
    await fs.ensureDir(dir);

    let filename;
    if (batchFilename) {
      filename = batchFilename.endsWith('.txt') ? batchFilename : `${batchFilename}.txt`;
    } else {
      filename = await this.generateFileName(orderData);
      if (filenameSuffix) {
        const ext = path.extname(filename);
        const base = filename.slice(0, -ext.length);
        filename = `${base}${filenameSuffix}${ext}`;
      }
    }

    const filePath = path.join(dir, filename);
    const tmpPath = filePath + '.tmp';
    const content = this.generateTxtContent(orderData);

    // Wait for every Filepath referenced in the txt to be stable on disk.
    // This is the fix for the "txt picked up by Darkroom before images finished
    // flushing to the network share" race condition.
    const referencedPaths = (orderData.lineItems || [])
      .map(li => li.filePath)
      .filter(Boolean);

    if (referencedPaths.length > 0) {
      const result = await this._waitForFilesStable(referencedPaths, {
        timeoutMs: 30000,
        pollIntervalMs: 250,
        warnAfterMs: 5000,
      });
      if (!result.stable) {
        const detail = [
          result.missing.length ? `missing: ${result.missing.length}` : null,
          result.unstable.length ? `still-writing: ${result.unstable.length}` : null,
        ].filter(Boolean).join(', ');
        const err = new Error(
          `Files for ${orderData.orderNum} not stable after ${result.elapsedMs}ms (${detail}). ` +
          `Refusing to write txt — Darkroom would print incomplete output.`
        );
        err.missing = result.missing;
        err.unstable = result.unstable;
        throw err;
      }
      if (result.elapsedMs > 1000) {
        console.log(`[Darkroom] Files stabilized in ${result.elapsedMs}ms`);
      }
    }

    // Atomic write: stage to .tmp, then rename. Rename is atomic for files
    // in the same directory on Windows + SMB, so Darkroom either sees the
    // complete txt or no txt at all — never a partial one.
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);

    return { filePath, filename, content };
  }

  /**
   * Process a PDX order into a Darkroom txt file.
   * The txt file is written to the same folder as the images (orderDir).
   * The packing slip is added as the first print item at 5x8.
   *
   * @param {object} order - PDX order
   * @param {object} options - { orderDir, packingSlipPath }
   */
  async processOrder(order, options = {}) {
    console.log(`[Darkroom] Processing order ${order.num}...`);
    // Customer name resolution:
    //   1. options.customerNameOverride { firstName, lastName }  — explicit override.
    //      Used by the Bulk per-dancer flow so each dancer's txt has their own
    //      "LastName, FirstName" Customer field instead of the studio's name.
    //   2. photodayService.getCustomerName(order) — default for dropship and any
    //      caller that doesn't supply an override.
    const customerName = (options.customerNameOverride
      && typeof options.customerNameOverride === 'object'
      && (options.customerNameOverride.firstName != null
          || options.customerNameOverride.lastName != null))
      ? {
          firstName: options.customerNameOverride.firstName || '',
          lastName: options.customerNameOverride.lastName || '',
        }
      : photodayService.getCustomerName(order);
    console.log(`[Darkroom] Customer: ${customerName.firstName} ${customerName.lastName}`);

    const orderDir = options.orderDir || path.join(config.paths.downloadBase, order.num);
    console.log(`[Darkroom] OrderDir: ${orderDir}`);

    // Slip position: 'first' (default) or 'last'. With Darkroom's size-grouping
    // behavior (it groups all line items by size and prints them in the order they
    // appear in the txt), this controls slip placement WITHIN the 5x8 group:
    //   'first' — slip is the first 5x8 line item printed (bottom of the 5x8 stack)
    //   'last'  — slip is the last 5x8 line item printed (top of the 5x8 stack)
    // In both cases, all 5x8 items are placed at the END of the txt so the 5x8
    // size group is the LAST size Darkroom prints. This puts the slip on top of
    // the customer's pile when slipPosition='last', which is the team-batch use case.
    const slipPosition = options.slipPosition === 'last' ? 'last' : 'first';

    // Build raw line items first (slip handled separately below so we can sort it)
    const rawLineItems = [];

    // Helper to append the slip when needed
    const slipLineItem = options.packingSlipPath
      ? { qty: 1, size: '5x8', templatePath: null, filePath: options.packingSlipPath }
      : null;

    // Process each order item
    for (const item of order.items || []) {
      console.log(`[Darkroom] Processing item: ${item.description} (externalId: ${item.externalId})`);

      try {
        const isSpecialty = await specialtyService.isSpecialty(item.externalId);
        if (isSpecialty) {
          console.log(`[Darkroom] Skipping specialty item: ${item.description}`);
          continue;
        }
      } catch (specErr) {
        console.error(`[Darkroom] Specialty check error: ${specErr.message}`);
      }

      let templatePath = null;
      try {
        templatePath = await this.findTemplate(item);
      } catch (tmplErr) {
        console.error(`[Darkroom] Template lookup error: ${tmplErr.message}`);
      }

      let size = '0x0';
      try {
        size = await this._getSize(item);
      } catch (sizeErr) {
        console.error(`[Darkroom] Size lookup error: ${sizeErr.message}`);
      }

      console.log(`[Darkroom] Item: ${item.description}, size: ${size}, template: ${templatePath || 'none'}`);

      for (const image of item.images || []) {
        const imagePath = path.join(orderDir, image.filename || `${image.id}.jpg`);
        rawLineItems.push({
          qty: item.quantity || 1,
          size,
          templatePath,
          filePath: imagePath,
        });
      }
    }

    // ─── Sort: non-5x8 first, then all 5x8 items, with slip placed within 5x8 group ───
    // Darkroom prints sizes in the order their first occurrence appears in the txt,
    // so putting all 5x8 lines at the bottom means the 5x8 group prints last.
    //
    // CRITICAL: partition by *physical paper*, not by exact size string. Items
    // come through as either '5x8' or '8x5' depending on orientation (e.g.,
    // 5x7 Individual prints as '5x8', 5x7 Standard Group prints as '8x5') —
    // both go on the same 5x8 paper at the lab. Treating them as different
    // would let an '8x5' item sneak between the slip and other 5x8 items in
    // the txt, which produces a misordered print stack at Darkroom even
    // though the .txt looks "sorted" by string comparison.
    const is5x8Paper = (sz) => {
      if (!sz || typeof sz !== 'string') return false;
      const m = sz.match(/^(\d+)x(\d+)$/);
      if (!m) return false;
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      // Match either orientation
      return (a === 5 && b === 8) || (a === 8 && b === 5);
    };
    const non5x8 = rawLineItems.filter(li => !is5x8Paper(li.size));
    const items5x8 = rawLineItems.filter(li => is5x8Paper(li.size));
    const lineItems = [...non5x8];

    if (slipLineItem && slipPosition === 'first') {
      // Slip first within 5x8 group → first 5x8 printed → bottom of customer's stack
      lineItems.push(slipLineItem, ...items5x8);
      console.log(`[Darkroom] Added packing slip (first within 5x8 group): ${options.packingSlipPath}`);
    } else if (slipLineItem && slipPosition === 'last') {
      // Slip last within 5x8 group → last 5x8 printed → top of customer's stack
      lineItems.push(...items5x8, slipLineItem);
      console.log(`[Darkroom] Added packing slip (last within 5x8 group): ${options.packingSlipPath}`);
    } else {
      // No slip
      lineItems.push(...items5x8);
    }

    console.log(`[Darkroom] Total line items: ${lineItems.length} (non-5x8: ${non5x8.length}, 5x8: ${items5x8.length}${slipLineItem ? ' + slip' : ''})`);

    const orderData = {
      firstName: customerName.firstName,
      lastName: customerName.lastName,
      email: photodayService.getStudioEmail(order),
      orderNum: order.num,
      gallery: order.gallery || '',
      lineItems,
    };

    console.log(`[Darkroom] Writing txt file...`);
    const suffix = options.filenameSuffix || '';
    const result = await this.writeTxtFile(orderData, orderDir, suffix, options.batchFilename);
    console.log(`[Darkroom] Txt file written: ${result.filePath}`);

    return {
      ...result,
      orderData,
      itemCount: lineItems.length,
    };
  }


  /**
   * Write a standalone "team divider" txt — just a single 5x8 line item pointing
   * at the divider image. Uses the same atomic .tmp + rename pattern as regular
   * txts. The header block uses a synthetic customer name so Darkroom logs it
   * recognizably without requiring real customer info.
   *
   * @param {string} dividerImagePath - path to the team-divider JPG
   * @param {string} outputDir
   * @param {string} batchFilename - full filename (with or without .txt extension)
   * @param {string} teamName - human-readable team label, used in the synthetic header
   */
  async writeDividerTxt(dividerImagePath, outputDir, batchFilename, teamName) {
    await fs.ensureDir(outputDir);

    const filename = batchFilename.endsWith('.txt') ? batchFilename : `${batchFilename}.txt`;
    const filePath = path.join(outputDir, filename);
    const tmpPath = filePath + '.tmp';

    // Wait for the divider image to be stable before referencing it
    const stab = await this._waitForFilesStable([dividerImagePath], {
      timeoutMs: 30000, pollIntervalMs: 250, warnAfterMs: 5000,
    });
    if (!stab.stable) {
      throw new Error(`Divider image not stable after ${stab.elapsedMs}ms`);
    }

    const lines = [
      `OrderFirstName=TEAM`,
      `OrderLastName=${teamName || 'DIVIDER'}`,
      `OrderEmail=`,
      `ExtOrderNum=DIVIDER_${teamName || ''}`.replace(/\s+/g, '_'),
      `Qty=1`,
      `Size=5x8`,
      `Filepath=${dividerImagePath}`,
    ];

    await fs.writeFile(tmpPath, lines.join('\n'), 'utf-8');
    await fs.rename(tmpPath, filePath);

    console.log(`[Darkroom] Team divider txt written: ${filePath}`);
    return { filePath, filename };
  }

}

module.exports = new DarkroomService();
