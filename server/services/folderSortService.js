const fs = require('fs-extra');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'folder-sort.json');

/**
 * Available sort levels for folder organization.
 * 'no_sort' is special — it means all files go flat in the root folder.
 */
const SORT_OPTIONS = [
  { id: 'no_sort', label: 'No Sort', description: 'All files flat in the root download folder (no subfolders)' },
  { id: 'gallery', label: 'Gallery', description: 'Group by gallery name' },
  { id: 'order_id', label: 'Order ID', description: 'Group by PhotoDay order number' },
  { id: 'shipping_type', label: 'Shipping Type', description: 'Group by Dropship vs Bulk' },
  { id: 'shipping_name', label: 'Shipping Name', description: 'Group by shipping option name (e.g., Ground, Expedited)' },
  { id: 'studio', label: 'Studio', description: 'Group by studio name' },
  { id: 'date', label: 'Date', description: 'Group by order date (YYYY-MM-DD)' },
];

const DEFAULT_SORT = ['order_id'];

class FolderSortService {
  constructor() {
    this._ensureConfig();
  }

  _ensureConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeJsonSync(CONFIG_PATH, { sortLevels: DEFAULT_SORT }, { spaces: 2 });
    }
  }

  async _read() { return fs.readJson(CONFIG_PATH); }
  async _write(data) { await fs.writeJson(CONFIG_PATH, data, { spaces: 2 }); }

  getSortOptions() { return SORT_OPTIONS; }

  async getSortLevels() {
    const data = await this._read();
    return data.sortLevels || DEFAULT_SORT;
  }

  async setSortLevels(levels) {
    const validIds = SORT_OPTIONS.map(o => o.id);
    for (const level of levels) {
      if (!validIds.includes(level)) {
        throw new Error(`Invalid sort level: "${level}". Valid: ${validIds.join(', ')}`);
      }
    }
    if (levels.length === 0) {
      throw new Error('At least one sort level is required');
    }
    // If no_sort is selected, it should be the only level
    if (levels.includes('no_sort') && levels.length > 1) {
      throw new Error('"No Sort" cannot be combined with other sort levels');
    }
    const data = await this._read();
    data.sortLevels = levels;
    await this._write(data);
    return levels;
  }

  async buildOrderPath(order) {
    const levels = await this.getSortLevels();
    return this._buildPathFromLevels(order, levels);
  }

  _buildPathFromLevels(order, levels) {
    // No sort = empty segments = files go directly in base folder
    if (levels.length === 1 && levels[0] === 'no_sort') {
      return [];
    }

    const segments = [];
    for (const level of levels) {
      if (level === 'no_sort') continue; // Skip if somehow mixed in
      const value = this._extractSortValue(order, level);
      const safeName = value.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Unknown';
      segments.push(safeName);
    }
    return segments;
  }

  _extractSortValue(order, level) {
    switch (level) {
      case 'gallery':
        return order.gallery || 'No Gallery';

      case 'order_id':
        return order.num || order.id || 'Unknown';

      case 'shipping_type':
        return (order.groups && order.groups.length > 1) ? 'Bulk' : 'Dropship';

      case 'shipping_name':
        return order.shipping?.option?.name || 'No Shipping Option';

      case 'studio':
        return order.studio?.name || 'Unknown Studio';

      case 'date':
        if (order.placedAt) {
          return new Date(order.placedAt).toISOString().split('T')[0];
        }
        return 'Unknown Date';

      default:
        return 'Unknown';
    }
  }

  async getFullOrderPath(order, basePath) {
    const segments = await this.buildOrderPath(order);
    if (segments.length === 0) {
      return basePath; // No sort — flat in root
    }
    return path.join(basePath, ...segments);
  }
}

module.exports = new FolderSortService();
