const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');
const QRCode = require('qrcode');
const config = require('../config');
const specialtyService = require('./specialtyService');

// Logo path — place your logo file here
const LOGO_PATH = path.join(__dirname, '..', 'config', 'logo.png');

// Packing slip dimensions: 5" × 8" at 300 DPI
const SLIP_WIDTH = 1500;   // 5 * 300
const SLIP_HEIGHT = 2400;  // 8 * 300
const DPI = 300;
const MARGIN = 60;         // ~0.2" margin
const CONTENT_WIDTH = SLIP_WIDTH - (MARGIN * 2);

class PackingSlipService {

  /**
   * Generate a packing slip JPG for a PDX order.
   * Saved in the same folder as images/txt.
   *
   * @param {object} order - PDX order object
   * @param {string} orderDir - Folder where images are stored
   * @returns {object} { filePath, filename }
   */
  async generateSlip(order, orderDir) {
    const dest = order.shipping?.destination || {};
    const shippingOption = order.shipping?.option?.name || 'Standard';
    const isBulk = (order.groups || []).length > 1;
    const customerParts = (dest.recipient || '').split(' ');
    const firstName = customerParts[0] || '';
    const lastName = customerParts.slice(1).join(' ') || '';

    // Load configurable highlight colors
    const highlightColors = await specialtyService.getHighlightColors();

    // Build SVG content
    let y = MARGIN;
    const svgParts = [];

    // ─── Background ──────────────────────────────────────
    svgParts.push(`<rect width="${SLIP_WIDTH}" height="${SLIP_HEIGHT}" fill="#ffffff"/>`);

    // ─── Logo (if exists) ────────────────────────────────
    let logoHeight = 0;
    let logoBuffer = null;
    if (await fs.pathExists(LOGO_PATH)) {
      try {
        const logoMeta = await sharp(LOGO_PATH).metadata();
        const maxLogoWidth = 500;
        const maxLogoHeight = 150;
        const scale = Math.min(maxLogoWidth / logoMeta.width, maxLogoHeight / logoMeta.height, 1);
        const lw = Math.round(logoMeta.width * scale);
        const lh = Math.round(logoMeta.height * scale);
        logoBuffer = await sharp(LOGO_PATH).resize(lw, lh).png().toBuffer();
        logoHeight = lh + 20;
      } catch (err) {
        console.error('[PackingSlip] Logo load error:', err.message);
      }
    }

    // If no logo, use text header
    if (!logoBuffer) {
      svgParts.push(`<text x="${SLIP_WIDTH / 2}" y="${y + 50}" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="#333333" text-anchor="middle">Sportsline Photography</text>`);
      y += 80;
    } else {
      y += logoHeight;
    }

    // ─── Title bar ───────────────────────────────────────
    svgParts.push(`<rect x="${MARGIN}" y="${y}" width="${CONTENT_WIDTH}" height="60" rx="8" fill="#1a1a2e"/>`);
    svgParts.push(`<text x="${SLIP_WIDTH / 2}" y="${y + 40}" font-family="Arial, sans-serif" font-size="32" font-weight="bold" fill="#ffffff" text-anchor="middle">PACKING SLIP</text>`);
    y += 80;

    // ─── Order Info ──────────────────────────────────────
    const leftCol = MARGIN + 10;
    const rightCol = SLIP_WIDTH / 2 + 20;
    const labelStyle = 'font-family="Arial, sans-serif" font-size="22" fill="#888888"';
    const valueStyle = 'font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#222222"';

    // Row 1: Order # and Date
    svgParts.push(`<text x="${leftCol}" y="${y + 22}" ${labelStyle}>Order #</text>`);
    svgParts.push(`<text x="${leftCol}" y="${y + 52}" ${valueStyle}>${this._esc(order.num || '')}</text>`);
    const dateStr = order.placedAt ? new Date(order.placedAt).toLocaleDateString() : '';
    svgParts.push(`<text x="${rightCol}" y="${y + 22}" ${labelStyle}>Order Date</text>`);
    svgParts.push(`<text x="${rightCol}" y="${y + 52}" ${valueStyle}>${this._esc(dateStr)}</text>`);
    y += 75;

    // Row 2: Gallery and Shipping Option
    svgParts.push(`<text x="${leftCol}" y="${y + 22}" ${labelStyle}>Gallery</text>`);
    svgParts.push(`<text x="${leftCol}" y="${y + 52}" ${valueStyle}>${this._esc(order.gallery || 'N/A')}</text>`);
    svgParts.push(`<text x="${rightCol}" y="${y + 22}" ${labelStyle}>Shipping</text>`);
    svgParts.push(`<text x="${rightCol}" y="${y + 52}" ${valueStyle}>${this._esc(shippingOption)}</text>`);
    y += 75;

    // Row 3: Order Type
    svgParts.push(`<text x="${leftCol}" y="${y + 22}" ${labelStyle}>Order Type</text>`);
    svgParts.push(`<text x="${leftCol}" y="${y + 52}" ${valueStyle}>${isBulk ? 'Bulk Order' : 'Dropship'}</text>`);
    svgParts.push(`<text x="${rightCol}" y="${y + 22}" ${labelStyle}>Studio</text>`);
    svgParts.push(`<text x="${rightCol}" y="${y + 52}" ${valueStyle}>${this._esc(order.studio?.name || '')}</text>`);
    y += 80;

    // ─── Divider ─────────────────────────────────────────
    svgParts.push(`<line x1="${MARGIN}" y1="${y}" x2="${SLIP_WIDTH - MARGIN}" y2="${y}" stroke="#dddddd" stroke-width="2"/>`);
    y += 15;

    // ─── Ship To ─────────────────────────────────────────
    svgParts.push(`<text x="${leftCol}" y="${y + 22}" ${labelStyle}>SHIP TO</text>`);
    y += 35;
    svgParts.push(`<text x="${leftCol}" y="${y + 24}" ${valueStyle}>${this._esc(dest.recipient || '')}</text>`);
    y += 30;
    if (dest.address1) {
      svgParts.push(`<text x="${leftCol}" y="${y + 24}" font-family="Arial, sans-serif" font-size="22" fill="#333333">${this._esc(dest.address1)}</text>`);
      y += 28;
    }
    if (dest.address2) {
      svgParts.push(`<text x="${leftCol}" y="${y + 24}" font-family="Arial, sans-serif" font-size="22" fill="#333333">${this._esc(dest.address2)}</text>`);
      y += 28;
    }
    const cityLine = [dest.city, dest.state].filter(Boolean).join(', ') + (dest.zipCode ? ` ${dest.zipCode}` : '');
    if (cityLine.trim()) {
      svgParts.push(`<text x="${leftCol}" y="${y + 24}" font-family="Arial, sans-serif" font-size="22" fill="#333333">${this._esc(cityLine)}</text>`);
      y += 28;
    }
    if (dest.phone || dest.phoneNumber) {
      svgParts.push(`<text x="${leftCol}" y="${y + 24}" font-family="Arial, sans-serif" font-size="20" fill="#666666">${this._esc(dest.phone || dest.phoneNumber)}</text>`);
      y += 28;
    }
    y += 15;

    // ─── Bulk order group fields ─────────────────────────
    if (isBulk && order.groups?.length > 0) {
      svgParts.push(`<line x1="${MARGIN}" y1="${y}" x2="${SLIP_WIDTH - MARGIN}" y2="${y}" stroke="#dddddd" stroke-width="2"/>`);
      y += 15;
      svgParts.push(`<text x="${leftCol}" y="${y + 22}" ${labelStyle}>GROUP INFORMATION</text>`);
      y += 35;

      for (const group of order.groups) {
        for (const field of group.fields || []) {
          const label = field.key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          svgParts.push(`<text x="${leftCol}" y="${y + 22}" font-family="Arial, sans-serif" font-size="20" fill="#666666">${this._esc(label)}:</text>`);
          svgParts.push(`<text x="${leftCol + 220}" y="${y + 22}" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#333333">${this._esc(field.value || '')}</text>`);
          y += 30;
        }
        y += 10;
      }
    }

    // ─── Divider ─────────────────────────────────────────
    svgParts.push(`<line x1="${MARGIN}" y1="${y}" x2="${SLIP_WIDTH - MARGIN}" y2="${y}" stroke="#dddddd" stroke-width="2"/>`);
    y += 15;

    // ─── Items Header ────────────────────────────────────
    svgParts.push(`<text x="${leftCol}" y="${y + 22}" ${labelStyle}>ITEMS</text>`);
    svgParts.push(`<text x="${SLIP_WIDTH - MARGIN - 10}" y="${y + 22}" ${labelStyle} text-anchor="end">QTY</text>`);
    y += 35;

    // Items will be composited later with thumbnails
    // Store y position for items section
    const itemsStartY = y;

    // ─── Footer ──────────────────────────────────────────
    const QR_SIZE = 200;
    const footerY = SLIP_HEIGHT - MARGIN - QR_SIZE - 20;
    svgParts.push(`<line x1="${MARGIN}" y1="${footerY}" x2="${SLIP_WIDTH - MARGIN}" y2="${footerY}" stroke="#dddddd" stroke-width="1"/>`);
    // Footer text to the right of QR code
    svgParts.push(`<text x="${MARGIN + QR_SIZE + 30}" y="${footerY + QR_SIZE / 2 - 10}" font-family="Arial, sans-serif" font-size="20" fill="#aaaaaa">Thank you for your order!</text>`);
    svgParts.push(`<text x="${MARGIN + QR_SIZE + 30}" y="${footerY + QR_SIZE / 2 + 20}" font-family="Arial, sans-serif" font-size="18" fill="#bbbbbb">${this._esc(order.num || '')}</text>`);

    // Build the base SVG
    const baseSvg = `<svg width="${SLIP_WIDTH}" height="${SLIP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${svgParts.join('')}</svg>`;

    // ─── Compose final image with thumbnails ─────────────
    const composites = [];

    // Add QR code with order number
    try {
      const qrDataUrl = await QRCode.toDataURL(order.num || 'NO_ORDER', {
        width: QR_SIZE,
        margin: 1,
        color: { dark: '#222222', light: '#ffffff' },
      });
      const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');
      const qrBuffer = Buffer.from(qrBase64, 'base64');
      composites.push({
        input: qrBuffer,
        left: MARGIN + 10,
        top: footerY + 10,
      });
    } catch (qrErr) {
      console.error('[PackingSlip] QR code error:', qrErr.message);
    }

    // Add logo if available
    if (logoBuffer) {
      const logoMeta = await sharp(logoBuffer).metadata();
      composites.push({
        input: logoBuffer,
        left: Math.round((SLIP_WIDTH - logoMeta.width) / 2),
        top: MARGIN + 10,
      });
    }

    // Add item rows with thumbnails
    const THUMB_SIZE = 120;
    const ITEM_ROW_HEIGHT = THUMB_SIZE + 20;
    let itemY = itemsStartY;

    for (const item of order.items || []) {
      const isSpecialty = await specialtyService.isSpecialty(item.externalId);
      const itemQty = item.quantity || 1;
      const isHighQty = itemQty > 1;

      // Highlight background for specialty or qty > 1
      if (isSpecialty || isHighQty) {
        const highlightColor = isSpecialty ? highlightColors.specialty : highlightColors.quantity;
        composites.push({
          input: Buffer.from(`<svg width="${CONTENT_WIDTH}" height="${THUMB_SIZE + 10}"><rect width="${CONTENT_WIDTH}" height="${THUMB_SIZE + 10}" fill="${highlightColor}" rx="6"/></svg>`),
          left: MARGIN,
          top: itemY - 5,
        });
      }

      // Get first image for thumbnail — check specialty folder too
      const firstImage = item.images?.[0];
      let thumbBuffer = null;

      if (firstImage) {
        const filename = firstImage.filename || `${firstImage.id}.jpg`;
        // Try order dir first, then specialty folder
        let imagePath = path.join(orderDir, filename);
        if (!(await fs.pathExists(imagePath)) && isSpecialty) {
          const specialtyFolder = await specialtyService.getSpecialtyFolder(item.externalId);
          if (specialtyFolder) imagePath = path.join(specialtyFolder, filename);
        }

        if (await fs.pathExists(imagePath)) {
          try {
            thumbBuffer = await sharp(imagePath)
              .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside' })
              .png()
              .toBuffer();
          } catch (err) {
            console.error(`[PackingSlip] Thumbnail error for ${filename}:`, err.message);
          }
        }
      }

      // Add thumbnail
      if (thumbBuffer) {
        composites.push({
          input: thumbBuffer,
          left: MARGIN + 10,
          top: itemY,
        });
      } else {
        composites.push({
          input: Buffer.from(`<svg width="${THUMB_SIZE}" height="${THUMB_SIZE}"><rect width="${THUMB_SIZE}" height="${THUMB_SIZE}" fill="#f0f0f0" rx="4"/><text x="${THUMB_SIZE/2}" y="${THUMB_SIZE/2 + 8}" font-family="Arial" font-size="16" fill="#cccccc" text-anchor="middle">No Image</text></svg>`),
          left: MARGIN + 10,
          top: itemY,
        });
      }

      // Add item text as SVG overlay
      const textX = MARGIN + THUMB_SIZE + 30;
      const textWidth = SLIP_WIDTH - textX - MARGIN - 10;
      const itemDesc = this._esc(item.description || 'Unknown Product');
      const itemSku = item.externalId ? `SKU: ${this._esc(item.externalId)}` : '';
      const imageCount = (item.images || []).length;

      // Qty position — aligned to right edge under the QTY header
      const qtyX = textWidth;
      const qtyColor = isHighQty ? '#DC3545' : '#222222';

      // Badge labels
      const specialtyBadge = isSpecialty
        ? `<rect x="0" y="92" width="120" height="24" rx="4" fill="#FF8C00"/><text x="60" y="108" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle">SPECIALTY</text>`
        : '';
      const qtyBadge = isHighQty
        ? `<rect x="${qtyX - 80}" y="44" width="80" height="22" rx="4" fill="#DC3545"/><text x="${qtyX - 40}" y="59" font-family="Arial, sans-serif" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="middle">CHECK QTY</text>`
        : '';

      const itemSvg = Buffer.from(`
        <svg width="${textWidth + 10}" height="${THUMB_SIZE + 10}" xmlns="http://www.w3.org/2000/svg">
          <text x="0" y="30" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="#222222">${itemDesc}</text>
          <text x="0" y="60" font-family="Arial, sans-serif" font-size="20" fill="#666666">${itemSku}</text>
          <text x="0" y="88" font-family="Arial, sans-serif" font-size="20" fill="#888888">${imageCount} image${imageCount !== 1 ? 's' : ''}</text>
          ${specialtyBadge}
          <text x="${qtyX}" y="35" font-family="Arial, sans-serif" font-size="42" font-weight="bold" fill="${qtyColor}" text-anchor="end">${itemQty}</text>
          ${qtyBadge}
        </svg>
      `);

      composites.push({
        input: itemSvg,
        left: textX,
        top: itemY,
      });

      itemY += ITEM_ROW_HEIGHT;

      // Add subtle divider between items
      if (order.items.indexOf(item) < order.items.length - 1) {
        composites.push({
          input: Buffer.from(`<svg width="${CONTENT_WIDTH - 20}" height="2"><line x1="0" y1="1" x2="${CONTENT_WIDTH - 20}" y2="1" stroke="#eeeeee" stroke-width="1"/></svg>`),
          left: MARGIN + 10,
          top: itemY - 10,
        });
      }
    }

    // ─── Render final image ──────────────────────────────
    const baseBuffer = await sharp(Buffer.from(baseSvg)).png().toBuffer();

    const finalBuffer = await sharp(baseBuffer)
      .composite(composites)
      .jpeg({ quality: 92 })
      .toBuffer();

    // Save to order folder
    const filename = `${order.num}_packing_slip.jpg`;
    const filePath = path.join(orderDir, filename);
    await fs.writeFile(filePath, finalBuffer);

    console.log(`[PackingSlip] Generated ${filename} (${SLIP_WIDTH}x${SLIP_HEIGHT}px)`);

    return { filePath, filename };
  }

  /**
   * Escape XML special characters for SVG text.
   */
  _esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

module.exports = new PackingSlipService();
