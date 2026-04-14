const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');
const config = require('../config');

class PrintSheetService {
  constructor() {
    // Sheet layout configurations
    this.layouts = {
      '8-wallet-8x10': {
        name: '8 Wallets on 8x10',
        sheetWidth: 10,    // inches
        sheetHeight: 8,    // inches
        itemWidth: 2.5,    // inches
        itemHeight: 3.5,   // inches
        cols: 4,
        rows: 2,
        marginX: 0,        // auto-calculated
        marginY: 0.5,      // inches
        gutter: 0,         // inches between items
      },
    };
  }

  /**
   * Get all available layouts
   */
  getLayouts() {
    return Object.entries(this.layouts).map(([key, layout]) => ({
      id: key,
      ...layout,
    }));
  }

  /**
   * Add a custom layout
   */
  addLayout(id, layoutConfig) {
    this.layouts[id] = layoutConfig;
    return this.layouts[id];
  }

  /**
   * Generate a print sheet with multiple copies of an image
   */
  async generatePrintSheet(imageInput, layoutId, options = {}) {
    const layout = this.layouts[layoutId];
    if (!layout) {
      throw new Error(`Unknown layout: ${layoutId}. Available: ${Object.keys(this.layouts).join(', ')}`);
    }

    const dpi = options.dpi || config.defaults.dpi || 300;

    // Convert dimensions to pixels
    const sheetWidthPx = Math.round(layout.sheetWidth * dpi);
    const sheetHeightPx = Math.round(layout.sheetHeight * dpi);
    const itemWidthPx = Math.round(layout.itemWidth * dpi);
    const itemHeightPx = Math.round(layout.itemHeight * dpi);
    const gutterPx = Math.round((layout.gutter || 0) * dpi);

    // Calculate margins to center the grid
    const totalGridWidth = (layout.cols * itemWidthPx) + ((layout.cols - 1) * gutterPx);
    const totalGridHeight = (layout.rows * itemHeightPx) + ((layout.rows - 1) * gutterPx);
    const marginX = Math.round((sheetWidthPx - totalGridWidth) / 2);
    const marginY = Math.round((sheetHeightPx - totalGridHeight) / 2);

    // Load and resize the source image
    let imageBuffer;
    if (Buffer.isBuffer(imageInput)) {
      imageBuffer = imageInput;
    } else {
      imageBuffer = await fs.readFile(imageInput);
    }

    // Resize image to fit the item dimensions, covering the area (crop to fill)
    const resizedImage = await sharp(imageBuffer)
      .resize(itemWidthPx, itemHeightPx, {
        fit: 'cover',
        position: 'centre',
      })
      .toBuffer();

    // Build composite array - place the image in each cell
    const composites = [];
    const totalItems = layout.cols * layout.rows;

    for (let i = 0; i < totalItems; i++) {
      const col = i % layout.cols;
      const row = Math.floor(i / layout.cols);

      const x = marginX + (col * (itemWidthPx + gutterPx));
      const y = marginY + (row * (itemHeightPx + gutterPx));

      composites.push({
        input: resizedImage,
        top: y,
        left: x,
      });
    }

    // Create the final sheet
    const sheet = await sharp({
      create: {
        width: sheetWidthPx,
        height: sheetHeightPx,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite(composites)
      .jpeg({ quality: 95 })
      .toBuffer();

    return {
      buffer: sheet,
      width: sheetWidthPx,
      height: sheetHeightPx,
      dpi,
      layout: layoutId,
      itemCount: totalItems,
    };
  }

  /**
   * Generate and save a print sheet to disk
   */
  async generateAndSavePrintSheet(imagePath, layoutId, outputDir, options = {}) {
    const result = await this.generatePrintSheet(imagePath, layoutId, options);

    const dir = outputDir || path.join(config.paths.downloadBase, 'print-sheets');
    await fs.ensureDir(dir);

    const baseName = path.basename(imagePath, path.extname(imagePath));
    const filename = `${baseName}_${layoutId}.jpg`;
    const filePath = path.join(dir, filename);

    await fs.writeFile(filePath, result.buffer);

    return {
      ...result,
      buffer: undefined, // Don't return buffer in saved result
      filePath,
      filename,
    };
  }
}

module.exports = new PrintSheetService();
