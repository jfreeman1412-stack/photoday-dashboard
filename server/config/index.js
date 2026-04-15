require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');

const OVERRIDE_PATH = path.join(__dirname, 'path-overrides.json');

// Load path overrides synchronously at startup
let pathOverrides = {};
try {
  if (fs.existsSync(OVERRIDE_PATH)) {
    pathOverrides = fs.readJsonSync(OVERRIDE_PATH);
  }
} catch (e) { /* ignore */ }

/**
 * Resolve path variables like {date}, {year}, {month}, {day} at call time.
 */
function resolvePath(pathStr) {
  if (!pathStr) return pathStr;
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return pathStr
    .replace(/\{date\}/g, `${yyyy}-${mm}-${dd}`)
    .replace(/\{year\}/g, yyyy)
    .replace(/\{month\}/g, mm)
    .replace(/\{day\}/g, dd)
    .replace(/\{month_name\}/g, monthNames[now.getMonth()])
    .replace(/\{day_of_week\}/g, dayNames[now.getDay()]);
}

// Raw paths (with variables unresolved) for storage
const rawPaths = {
  downloadBase: pathOverrides.downloadBase || process.env.DOWNLOAD_BASE_PATH || './downloads',
  darkroomTemplateBase: pathOverrides.darkroomTemplateBase || process.env.DARKROOM_TEMPLATE_BASE_PATH || './templates',
  txtOutput: pathOverrides.txtOutput || process.env.TXT_OUTPUT_PATH || './output/orders',
};

module.exports = {
  port: process.env.PORT || 3001,
  env: process.env.NODE_ENV || 'development',

  photoday: {
    baseUrl: process.env.PHOTODAY_API_BASE_URL || 'https://api.photoday.io',
    labId: process.env.PHOTODAY_LAB_ID,
    secret: process.env.PHOTODAY_SECRET,
  },

  shipstation: {
    apiKey: process.env.SHIPSTATION_API_KEY,
    apiSecret: process.env.SHIPSTATION_API_SECRET,
    baseUrl: process.env.SHIPSTATION_API_BASE_URL || 'https://ssapi.shipstation.com',
  },

  // Paths are resolved with variables each time they're accessed
  paths: {
    get downloadBase() { return resolvePath(rawPaths.downloadBase); },
    get darkroomTemplateBase() { return resolvePath(rawPaths.darkroomTemplateBase); },
    get txtOutput() { return resolvePath(rawPaths.txtOutput); },
  },

  // Method to reload path overrides at runtime
  reloadPaths() {
    try {
      const overrides = fs.readJsonSync(OVERRIDE_PATH);
      rawPaths.downloadBase = overrides.downloadBase || process.env.DOWNLOAD_BASE_PATH || './downloads';
      rawPaths.darkroomTemplateBase = overrides.darkroomTemplateBase || process.env.DARKROOM_TEMPLATE_BASE_PATH || './templates';
      rawPaths.txtOutput = overrides.txtOutput || process.env.TXT_OUTPUT_PATH || './output/orders';
    } catch (e) { /* ignore */ }
  },

  defaults: {
    carrier: process.env.DEFAULT_CARRIER || 'usps',
    dpi: parseInt(process.env.DEFAULT_DPI, 10) || 300,
    indexPrintEnabled: process.env.INDEX_PRINT_ENABLED === 'true',
  },
};
