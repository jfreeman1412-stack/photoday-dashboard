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
   */
  async writeTxtFile(orderData, outputDir) {
    const dir = outputDir || config.paths.txtOutput;
    await fs.ensureDir(dir);

    const filename = await this.generateFileName(orderData);
    const filePath = path.join(dir, filename);
    const content = this.generateTxtContent(orderData);

    await fs.writeFile(filePath, content, 'utf-8');

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
    const customerName = photodayService.getCustomerName(order);
    console.log(`[Darkroom] Customer: ${customerName.firstName} ${customerName.lastName}`);

    const orderDir = options.orderDir || path.join(config.paths.downloadBase, order.num);
    console.log(`[Darkroom] OrderDir: ${orderDir}`);

    const lineItems = [];

    // Packing slip as the FIRST print item (5x8)
    if (options.packingSlipPath) {
      lineItems.push({
        qty: 1,
        size: '5x8',
        templatePath: null,
        filePath: options.packingSlipPath,
      });
      console.log(`[Darkroom] Added packing slip: ${options.packingSlipPath}`);
    }

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
        lineItems.push({
          qty: item.quantity || 1,
          size,
          templatePath,
          filePath: imagePath,
        });
      }
    }

    console.log(`[Darkroom] Total line items: ${lineItems.length}`);

    const orderData = {
      firstName: customerName.firstName,
      lastName: customerName.lastName,
      email: photodayService.getStudioEmail(order),
      orderNum: order.num,
      gallery: order.gallery || '',
      lineItems,
    };

    console.log(`[Darkroom] Writing txt file...`);
    const result = await this.writeTxtFile(orderData, orderDir);
    console.log(`[Darkroom] Txt file written: ${result.filePath}`);

    return {
      ...result,
      orderData,
      itemCount: lineItems.length,
    };
  }

}

module.exports = new DarkroomService();
