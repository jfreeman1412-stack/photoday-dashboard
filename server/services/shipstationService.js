const axios = require('axios');
const config = require('../config');

class ShipStationService {
  constructor() {
    const authString = Buffer.from(
      `${config.shipstation.apiKey}:${config.shipstation.apiSecret}`
    ).toString('base64');

    this.client = axios.create({
      baseURL: config.shipstation.baseUrl,
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error.response?.status;
        const message = error.response?.data?.Message || error.message;
        const details = error.response?.data;
        console.error(`[ShipStation Error] ${status}: ${message}`);
        if (details && typeof details === 'object') {
          console.error(`[ShipStation Error Details]`, JSON.stringify(details, null, 2));
        }
        if (error.config?.data) {
          console.error(`[ShipStation Request Body]`, error.config.data);
        }
        if (status === 429) {
          const retryAfter = error.response.headers['retry-after'] || 30;
          console.warn(`[ShipStation] Rate limited. Retry after ${retryAfter}s`);
        }
        throw error;
      }
    );
  }

  // ─── ORDERS ───────────────────────────────────────────────

  async createOrder(orderData) {
    // Strip null/undefined values recursively — ShipStation rejects null fields
    const cleaned = this._stripNulls(orderData);
    const jsonBody = JSON.stringify(cleaned);

    // Use native https to bypass any axios encoding issues
    const https = require('https');
    const url = new URL(`${config.shipstation.baseUrl}/orders/createorder`);
    const authString = Buffer.from(
      `${config.shipstation.apiKey}:${config.shipstation.apiSecret}`
    ).toString('base64');

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(jsonBody),
        },
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(body);
            }
          } else {
            console.error(`[ShipStation Error] ${res.statusCode}: ${body}`);
            console.error(`[ShipStation Request Body]`, jsonBody);
            reject(new Error(`ShipStation ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', reject);
      req.write(jsonBody);
      req.end();
    });
  }

  /**
   * Recursively remove null/undefined values from an object.
   * ShipStation's API rejects payloads with explicit null values.
   */
  _stripNulls(obj) {
    if (Array.isArray(obj)) {
      return obj.map(item => this._stripNulls(item));
    }
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== null && value !== undefined) {
          result[key] = this._stripNulls(value);
        }
      }
      return result;
    }
    return obj;
  }

  async getOrder(orderId) {
    const { data } = await this.client.get(`/orders/${orderId}`);
    return data;
  }

  async listOrders(params = {}) {
    const { data } = await this.client.get('/orders', { params });
    return data;
  }

  async deleteOrder(orderId) {
    const { data } = await this.client.delete(`/orders/${orderId}`);
    return data;
  }

  async deleteOrders(orderIds) {
    const results = [];
    for (const id of orderIds) {
      try {
        const result = await this.deleteOrder(id);
        results.push({ id, success: true, result });
      } catch (error) {
        results.push({ id, success: false, error: error.message });
      }
    }
    return results;
  }

  async markAsShipped(shipmentData) {
    const { data } = await this.client.post('/orders/markasshipped', shipmentData);
    return data;
  }

  // ─── CARRIERS ─────────────────────────────────────────────

  async listCarriers() {
    const { data } = await this.client.get('/carriers');
    return data;
  }

  async listServices(carrierCode) {
    const { data } = await this.client.get('/carriers/listservices', { params: { carrierCode } });
    return data;
  }

  async listPackages(carrierCode) {
    const { data } = await this.client.get('/carriers/listpackages', { params: { carrierCode } });
    return data;
  }

  async getRates(rateData) {
    const { data } = await this.client.post('/shipments/getrates', rateData);
    return data;
  }

  // ─── BUILD ORDER FROM PDX DATA ────────────────────────────

  /**
   * Build a ShipStation order from a PDX order object.
   * Creates the order in awaiting_shipment status — label is NOT purchased.
   * User reviews and buys labels manually in ShipStation.
   */
  buildOrderFromPDX(pdxOrder, overrides = {}) {
    const shipping = pdxOrder.shipping || {};
    const dest = shipping.destination || {};
    const ret = shipping.return || {};
    const studio = pdxOrder.studio || {};

    // Build ship-to address from PDX destination
    // Fall back to studio address if destination is empty (e.g., bulk/test orders)
    const hasDestAddress = dest.address1 && dest.city && dest.state && dest.zipCode;
    const shipTo = {
      name: dest.recipient || `${studio.name || 'Customer'}`,
      company: pdxOrder.gallery || '',
      street1: hasDestAddress ? dest.address1 : (studio.address1 || 'Address Required'),
      street2: (hasDestAddress ? dest.address2 : studio.address2) || null,
      city: hasDestAddress ? dest.city : (studio.city || 'Unknown'),
      state: hasDestAddress ? dest.state : (studio.state || 'MN'),
      postalCode: hasDestAddress ? dest.zipCode : (studio.zipCode || '00000'),
      country: 'US',
      phone: dest.phone || dest.phoneNumber || studio.phone || '',
    };

    // Build bill-to from return info or studio address
    const billTo = {
      name: ret.name || ret.recipient || studio.name || '',
      street1: ret.address1 || studio.address1 || 'Address Required',
      street2: ret.address2 || studio.address2 || null,
      city: ret.city || studio.city || 'Unknown',
      state: ret.state || studio.state || 'MN',
      postalCode: ret.zipCode || studio.zipCode || '00000',
      country: 'US',
      phone: ret.phone || studio.phone || '',
    };

    // Log address status for debugging
    if (!hasDestAddress) {
      console.warn(`[ShipStation] Order ${pdxOrder.num}: No shipping destination — using studio address as placeholder`);
    }

    // Map all PDX items to ShipStation line items
    const items = [];
    for (const item of pdxOrder.items || []) {
      items.push({
        lineItemKey: String(item.id || ''),
        sku: String(item.externalId || ''),
        name: String(item.description || 'Photo Product'),
        quantity: item.quantity || 1,
        unitPrice: 0,
        options: [
          { name: 'Images', value: String((item.images || []).length) + ' file(s)' },
          { name: 'GroupId', value: String(item.groupId || 'default') },
        ],
      });
    }

    // Build internal notes with gallery and order context
    const internalNotes = [
      `Gallery: ${pdxOrder.gallery || 'N/A'}`,
      `Studio: ${pdxOrder.studio?.name || 'N/A'}`,
      `PDX Order ID: ${pdxOrder.id}`,
      `Items: ${items.length}`,
      pdxOrder.groups?.length > 1 ? `Bulk Order (${pdxOrder.groups.length} groups)` : 'Dropship Order',
    ].join(' | ');

    const payload = {
      orderNumber: pdxOrder.num,
      orderKey: pdxOrder.id,
      orderDate: pdxOrder.placedAt,
      orderStatus: 'awaiting_shipment',
      customerEmail: pdxOrder.studio?.email || '',
      billTo,
      shipTo,
      items,
      internalNotes,
      weight: {
        value: overrides.weight?.value || 4,
        units: overrides.weight?.units || 'ounces',
      },
      dimensions: {
        length: overrides.dimensions?.length || 10,
        width: overrides.dimensions?.width || 8,
        height: overrides.dimensions?.height || 0.5,
        units: overrides.dimensions?.units || 'inches',
      },
      confirmation: 'none',
    };

    console.log(`[ShipStation] Built order payload for ${pdxOrder.num}: ${items.length} items, ship to ${shipTo.name} (${shipTo.city}, ${shipTo.state})`);
    return payload;
  }
}

module.exports = new ShipStationService();
