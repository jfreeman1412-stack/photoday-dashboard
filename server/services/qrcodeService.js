const QRCode = require('qrcode');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');
const config = require('../config');

class QRCodeService {
  /**
   * Generate a single QR code as a buffer
   */
  async generateQRCode(data, options = {}) {
    const size = options.size || 200;
    const buffer = await QRCode.toBuffer(data, {
      type: 'png',
      width: size,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    });
    return buffer;
  }

  /**
   * Generate a sheet of QR codes (up to 20 per page)
   * Layout: 4 columns x 5 rows on an 8.5" x 11" sheet at 300 DPI
   *
   * Each QR code includes a label below it (e.g., order number)
   */
  async generateQRSheet(items, options = {}) {
    const dpi = options.dpi || config.defaults.dpi || 300;
    const maxPerSheet = options.maxPerSheet || 20;

    // Page dimensions at 300 DPI
    const pageWidth = Math.round(8.5 * dpi);   // 2550px
    const pageHeight = Math.round(11 * dpi);    // 3300px

    // Grid layout: 4 columns x 5 rows
    const cols = 4;
    const rows = 5;
    const margin = Math.round(0.5 * dpi);       // 0.5" margin

    const usableWidth = pageWidth - (2 * margin);
    const usableHeight = pageHeight - (2 * margin);

    const cellWidth = Math.floor(usableWidth / cols);
    const cellHeight = Math.floor(usableHeight / rows);

    const qrSize = Math.min(cellWidth, cellHeight) - Math.round(0.4 * dpi); // Leave room for label

    // Create the base sheet (white background)
    const composites = [];

    // Generate QR codes for each item (max 20)
    const itemsToProcess = items.slice(0, maxPerSheet);

    for (let i = 0; i < itemsToProcess.length; i++) {
      const item = itemsToProcess[i];
      const col = i % cols;
      const row = Math.floor(i / cols);

      const x = margin + (col * cellWidth) + Math.floor((cellWidth - qrSize) / 2);
      const y = margin + (row * cellHeight);

      // Generate QR code
      const qrBuffer = await this.generateQRCode(item.data, { size: qrSize });

      composites.push({
        input: qrBuffer,
        top: y,
        left: x,
      });

      // Generate label text as SVG
      const labelText = item.label || item.data;
      const fontSize = Math.round(dpi * 0.12); // ~36px at 300 DPI
      const labelSvg = Buffer.from(`
        <svg width="${cellWidth}" height="${Math.round(dpi * 0.3)}">
          <text
            x="${cellWidth / 2}"
            y="${fontSize + 5}"
            text-anchor="middle"
            font-family="Arial, sans-serif"
            font-size="${fontSize}"
            font-weight="bold"
            fill="#000000"
          >${this._escapeXml(labelText)}</text>
        </svg>
      `);

      composites.push({
        input: labelSvg,
        top: y + qrSize + Math.round(dpi * 0.05),
        left: margin + (col * cellWidth),
      });
    }

    // Compose the final image
    const sheet = await sharp({
      create: {
        width: pageWidth,
        height: pageHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite(composites)
      .png()
      .toBuffer();

    return sheet;
  }

  /**
   * Generate multiple sheets if there are more than 20 items
   */
  async generateQRSheets(items, options = {}) {
    const maxPerSheet = options.maxPerSheet || 20;
    const sheets = [];

    for (let i = 0; i < items.length; i += maxPerSheet) {
      const chunk = items.slice(i, i + maxPerSheet);
      const sheet = await this.generateQRSheet(chunk, options);
      sheets.push({
        sheetNumber: Math.floor(i / maxPerSheet) + 1,
        itemCount: chunk.length,
        buffer: sheet,
      });
    }

    return sheets;
  }

  /**
   * Save QR sheets to disk
   */
  async saveQRSheets(items, outputDir, options = {}) {
    const dir = outputDir || path.join(config.paths.downloadBase, 'qr-sheets');
    await fs.ensureDir(dir);

    const sheets = await this.generateQRSheets(items, options);
    const savedFiles = [];

    for (const sheet of sheets) {
      const filename = `qr-sheet-${sheet.sheetNumber}.png`;
      const filePath = path.join(dir, filename);
      await fs.writeFile(filePath, sheet.buffer);
      savedFiles.push({
        filename,
        filePath,
        sheetNumber: sheet.sheetNumber,
        itemCount: sheet.itemCount,
      });
    }

    return {
      totalSheets: sheets.length,
      totalItems: items.length,
      files: savedFiles,
    };
  }

  _escapeXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

module.exports = new QRCodeService();
