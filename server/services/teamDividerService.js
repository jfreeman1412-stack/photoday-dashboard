const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');

// 5×8" at 300dpi
const DIVIDER_WIDTH = 1500;
const DIVIDER_HEIGHT = 2400;

class TeamDividerService {
  /**
   * Generate a 5×8 divider sheet showing the team name. Used as a separator
   * between teams in batch print runs so the operator knows where each team
   * starts in the printed stack.
   *
   * @param {string} teamName - the team about to print, e.g. "10U Black-Brian"
   * @param {string} outputDir - directory to write the file into
   * @param {object} options - { itemCount, customerCount, gallery }
   * @returns {Promise<{ filePath, filename }>}
   */
  async generateDivider(teamName, outputDir, options = {}) {
    await fs.ensureDir(outputDir);

    const safeName = (teamName || 'TEAM').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
    const filename = `_DIVIDER_${safeName}.jpg`;
    const filePath = path.join(outputDir, filename);

    // Optional sub-line below the team name
    const subLineParts = [];
    if (options.customerCount != null) subLineParts.push(`${options.customerCount} customer${options.customerCount === 1 ? '' : 's'}`);
    if (options.itemCount != null) subLineParts.push(`${options.itemCount} item${options.itemCount === 1 ? '' : 's'}`);
    const subLine = subLineParts.join(' • ');
    const gallery = options.gallery || '';

    // Big bold team name centered. Layout:
    //   - "TEAM" small caps banner near top
    //   - Team name huge in middle
    //   - Optional sub-line + gallery near bottom
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
      <svg xmlns="http://www.w3.org/2000/svg" width="${DIVIDER_WIDTH}" height="${DIVIDER_HEIGHT}" viewBox="0 0 ${DIVIDER_WIDTH} ${DIVIDER_HEIGHT}">
        <rect x="0" y="0" width="${DIVIDER_WIDTH}" height="${DIVIDER_HEIGHT}" fill="#ffffff"/>
        <rect x="0" y="0" width="${DIVIDER_WIDTH}" height="240" fill="#1a1a1a"/>
        <rect x="0" y="${DIVIDER_HEIGHT - 240}" width="${DIVIDER_WIDTH}" height="240" fill="#1a1a1a"/>

        <text x="${DIVIDER_WIDTH / 2}" y="160" font-family="Arial Black, Arial, sans-serif" font-size="120" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="20">TEAM</text>

        ${this._renderTeamName(teamName, DIVIDER_WIDTH / 2, DIVIDER_HEIGHT / 2)}

        ${subLine ? `<text x="${DIVIDER_WIDTH / 2}" y="${DIVIDER_HEIGHT / 2 + 220}" font-family="Arial, sans-serif" font-size="70" fill="#444444" text-anchor="middle">${this._escape(subLine)}</text>` : ''}

        ${gallery ? `<text x="${DIVIDER_WIDTH / 2}" y="${DIVIDER_HEIGHT - 130}" font-family="Arial, sans-serif" font-size="60" fill="#cccccc" text-anchor="middle" font-style="italic">${this._escape(gallery)}</text>` : ''}
      </svg>`;

    const buffer = await sharp(Buffer.from(svg))
      .jpeg({ quality: 90 })
      .toBuffer();

    await fs.writeFile(filePath, buffer);
    return { filePath, filename };
  }

  /**
   * Render the team name as one or two lines depending on length.
   * Picks a font size that fits the 1500px width.
   */
  _renderTeamName(teamName, cx, cy) {
    const name = String(teamName || '').trim() || 'UNKNOWN';
    const escaped = this._escape(name);

    // Rough character width estimate at various sizes (Arial Black is ~0.6em wide).
    // Aim for max 1300px text width on a 1500px-wide canvas.
    // Pick the largest font where (chars * size * 0.6) <= 1300.
    const maxWidth = 1300;
    const charWidthRatio = 0.6;
    const idealSize = Math.floor(maxWidth / (name.length * charWidthRatio));
    // Cap at 320 (so short names look big but not absurd) and floor at 100
    const fontSize = Math.max(100, Math.min(320, idealSize));

    return `<text x="${cx}" y="${cy + fontSize / 3}" font-family="Arial Black, Arial, sans-serif" font-size="${fontSize}" font-weight="900" fill="#1a1a1a" text-anchor="middle">${escaped}</text>`;
  }

  _escape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

module.exports = new TeamDividerService();
