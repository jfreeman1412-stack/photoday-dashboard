require('dotenv').config();

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

  paths: {
    downloadBase: process.env.DOWNLOAD_BASE_PATH || './downloads',
    darkroomTemplateBase: process.env.DARKROOM_TEMPLATE_BASE_PATH || './templates',
    txtOutput: process.env.TXT_OUTPUT_PATH || './output/orders',
  },

  defaults: {
    carrier: process.env.DEFAULT_CARRIER || 'usps',
    dpi: parseInt(process.env.DEFAULT_DPI, 10) || 300,
    indexPrintEnabled: process.env.INDEX_PRINT_ENABLED === 'true',
  },
};
