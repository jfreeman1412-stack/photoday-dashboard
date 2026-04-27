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
   *
   * @param {object} order - PDX order object
   * @param {string} orderDir - Folder where images are stored
   * @returns {object} { filePath, filename }
   */
  async generateSlip(order, orderDir, teamOptions = {}) {
    const dest = order.shipping?.destination || {};
    const returnAddr = order.shipping?.return || {};
    const shippingOption = order.shipping?.option?.name || 'Standard';
    const isBulk = (order.groups || []).length > 1;
    const studioName = order.studio?.name || '';
    const studioEmail = order.studio?.email || '';
    const studioPhone = order.studio?.phone || '';

    // Team filtering options
    const activeTeam = teamOptions.team || null;
    const activeTeamItemIds = new Set(teamOptions.teamItems || []);

    // Load configurable highlight colors
    const highlightColors = await specialtyService.getHighlightColors();

    // Count items to determine sizing
    const itemCount = (order.items || []).length;

    // ─── Calculate dynamic item sizes ─────────────────────
    // Reserve space for: logo (~170px), header bar (80px), order info (230px),
    // ship-to (~180px), items header (35px), footer (280px), dividers (~40px)
    const headerSpace = 170 + 80 + 230 + 180 + 35 + 40;
    const footerSpace = 280;
    const availableForItems = SLIP_HEIGHT - headerSpace - footerSpace;

    // Scale items to fill available space
    const maxThumbSize = 200;
    const minThumbSize = 60;
    let thumbSize, itemRowHeight;

    if (itemCount <= 2) {
      thumbSize = maxThumbSize;
    } else if (itemCount <= 4) {
      thumbSize = 160;
    } else if (itemCount <= 6) {
      thumbSize = 120;
    } else {
      thumbSize = Math.max(Math.floor(availableForItems / itemCount) - 20, minThumbSize);
    }
    thumbSize = Math.min(thumbSize, maxThumbSize);
    itemRowHeight = thumbSize + 20;

    // Font sizes scale with thumb size
    const itemNameSize = Math.max(Math.round(thumbSize * 0.22), 18);
    const itemDetailSize = Math.max(Math.round(thumbSize * 0.16), 14);
    const itemQtySize = Math.max(Math.round(thumbSize * 0.35), 28);

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
        const logoFileBuffer = await fs.readFile(LOGO_PATH);
        const logoMeta = await sharp(logoFileBuffer).metadata();
        const maxLogoWidth = 600;
        const maxLogoHeight = 160;
        const scale = Math.min(maxLogoWidth / logoMeta.width, maxLogoHeight / logoMeta.height, 1);
        const lw = Math.round(logoMeta.width * scale);
        const lh = Math.round(logoMeta.height * scale);
        logoBuffer = await sharp(logoFileBuffer).resize(lw, lh).png().toBuffer();
        logoHeight = lh + 20;
      } catch (err) {
        console.error('[PackingSlip] Logo load error:', err.message);
      }
    }

    if (!logoBuffer) {
      svgParts.push(`<text x="${SLIP_WIDTH / 2}" y="${y + 50}" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="#333333" text-anchor="middle">${this._esc(studioName || 'Sportsline Photography')}</text>`);
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

    // Row 3: Order Type and Studio
    svgParts.push(`<text x="${leftCol}" y="${y + 22}" ${labelStyle}>Order Type</text>`);
    svgParts.push(`<text x="${leftCol}" y="${y + 52}" ${valueStyle}>${isBulk ? 'Bulk Order' : 'Dropship'}</text>`);
    svgParts.push(`<text x="${rightCol}" y="${y + 22}" ${labelStyle}>Studio</text>`);
    svgParts.push(`<text x="${rightCol}" y="${y + 52}" ${valueStyle}>${this._esc(studioName)}</text>`);
    y += 80;

    // ─── Divider ─────────────────────────────────────────
    svgParts.push(`<line x1="${MARGIN}" y1="${y}" x2="${SLIP_WIDTH - MARGIN}" y2="${y}" stroke="#dddddd" stroke-width="2"/>`);
    y += 15;

    // ─── Ship To ─────────────────────────────────────────
    svgParts.push(`<text x="${leftCol}" y="${y + 22}" ${labelStyle}>SHIP TO</text>`);
    y += 35;
    svgParts.push(`<text x="${leftCol}" y="${y + 28}" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#222222">${this._esc(dest.recipient || '')}</text>`);
    y += 36;
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
    svgParts.push(`<text x="${leftCol}" y="${y + 22}" ${labelStyle}>ITEMS (${itemCount})</text>`);
    svgParts.push(`<text x="${SLIP_WIDTH - MARGIN - 10}" y="${y + 22}" ${labelStyle} text-anchor="end">QTY</text>`);
    y += 35;

    const itemsStartY = y;

    // ─── Footer with larger contact info ─────────────────
    const QR_SIZE = 180;
    const footerY = SLIP_HEIGHT - MARGIN - QR_SIZE - 60;

    svgParts.push(`<line x1="${MARGIN}" y1="${footerY}" x2="${SLIP_WIDTH - MARGIN}" y2="${footerY}" stroke="#dddddd" stroke-width="2"/>`);

    // Contact info — right of QR code, larger text
    const contactX = MARGIN + QR_SIZE + 30;
    const contactSize = 24;
    let contactY = footerY + 30;

    svgParts.push(`<text x="${contactX}" y="${contactY}" font-family="Arial, sans-serif" font-size="${contactSize + 4}" font-weight="bold" fill="#222222">${this._esc(studioName)}</text>`);
    contactY += contactSize + 12;

    if (studioEmail) {
      svgParts.push(`<text x="${contactX}" y="${contactY}" font-family="Arial, sans-serif" font-size="${contactSize}" fill="#444444">${this._esc(studioEmail)}</text>`);
      contactY += contactSize + 8;
    }

    if (studioPhone) {
      // Format phone number
      const phone = studioPhone.replace(/^\+1/, '').replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
      svgParts.push(`<text x="${contactX}" y="${contactY}" font-family="Arial, sans-serif" font-size="${contactSize}" fill="#444444">${this._esc(phone)}</text>`);
      contactY += contactSize + 8;
    }

    // Return address if available
    if (returnAddr.address1) {
      const returnLine = [returnAddr.address1, returnAddr.city, returnAddr.state, returnAddr.zipCode].filter(Boolean).join(', ');
      svgParts.push(`<text x="${contactX}" y="${contactY}" font-family="Arial, sans-serif" font-size="18" fill="#888888">${this._esc(returnLine)}</text>`);
      contactY += 24;
    }

    svgParts.push(`<text x="${contactX}" y="${contactY + 8}" font-family="Arial, sans-serif" font-size="16" fill="#aaaaaa">Order: ${this._esc(order.num || '')}</text>`);

    // Build the base SVG
    const baseSvg = `<svg width="${SLIP_WIDTH}" height="${SLIP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${svgParts.join('')}</svg>`;

    // ─── Compose final image with thumbnails ─────────────
    const composites = [];

    // Add QR code
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
        top: footerY + 15,
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

    // ─── Add item rows with dynamic thumbnails ───────────
    let itemY = itemsStartY;

    for (let idx = 0; idx < (order.items || []).length; idx++) {
      const item = order.items[idx];
      const isSpecialty = await specialtyService.isSpecialty(item.externalId);
      const itemQty = item.quantity || 1;
      const isHighQty = itemQty > 1;

      // Team opacity — active team items at 100%, other team items faded
      const isActiveTeamItem = !activeTeam || activeTeamItemIds.has(item.id);
      const itemOpacity = isActiveTeamItem ? 1.0 : 0.3;

      // Highlight background for specialty or qty > 1
      if (isSpecialty || isHighQty) {
        const highlightColor = isSpecialty ? highlightColors.specialty : highlightColors.quantity;
        composites.push({
          input: Buffer.from(`<svg width="${CONTENT_WIDTH}" height="${thumbSize + 10}"><rect width="${CONTENT_WIDTH}" height="${thumbSize + 10}" fill="${highlightColor}" rx="6"/></svg>`),
          left: MARGIN,
          top: itemY - 5,
        });
      }

      // Get first image for thumbnail
      const firstImage = item.images?.[0];
      let thumbBuffer = null;

      if (firstImage) {
        const filename = firstImage.filename || `${firstImage.id}.jpg`;
        let imagePath = path.join(orderDir, filename);
        if (!(await fs.pathExists(imagePath)) && isSpecialty) {
          const specialtyFolder = await specialtyService.getSpecialtyFolder(item.externalId);
          if (specialtyFolder) imagePath = path.join(specialtyFolder, filename);
        }

        if (await fs.pathExists(imagePath)) {
          try {
            const imgBuffer = await fs.readFile(imagePath);
            thumbBuffer = await sharp(imgBuffer)
              .resize(thumbSize, thumbSize, { fit: 'inside' })
              .png()
              .toBuffer();
          } catch (err) {
            console.error(`[PackingSlip] Thumbnail error for ${filename}:`, err.message);
          }
        }
      }

      // Add thumbnail
      if (thumbBuffer) {
        // Center thumbnail vertically in row
        const thumbMeta = await sharp(thumbBuffer).metadata();
        const thumbOffsetY = Math.round((thumbSize - thumbMeta.height) / 2);
        composites.push({
          input: thumbBuffer,
          left: MARGIN + 10,
          top: itemY + thumbOffsetY,
        });
      } else {
        composites.push({
          input: Buffer.from(`<svg width="${thumbSize}" height="${thumbSize}"><rect width="${thumbSize}" height="${thumbSize}" fill="#f0f0f0" rx="4"/><text x="${thumbSize/2}" y="${thumbSize/2 + 6}" font-family="Arial" font-size="14" fill="#cccccc" text-anchor="middle">No Image</text></svg>`),
          left: MARGIN + 10,
          top: itemY,
        });
      }

      // Add item text
      const textX = MARGIN + thumbSize + 25;
      const textWidth = SLIP_WIDTH - textX - MARGIN - 10;
      const itemDesc = this._esc(item.description || 'Unknown Product');
      const itemSku = item.externalId ? `SKU: ${this._esc(item.externalId)}` : '';
      const imageCount = (item.images || []).length;

      // Tags
      const tags = (item.photoTags || []).map(t => this._esc(t)).join(', ');

      // Qty position — aligned to right edge
      const qtyX = textWidth;
      const qtyColor = isHighQty ? '#DC3545' : '#222222';

      // Badge labels
      const specialtyBadge = isSpecialty
        ? `<rect x="0" y="${Math.round(thumbSize * 0.72)}" width="${Math.round(itemNameSize * 5.5)}" height="${Math.round(itemNameSize * 1.1)}" rx="4" fill="#FF8C00"/><text x="${Math.round(itemNameSize * 2.75)}" y="${Math.round(thumbSize * 0.72 + itemNameSize * 0.85)}" font-family="Arial, sans-serif" font-size="${Math.round(itemNameSize * 0.65)}" font-weight="bold" fill="#ffffff" text-anchor="middle">SPECIALTY</text>`
        : '';
      const qtyBadge = isHighQty
        ? `<rect x="${qtyX - Math.round(itemNameSize * 4)}" y="${Math.round(itemNameSize * 1.8)}" width="${Math.round(itemNameSize * 4)}" height="${Math.round(itemNameSize * 1)}" rx="4" fill="#DC3545"/><text x="${qtyX - Math.round(itemNameSize * 2)}" y="${Math.round(itemNameSize * 2.55)}" font-family="Arial, sans-serif" font-size="${Math.round(itemNameSize * 0.6)}" font-weight="bold" fill="#ffffff" text-anchor="middle">CHECK QTY</text>`
        : '';

      const itemSvg = Buffer.from(
        `<svg width="${textWidth + 10}" height="${thumbSize + 10}" xmlns="http://www.w3.org/2000/svg">` +
        `<g opacity="${itemOpacity}">` +
        `<text x="0" y="${Math.round(itemNameSize * 1.2)}" font-family="Arial, sans-serif" font-size="${itemNameSize}" font-weight="bold" fill="#222222">${itemDesc}</text>` +
        `<text x="0" y="${Math.round(itemNameSize * 2.5)}" font-family="Arial, sans-serif" font-size="${itemDetailSize}" fill="#666666">${itemSku}</text>` +
        `<text x="0" y="${Math.round(itemNameSize * 3.6)}" font-family="Arial, sans-serif" font-size="${itemDetailSize}" fill="#888888">${imageCount} image${imageCount !== 1 ? 's' : ''}${tags ? ' • ' + tags : ''}${activeTeam && !isActiveTeamItem ? ' (other team)' : ''}</text>` +
        specialtyBadge +
        `<text x="${qtyX}" y="${Math.round(itemQtySize * 1.1)}" font-family="Arial, sans-serif" font-size="${itemQtySize}" font-weight="bold" fill="${qtyColor}" text-anchor="end">${itemQty}</text>` +
        qtyBadge +
        `</g></svg>`
      );

      composites.push({
        input: itemSvg,
        left: textX,
        top: itemY,
      });

      itemY += itemRowHeight;

      // Divider between items
      if (idx < order.items.length - 1) {
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
    const safeTeamName = activeTeam ? '_' + activeTeam.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_') : '';
    const filename = `${order.num}_packing_slip${safeTeamName}.jpg`;
    const filePath = path.join(orderDir, filename);
    await fs.writeFile(filePath, finalBuffer);

    console.log(`[PackingSlip] Generated ${filename} (${SLIP_WIDTH}x${SLIP_HEIGHT}px, ${itemCount} items, thumbSize=${thumbSize}px${activeTeam ? ', team=' + activeTeam : ''})`);

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
