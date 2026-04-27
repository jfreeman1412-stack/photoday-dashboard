const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const photodayService = require('./photodayService');
const folderSortService = require('./folderSortService');
const specialtyService = require('./specialtyService');

class FileService {
  /**
   * Download a single image from a URL and save it locally.
   */
  async downloadImage(imageUrl, savePath) {
    await fs.ensureDir(path.dirname(savePath));
    const buffer = await photodayService.downloadAsset(imageUrl);
    await fs.writeFile(savePath, buffer);
    return savePath;
  }

  /**
   * Build the output folder path for an order based on the folder sort settings.
   * Resolves order-specific path variables like {gallery} in the base path.
   *
   * @param {object} order - PDX order object
   * @param {object} options - { downloadPath, sortLevels (override) }
   * @returns {string} Full folder path for this order's files
   */
  async getOrderDir(order, options = {}) {
    let baseDir = options.downloadPath || config.paths.downloadBase;

    // Resolve order-specific variables in the base path ({gallery}, {order_id}, {studio})
    const pathConfig = require('../config/pathConfig');
    baseDir = pathConfig.resolvePath(baseDir, {
      gallery: order.gallery,
      orderNum: order.num,
      studioName: order.studio?.name,
    });

    // Check for per-gallery folder sort override
    if (!options.sortLevels && order.gallery) {
      try {
        const databaseService = require('./database');
        const db = databaseService.getDb();
        const row = db.prepare("SELECT value FROM settings WHERE key = 'gallerySettings'").get();
        const gallerySettings = row ? JSON.parse(row.value) : {};
        const gc = gallerySettings[order.gallery];
        if (gc && gc.folderSort && gc.folderSort.length > 0) {
          console.log(`[FileService] Using per-gallery sort for "${order.gallery}": ${gc.folderSort.join(' → ')}`);
          const segments = folderSortService._buildPathFromLevels(order, gc.folderSort);
          return path.join(baseDir, ...segments);
        }
      } catch (err) { /* fall through to global sort */ }
    }

    if (options.sortLevels) {
      const segments = folderSortService._buildPathFromLevels(order, options.sortLevels);
      return path.join(baseDir, ...segments);
    }

    return folderSortService.getFullOrderPath(order, baseDir);
  }

  /**
   * Download all print-ready assets for a PDX order.
   * Regular items go in the order folder. Specialty items go to their own subfolder.
   */
  async downloadOrderImages(order, options = {}) {
    const orderDir = await this.getOrderDir(order, options);
    await fs.ensureDir(orderDir);

    console.log(`[FileService] Downloading images for ${order.num} → ${orderDir}`);

    const images = photodayService.extractOrderImages(order);
    console.log(`[FileService] Found ${images.length} image(s) to download`);

    const downloaded = [];
    const specialtyDownloaded = [];
    const errors = [];

    for (const img of images) {
      if (!img.assetUrl) {
        console.warn(`[FileService] No assetUrl for ${img.filename}`);
        errors.push({ filename: img.filename, error: 'No assetUrl available' });
        continue;
      }

      try {
        const filename = img.filename || `${img.imageId}.jpg`;

        // Check if this is a specialty item
        const isSpecialty = await specialtyService.isSpecialty(img.itemExternalId);
        let savePath;

        if (isSpecialty) {
          const specialtyFolder = await specialtyService.getSpecialtyFolder(img.itemExternalId);
          await fs.ensureDir(specialtyFolder);
          savePath = path.join(specialtyFolder, filename);
        } else {
          savePath = path.join(orderDir, filename);
        }

        if (await fs.pathExists(savePath) && !options.forceRedownload) {
          console.log(`[FileService] Skipping (exists): ${filename}`);
          const entry = {
            filename, path: savePath,
            itemDescription: img.itemDescription, quantity: img.quantity,
            isSpecialty, skipped: true,
          };
          if (isSpecialty) specialtyDownloaded.push(entry);
          else downloaded.push(entry);
          continue;
        }

        await this.downloadImage(img.assetUrl, savePath);
        console.log(`[FileService] Downloaded: ${filename}${isSpecialty ? ' (specialty)' : ''}`);
        const entry = {
          filename, path: savePath,
          itemDescription: img.itemDescription, quantity: img.quantity,
          orientation: img.orientation, itemExternalId: img.itemExternalId,
          groupId: img.groupId, isSpecialty, skipped: false,
        };
        if (isSpecialty) specialtyDownloaded.push(entry);
        else downloaded.push(entry);
      } catch (error) {
        console.error(`[FileService] Download error for ${img.filename}: ${error.message}`);
        errors.push({ filename: img.filename, assetUrl: img.assetUrl, error: error.message });
      }
    }

    console.log(`[FileService] Complete: ${downloaded.length} regular, ${specialtyDownloaded.length} specialty, ${errors.length} errors`);

    return {
      orderNum: order.num,
      orderDir,
      downloaded,
      specialtyDownloaded,
      errors,
      totalImages: images.length,
      successCount: downloaded.length + specialtyDownloaded.length,
      errorCount: errors.length,
    };
  }

  /**
   * Get folder structure info.
   */
  async getFolderStructure(basePath) {
    const baseDir = basePath || config.paths.downloadBase;
    if (!(await fs.pathExists(baseDir))) {
      return { basePath: baseDir, folders: [], totalSize: 0 };
    }

    const folders = [];
    await this._scanFolders(baseDir, baseDir, folders);

    return {
      basePath: baseDir,
      folders,
      totalFolders: folders.length,
      totalSize: folders.reduce((sum, f) => sum + f.totalSize, 0),
    };
  }

  /**
   * Recursively scan folders to handle nested sort hierarchies.
   */
  async _scanFolders(currentPath, basePath, results) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    const files = entries.filter(e => e.isFile());
    const dirs = entries.filter(e => e.isDirectory());

    // If this folder has files, add it as a leaf folder
    if (files.length > 0) {
      const stats = await Promise.all(
        files.map(async (f) => {
          const s = await fs.stat(path.join(currentPath, f.name));
          return { name: f.name, size: s.size };
        })
      );
      results.push({
        name: path.relative(basePath, currentPath),
        path: currentPath,
        fileCount: files.length,
        totalSize: stats.reduce((sum, s) => sum + s.size, 0),
        files: stats,
      });
    }

    // Recurse into subdirectories
    for (const dir of dirs) {
      await this._scanFolders(path.join(currentPath, dir.name), basePath, results);
    }
  }

  /**
   * Clean up downloaded files for an order.
   */
  async cleanupOrder(orderNumber) {
    const baseDir = config.paths.downloadBase;
    // Search recursively for a folder matching the order number
    const found = await this._findFolder(baseDir, orderNumber);
    if (found) {
      await fs.remove(found);
      return { removed: true, path: found };
    }
    return { removed: false, path: null };
  }

  async _findFolder(dir, name) {
    if (!(await fs.pathExists(dir))) return null;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === name) return path.join(dir, entry.name);
        const found = await this._findFolder(path.join(dir, entry.name), name);
        if (found) return found;
      }
    }
    return null;
  }
}

module.exports = new FileService();
