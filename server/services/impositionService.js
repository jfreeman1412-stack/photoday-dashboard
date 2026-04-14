const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'imposition-layouts.json');

/**
 * Available text variables for layout text overlays.
 * These get replaced with actual order data at composition time.
 */
const TEXT_VARIABLES = [
  { token: '{order_id}', description: 'PhotoDay order number (e.g., SB1773428567)' },
  { token: '{order_uuid}', description: 'PhotoDay internal order UUID' },
  { token: '{gallery}', description: 'Gallery name' },
  { token: '{studio}', description: 'Studio name' },
  { token: '{first_name}', description: 'Customer first name' },
  { token: '{last_name}', description: 'Customer last name' },
  { token: '{date}', description: 'Current date (YYYY-MM-DD)' },
  { token: '{datetime}', description: 'Current date and time' },
  { token: '{item_description}', description: 'Product description (e.g., 8 Wallets)' },
  { token: '{item_sku}', description: 'Product External ID / SKU' },
  { token: '{quantity}', description: 'Item quantity' },
];

class ImpositionService {
  constructor() {
    this._ensureConfig();
  }

  _ensureConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
      const defaultConfig = {
        layouts: [
          {
            id: 'wallets-8x10',
            name: '8 Wallets on 8x10',
            cols: 4,
            rows: 2,
            itemWidth: 2.5,
            itemHeight: 3.5,
            sheetWidth: 10,
            sheetHeight: 8,
            dpi: 300,
            colGap: 0.01,
            rowGap: 0.01,
            textOverlays: [],
          },
        ],
        mappings: [
          { externalId: '12', layoutId: 'wallets-8x10' },
        ],
      };
      fs.writeJsonSync(CONFIG_PATH, defaultConfig, { spaces: 2 });
    }
  }

  async _read() { return fs.readJson(CONFIG_PATH); }
  async _write(data) { await fs.writeJson(CONFIG_PATH, data, { spaces: 2 }); }

  /**
   * Get the list of available text variables.
   */
  getTextVariables() { return TEXT_VARIABLES; }

  // ─── LAYOUT CRUD ──────────────────────────────────────────

  async getLayouts() {
    const data = await this._read();
    return data.layouts || [];
  }

  async getLayout(id) {
    const layouts = await this.getLayouts();
    return layouts.find(l => l.id === id) || null;
  }

  async addLayout(layout) {
    const data = await this._read();
    const newLayout = {
      id: layout.id || uuidv4(),
      name: layout.name || 'Untitled Layout',
      cols: parseInt(layout.cols) || 1,
      rows: parseInt(layout.rows) || 1,
      itemWidth: parseFloat(layout.itemWidth) || 1,
      itemHeight: parseFloat(layout.itemHeight) || 1,
      sheetWidth: parseFloat(layout.sheetWidth) || 8,
      sheetHeight: parseFloat(layout.sheetHeight) || 10,
      dpi: parseInt(layout.dpi) || 300,
      colGap: parseFloat(layout.colGap) || 0,
      rowGap: parseFloat(layout.rowGap) || 0,
      centerOnSheet: !!layout.centerOnSheet,
      marginLeft: parseFloat(layout.marginLeft) || 0,
      marginTop: parseFloat(layout.marginTop) || 0,
      textOverlays: layout.textOverlays || [],
    };
    data.layouts.push(newLayout);
    await this._write(data);
    return newLayout;
  }

  async updateLayout(id, updates) {
    const data = await this._read();
    const index = data.layouts.findIndex(l => l.id === id);
    if (index === -1) throw new Error('Layout not found');

    const parsed = {};
    if (updates.name !== undefined) parsed.name = updates.name;
    if (updates.cols !== undefined) parsed.cols = parseInt(updates.cols);
    if (updates.rows !== undefined) parsed.rows = parseInt(updates.rows);
    if (updates.itemWidth !== undefined) parsed.itemWidth = parseFloat(updates.itemWidth);
    if (updates.itemHeight !== undefined) parsed.itemHeight = parseFloat(updates.itemHeight);
    if (updates.sheetWidth !== undefined) parsed.sheetWidth = parseFloat(updates.sheetWidth);
    if (updates.sheetHeight !== undefined) parsed.sheetHeight = parseFloat(updates.sheetHeight);
    if (updates.dpi !== undefined) parsed.dpi = parseInt(updates.dpi);
    if (updates.colGap !== undefined) parsed.colGap = parseFloat(updates.colGap);
    if (updates.rowGap !== undefined) parsed.rowGap = parseFloat(updates.rowGap);
    if (updates.centerOnSheet !== undefined) parsed.centerOnSheet = !!updates.centerOnSheet;
    if (updates.marginLeft !== undefined) parsed.marginLeft = parseFloat(updates.marginLeft);
    if (updates.marginTop !== undefined) parsed.marginTop = parseFloat(updates.marginTop);
    if (updates.textOverlays !== undefined) parsed.textOverlays = updates.textOverlays;

    data.layouts[index] = { ...data.layouts[index], ...parsed };
    await this._write(data);
    return data.layouts[index];
  }

  async deleteLayout(id) {
    const data = await this._read();
    data.layouts = data.layouts.filter(l => l.id !== id);
    data.mappings = data.mappings.filter(m => m.layoutId !== id);
    await this._write(data);
    return data.layouts;
  }

  // ─── EXTERNAL ID → LAYOUT MAPPINGS ────────────────────────

  async getMappings() {
    const data = await this._read();
    const layouts = data.layouts || [];
    return (data.mappings || []).map(m => ({
      ...m,
      layoutName: layouts.find(l => l.id === m.layoutId)?.name || 'Unknown',
    }));
  }

  async addMapping(externalId, layoutId) {
    const data = await this._read();
    if (!data.layouts.find(l => l.id === layoutId)) throw new Error('Layout not found');
    if (data.mappings.find(m => m.externalId === String(externalId))) {
      throw new Error(`ExternalId "${externalId}" is already mapped. Delete it first.`);
    }
    data.mappings.push({ externalId: String(externalId), layoutId });
    await this._write(data);
    return this.getMappings();
  }

  async deleteMapping(externalId) {
    const data = await this._read();
    data.mappings = data.mappings.filter(m => m.externalId !== String(externalId));
    await this._write(data);
    return this.getMappings();
  }

  // ─── IMPOSITION ENGINE ────────────────────────────────────

  async findRule(externalId) {
    const data = await this._read();
    const mapping = data.mappings.find(m => m.externalId === String(externalId));
    if (!mapping) return null;
    return data.layouts.find(l => l.id === mapping.layoutId) || null;
  }

  async hasRule(externalId) {
    return !!(await this.findRule(externalId));
  }

  /**
   * Resolve text variables in a string using order/item context.
   */
  _resolveTextVariables(text, context) {
    let result = text;
    result = result.replace(/\{order_id\}/g, context.orderNum || '');
    result = result.replace(/\{order_uuid\}/g, context.orderId || '');
    result = result.replace(/\{gallery\}/g, context.gallery || '');
    result = result.replace(/\{studio\}/g, context.studioName || '');
    result = result.replace(/\{first_name\}/g, context.firstName || '');
    result = result.replace(/\{last_name\}/g, context.lastName || '');
    result = result.replace(/\{date\}/g, new Date().toISOString().split('T')[0]);
    result = result.replace(/\{datetime\}/g, new Date().toLocaleString());
    result = result.replace(/\{item_description\}/g, context.itemDescription || '');
    result = result.replace(/\{item_sku\}/g, context.itemSku || '');
    result = result.replace(/\{quantity\}/g, String(context.quantity || ''));
    return result;
  }

  /**
   * Create an SVG text overlay to composite onto the sheet.
   */
  _createTextSvg(text, fontSize, color, sheetPxW, sheetPxH) {
    // Escape XML special characters
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return Buffer.from(`
      <svg width="${sheetPxW}" height="${sheetPxH}" xmlns="http://www.w3.org/2000/svg">
        <text font-family="Arial, sans-serif" font-size="${fontSize}" fill="${color}">
          ${escaped}
        </text>
      </svg>
    `);
  }

  /**
   * Compose a tiled sheet from a single image.
   *
   * IMPORTANT: Images are placed at their true size (no stretching).
   * If the grid content is smaller than the sheet, the remaining space
   * is left white (or used for text overlays).
   */
  async composeSheet(imagePath, externalId, context = {}) {
    const rule = await this.findRule(externalId);
    if (!rule) return { imposed: false, reason: 'No imposition rule' };

    const { cols, rows, itemWidth, itemHeight, sheetWidth, sheetHeight, dpi, textOverlays } = rule;

    // Support separate column/row gaps, fall back to single 'gap' for backward compatibility
    const colGapInches = rule.colGap !== undefined ? rule.colGap : (rule.gap || 0);
    const rowGapInches = rule.rowGap !== undefined ? rule.rowGap : (rule.gap || 0);

    // Sheet dimensions in pixels
    const sheetPxW = Math.round(sheetWidth * dpi);
    const sheetPxH = Math.round(sheetHeight * dpi);

    // Item dimensions in pixels (true size, NOT stretched to fill sheet)
    const itemPxW = Math.round(itemWidth * dpi);
    const itemPxH = Math.round(itemHeight * dpi);

    // Gaps in pixels (stored in inches)
    const colGapPx = Math.round(colGapInches * dpi);
    const rowGapPx = Math.round(rowGapInches * dpi);

    // Total content area (items + gaps)
    const totalGapX = (cols - 1) * colGapPx;
    const totalGapY = (rows - 1) * rowGapPx;
    const contentW = (cols * itemPxW) + totalGapX;
    const contentH = (rows * itemPxH) + totalGapY;

    // Margin/offset — center on sheet or use manual margins
    let offsetXPx = 0;
    let offsetYPx = 0;
    if (rule.centerOnSheet) {
      offsetXPx = Math.max(Math.round((sheetPxW - contentW) / 2), 0);
      offsetYPx = Math.max(Math.round((sheetPxH - contentH) / 2), 0);
    } else {
      offsetXPx = Math.round((rule.marginLeft || 0) * dpi);
      offsetYPx = Math.round((rule.marginTop || 0) * dpi);
    }

    const extraW = sheetPxW - contentW - offsetXPx;
    const extraH = sheetPxH - contentH - offsetYPx;

    console.log(`[Imposition] ${rule.name}: ${cols}x${rows}, item ${itemPxW}x${itemPxH}px, colGap ${colGapInches}" (${colGapPx}px), rowGap ${rowGapInches}" (${rowGapPx}px), offset (${offsetXPx}px, ${offsetYPx}px), sheet ${sheetPxW}x${sheetPxH}px, extra: ${extraW}px right, ${extraH}px bottom`);

    // Read and resize source image to exact item size
    const sourceBuffer = await fs.readFile(imagePath);
    const resizedBuffer = await sharp(sourceBuffer)
      .resize(itemPxW, itemPxH, { fit: 'cover', position: 'center' })
      .toBuffer();

    // Build composites — place items at true size positions with offset
    const composites = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = offsetXPx + col * (itemPxW + colGapPx);
        const y = offsetYPx + row * (itemPxH + rowGapPx);
        composites.push({
          input: resizedBuffer,
          left: x,
          top: y,
        });
      }
    }

    // Add text overlays
    if (textOverlays && textOverlays.length > 0) {
      console.log(`[Imposition] Processing ${textOverlays.length} text overlay(s)`);
      for (const overlay of textOverlays) {
        const resolvedText = this._resolveTextVariables(overlay.text || '', context);
        console.log(`[Imposition] Text overlay: "${overlay.text}" → "${resolvedText}" at (${overlay.x}", ${overlay.y}") size=${overlay.fontSize}pt rot=${overlay.rotation || 0}°`);
        if (!resolvedText.trim()) {
          console.log(`[Imposition] Skipping empty text overlay`);
          continue;
        }

        const fontSize = Math.round((overlay.fontSize || 12) * (dpi / 72));
        const color = overlay.color || '#000000';
        const rotation = overlay.rotation || 0;

        const textX = Math.round((overlay.x || 0) * dpi);
        const textY = Math.round((overlay.y || 0) * dpi);

        // Split text into lines (support \n for line breaks)
        const lines = resolvedText.split('\\n').map(l => l.trim());
        const lineHeight = Math.round(fontSize * 1.3);

        // Build tspan elements for each line
        const tspans = lines.map((line, i) => {
          const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `<tspan x="0" dy="${i === 0 ? 0 : lineHeight}">${escaped}</tspan>`;
        }).join('');

        // SVG must fit within remaining sheet space from the text position
        const availW = Math.max(sheetPxW - textX, 1);
        const availH = Math.max(sheetPxH - textY, 1);

        // Apply rotation via transform — rotate around the text baseline
        const transformAttr = rotation ? ` transform="rotate(${rotation}, 0, ${fontSize})"` : '';

        const svgText = Buffer.from(`
          <svg xmlns="http://www.w3.org/2000/svg" width="${availW}" height="${availH}">
            <text x="0" y="${fontSize}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" fill="${color}"${transformAttr}>${tspans}</text>
          </svg>
        `);

        composites.push({
          input: svgText,
          left: textX,
          top: textY,
        });
      }
    }

    // Create sheet with white background — gaps between items are also white
    const sheetBuffer = await sharp({
      create: {
        width: sheetPxW,
        height: sheetPxH,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([
        ...composites,
      ])
      .jpeg({ quality: 95 })
      .toBuffer();

    // Replace the original file
    await fs.writeFile(imagePath, sheetBuffer);

    console.log(`[Imposition] Composed ${rule.name} → ${imagePath} (${sheetPxW}x${sheetPxH}px, content ${contentW}x${contentH}px)`);

    return {
      imposed: true,
      rule: rule.name,
      externalId,
      sheetPixels: { width: sheetPxW, height: sheetPxH },
      sheetInches: { width: sheetWidth, height: sheetHeight },
      contentPixels: { width: contentW, height: contentH },
      extraSpace: { right: extraW, bottom: extraH },
      grid: { cols, rows },
      itemPixels: { width: itemPxW, height: itemPxH },
      colGap: colGapInches,
      rowGap: rowGapInches,
      textOverlays: (textOverlays || []).length,
      path: imagePath,
    };
  }

  /**
   * Build context object from order and item data for text variable resolution.
   */
  _buildContext(order, item) {
    const dest = order.shipping?.destination || {};
    const recipientParts = (dest.recipient || '').split(' ');
    return {
      orderNum: order.num,
      orderId: order.id,
      gallery: order.gallery || '',
      studioName: order.studio?.name || '',
      firstName: recipientParts[0] || '',
      lastName: recipientParts.slice(1).join(' ') || '',
      itemDescription: item.description || '',
      itemSku: item.externalId || '',
      quantity: item.quantity || 1,
    };
  }

  /**
   * Process all items in an order and apply imposition where needed.
   */
  async processOrder(order, orderDir) {
    const results = [];

    for (const item of order.items || []) {
      const externalId = String(item.externalId || '');
      const hasRule = await this.hasRule(externalId);

      if (!hasRule) {
        results.push({
          itemId: item.id, description: item.description, externalId,
          imposed: false, reason: 'No imposition rule',
        });
        continue;
      }

      const context = this._buildContext(order, item);

      for (const image of item.images || []) {
        const filename = image.filename || `${image.id}.jpg`;
        const imagePath = path.join(orderDir, filename);

        if (!(await fs.pathExists(imagePath))) {
          results.push({
            itemId: item.id, description: item.description, externalId, filename,
            imposed: false, reason: 'Image file not found',
          });
          continue;
        }

        try {
          const result = await this.composeSheet(imagePath, externalId, context);
          results.push({ itemId: item.id, description: item.description, externalId, filename, ...result });
        } catch (err) {
          console.error(`[Imposition] Error composing ${filename}:`, err.message);
          results.push({
            itemId: item.id, description: item.description, externalId, filename,
            imposed: false, reason: err.message,
          });
        }
      }
    }

    return results;
  }
}

module.exports = new ImpositionService();
