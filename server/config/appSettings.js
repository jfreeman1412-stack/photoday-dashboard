const fs = require('fs-extra');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'app-settings.json');

/**
 * Fields that are considered secrets and should be masked in API responses.
 */
const SECRET_FIELDS = [
  'photodaySecret',
  'shipstationApiKey',
  'shipstationApiSecret',
];

/**
 * All configurable fields with their env variable names, labels, and defaults.
 */
const FIELD_DEFINITIONS = [
  // PhotoDay
  { key: 'photodayBaseUrl', envKey: 'PHOTODAY_API_BASE_URL', label: 'PhotoDay API Base URL', section: 'photoday', default: 'https://api.photoday.io', secret: false },
  { key: 'photodayLabId', envKey: 'PHOTODAY_LAB_ID', label: 'PhotoDay Lab ID', section: 'photoday', default: '', secret: false },
  { key: 'photodaySecret', envKey: 'PHOTODAY_SECRET', label: 'PhotoDay Secret (JWT)', section: 'photoday', default: '', secret: true },

  // ShipStation
  { key: 'shipstationApiKey', envKey: 'SHIPSTATION_API_KEY', label: 'ShipStation API Key', section: 'shipstation', default: '', secret: true },
  { key: 'shipstationApiSecret', envKey: 'SHIPSTATION_API_SECRET', label: 'ShipStation API Secret', section: 'shipstation', default: '', secret: true },
  { key: 'shipstationBaseUrl', envKey: 'SHIPSTATION_API_BASE_URL', label: 'ShipStation API Base URL', section: 'shipstation', default: 'https://ssapi.shipstation.com', secret: false },

  // Paths
  { key: 'downloadBasePath', envKey: 'DOWNLOAD_BASE_PATH', label: 'Download Base Path', section: 'paths', default: './downloads', secret: false },
  { key: 'darkroomTemplateBasePath', envKey: 'DARKROOM_TEMPLATE_BASE_PATH', label: 'Darkroom Template Base Path', section: 'paths', default: './templates', secret: false },
  { key: 'txtOutputPath', envKey: 'TXT_OUTPUT_PATH', label: 'TXT Output Path', section: 'paths', default: './output/orders', secret: false },

  // Defaults
  { key: 'defaultCarrier', envKey: 'DEFAULT_CARRIER', label: 'Default Carrier', section: 'defaults', default: 'USPS', secret: false },
  { key: 'defaultDpi', envKey: 'DEFAULT_DPI', label: 'Default DPI', section: 'defaults', default: '300', secret: false },
  { key: 'port', envKey: 'PORT', label: 'Server Port', section: 'server', default: '3001', secret: false },
];

class AppSettingsService {
  constructor() {
    this._ensureConfig();
  }

  _ensureConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeJsonSync(CONFIG_PATH, { settings: {} }, { spaces: 2 });
    }
  }

  async _read() { return fs.readJson(CONFIG_PATH); }
  async _write(data) { await fs.writeJson(CONFIG_PATH, data, { spaces: 2 }); }

  /**
   * Get all settings with secrets masked.
   * Returns the effective value (override > env > default) with secrets shown as ••••••••
   */
  async getSettings() {
    const data = await this._read();
    const saved = data.settings || {};

    const result = {};
    for (const field of FIELD_DEFINITIONS) {
      const savedValue = saved[field.key];
      const envValue = process.env[field.envKey];
      const effectiveValue = savedValue || envValue || field.default;

      result[field.key] = {
        key: field.key,
        label: field.label,
        section: field.section,
        secret: field.secret,
        hasValue: !!(savedValue || envValue),
        isOverridden: !!savedValue,
        // Mask secrets — show only if no value has been set yet (to prompt setup)
        value: field.secret && effectiveValue ? '••••••••' : effectiveValue,
      };
    }
    return result;
  }

  /**
   * Get field definitions for the UI.
   */
  getFieldDefinitions() {
    return FIELD_DEFINITIONS.map(f => ({
      key: f.key,
      label: f.label,
      section: f.section,
      secret: f.secret,
      default: f.default,
    }));
  }

  /**
   * Update settings. Only saves non-empty values.
   * For secret fields, '••••••••' means "keep existing value".
   */
  async updateSettings(updates) {
    const data = await this._read();
    const saved = data.settings || {};

    for (const [key, value] of Object.entries(updates)) {
      const field = FIELD_DEFINITIONS.find(f => f.key === key);
      if (!field) continue;

      // Skip if it's a masked secret (user didn't change it)
      if (field.secret && value === '••••••••') continue;

      // Save the value (or remove if empty to fall back to env)
      if (value && value.trim()) {
        saved[key] = value.trim();
      } else {
        delete saved[key];
      }
    }

    data.settings = saved;
    await this._write(data);

    // Apply to process.env so changes take effect immediately
    this._applyToEnv(saved);

    return this.getSettings();
  }

  /**
   * Get the raw (unmasked) value for a setting.
   * Used internally when the app needs the actual secret.
   */
  async getRawValue(key) {
    const field = FIELD_DEFINITIONS.find(f => f.key === key);
    if (!field) return null;

    const data = await this._read();
    const saved = data.settings || {};
    return saved[key] || process.env[field.envKey] || field.default;
  }

  /**
   * Apply saved settings to process.env so they take effect at runtime.
   */
  _applyToEnv(saved) {
    for (const field of FIELD_DEFINITIONS) {
      if (saved[field.key]) {
        process.env[field.envKey] = saved[field.key];
      }
    }
  }

  /**
   * Initialize — apply saved settings to process.env on startup.
   */
  async init() {
    const data = await this._read();
    const saved = data.settings || {};
    this._applyToEnv(saved);
  }
}

module.exports = new AppSettingsService();
