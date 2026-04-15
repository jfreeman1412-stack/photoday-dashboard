const fs = require('fs-extra');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'path-overrides.json');

/**
 * Available path variables and their descriptions.
 */
const PATH_VARIABLES = [
  { token: '{date}', description: "Today's date (YYYY-MM-DD)", example: '2026-04-14' },
  { token: '{year}', description: 'Current year', example: '2026' },
  { token: '{month}', description: 'Current month (01-12)', example: '04' },
  { token: '{day}', description: 'Current day (01-31)', example: '14' },
  { token: '{month_name}', description: 'Month name', example: 'April' },
  { token: '{day_of_week}', description: 'Day of week', example: 'Monday' },
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Runtime path overrides.
 * These override the .env values and persist across restarts.
 * If a value is null/empty, the .env default is used.
 * Supports variables like {date}, {year}, {month}, {day}.
 */
class PathConfig {
  constructor() {
    this._ensureConfig();
  }

  _ensureConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeJsonSync(CONFIG_PATH, {
        downloadBase: null,
        darkroomTemplateBase: null,
        txtOutput: null,
      }, { spaces: 2 });
    }
  }

  async getOverrides() {
    return fs.readJson(CONFIG_PATH);
  }

  async setOverrides(overrides) {
    const data = await this.getOverrides();
    if (overrides.downloadBase !== undefined) data.downloadBase = overrides.downloadBase || null;
    if (overrides.darkroomTemplateBase !== undefined) data.darkroomTemplateBase = overrides.darkroomTemplateBase || null;
    if (overrides.txtOutput !== undefined) data.txtOutput = overrides.txtOutput || null;
    await fs.writeJson(CONFIG_PATH, data, { spaces: 2 });
    return data;
  }

  /**
   * Get available path variables.
   */
  getVariables() {
    return PATH_VARIABLES;
  }

  /**
   * Resolve variables in a path string.
   * Replaces {date}, {year}, {month}, {day}, {month_name}, {day_of_week} with current values.
   */
  resolvePath(pathStr) {
    if (!pathStr) return pathStr;

    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    return pathStr
      .replace(/\{date\}/g, `${yyyy}-${mm}-${dd}`)
      .replace(/\{year\}/g, yyyy)
      .replace(/\{month\}/g, mm)
      .replace(/\{day\}/g, dd)
      .replace(/\{month_name\}/g, MONTH_NAMES[now.getMonth()])
      .replace(/\{day_of_week\}/g, DAY_NAMES[now.getDay()]);
  }

  /**
   * Get the effective path — override if set, otherwise .env default.
   * All variables are resolved at call time.
   */
  async getEffectivePaths(envConfig) {
    const overrides = await this.getOverrides();
    return {
      downloadBase: this.resolvePath(overrides.downloadBase || envConfig.downloadBase),
      darkroomTemplateBase: this.resolvePath(overrides.darkroomTemplateBase || envConfig.darkroomTemplateBase),
      txtOutput: this.resolvePath(overrides.txtOutput || envConfig.txtOutput),
    };
  }
}

module.exports = new PathConfig();
