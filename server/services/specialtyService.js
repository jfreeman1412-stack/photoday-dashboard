const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'specialty-products.json');

class SpecialtyService {
  constructor() {
    this._ensureConfig();
  }

  _ensureConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeJsonSync(CONFIG_PATH, {
        basePath: path.join(config.paths.downloadBase, 'Specialty'),
        products: [],
        highlightColors: {
          specialty: '#FFF3CD',
          quantity: '#D4EDDA',
        },
      }, { spaces: 2 });
    }
    // Migrate existing configs that don't have highlightColors
    try {
      const data = fs.readJsonSync(CONFIG_PATH);
      if (!data.highlightColors) {
        data.highlightColors = { specialty: '#FFF3CD', quantity: '#D4EDDA' };
        fs.writeJsonSync(CONFIG_PATH, data, { spaces: 2 });
      }
    } catch (e) { /* ignore */ }
  }

  async _read() { return fs.readJson(CONFIG_PATH); }
  async _write(data) { await fs.writeJson(CONFIG_PATH, data, { spaces: 2 }); }

  // ─── CONFIG ───────────────────────────────────────────────

  async getConfig() {
    return this._read();
  }

  async getHighlightColors() {
    const data = await this._read();
    return data.highlightColors || { specialty: '#FFF3CD', quantity: '#D4EDDA' };
  }

  async setHighlightColors(colors) {
    const data = await this._read();
    data.highlightColors = { ...data.highlightColors, ...colors };
    await this._write(data);
    return data.highlightColors;
  }

  async getProducts() {
    const data = await this._read();
    return data.products || [];
  }

  async getBasePath() {
    const data = await this._read();
    return data.basePath || path.join(config.paths.downloadBase, 'Specialty');
  }

  async setBasePath(basePath) {
    const data = await this._read();
    data.basePath = basePath;
    await this._write(data);
    return basePath;
  }

  // ─── PRODUCT CRUD ─────────────────────────────────────────

  async addProduct(product) {
    const data = await this._read();
    const existing = data.products.find(p => p.externalId === String(product.externalId));
    if (existing) {
      throw new Error(`Specialty product with externalId "${product.externalId}" already exists`);
    }
    data.products.push({
      externalId: String(product.externalId),
      productName: product.productName || '',
      subfolder: product.subfolder || product.productName || product.externalId,
      // dropShipped: true means this product is fulfilled by another lab — skip ShipStation label.
      // Default false: most specialty items (acrylics, magnets, etc.) are still shipped from here.
      dropShipped: !!product.dropShipped,
    });
    await this._write(data);
    return data.products;
  }

  async updateProduct(externalId, updates) {
    const data = await this._read();
    const index = data.products.findIndex(p => p.externalId === String(externalId));
    if (index === -1) throw new Error('Specialty product not found');
    data.products[index] = { ...data.products[index], ...updates };
    await this._write(data);
    return data.products;
  }

  async deleteProduct(externalId) {
    const data = await this._read();
    data.products = data.products.filter(p => p.externalId !== String(externalId));
    await this._write(data);
    return data.products;
  }

  // ─── LOOKUP ───────────────────────────────────────────────

  /**
   * Check if an externalId is a specialty product.
   */
  async isSpecialty(externalId) {
    const products = await this.getProducts();
    return products.some(p => p.externalId === String(externalId));
  }

  /**
   * Check if an externalId is drop-shipped from another lab.
   * Drop-shipped items skip ShipStation entirely — the other lab handles fulfillment.
   * A SKU must be a specialty product AND have dropShipped: true.
   * Most specialty items are NOT drop-shipped — we still ship them from here.
   */
  async isDropShipped(externalId) {
    const product = await this.getProduct(externalId);
    return !!(product && product.dropShipped);
  }

  /**
   * Get the specialty product config for an externalId.
   */
  async getProduct(externalId) {
    const products = await this.getProducts();
    return products.find(p => p.externalId === String(externalId)) || null;
  }

  /**
   * Get the output folder for a specialty item.
   * Returns: {basePath}\{subfolder}\
   */
  async getSpecialtyFolder(externalId) {
    const product = await this.getProduct(externalId);
    if (!product) return null;
    const basePath = await this.getBasePath();
    return path.join(basePath, product.subfolder);
  }
}

module.exports = new SpecialtyService();
