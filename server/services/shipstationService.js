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
    const cleaned = this._stripNulls(orderData);
    const jsonBody = JSON.stringify(cleaned);

    const https = require('https');
    const url = new URL(`${config.shipstation.baseUrl}/orders/createorder`);
    const authString = Buffer.from(
      `${config.shipstation.apiKey}:${config.shipstation.apiSecret}`
    ).toString('base64');

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(jsonBody),
          'Accept': 'application/json',
          'User-Agent': 'sportsline-dashboard/1.0',
        },
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(body)); } catch { resolve(body); }
          } else {
            console.error(`[ShipStation Error] ${res.statusCode}: ${body || '(empty body)'}`);
            console.error(`[ShipStation Request Body]`, jsonBody);
            reject(new Error(`ShipStation ${res.statusCode}: ${body || '(empty)'}`));
          }
        });
      });
      req.on('error', reject);
      req.write(jsonBody);
      req.end();
    });
  }

  _stripNulls(obj) {
    if (Array.isArray(obj)) return obj.map(item => this._stripNulls(item));
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== null && value !== undefined) result[key] = this._stripNulls(value);
      }
      return result;
    }
    return obj;
  }

  async getOrder(orderId) { const { data } = await this.client.get(`/orders/${orderId}`); return data; }
  async listOrders(params = {}) { const { data } = await this.client.get('/orders', { params }); return data; }
  async listShipments(params = {}) { const { data } = await this.client.get('/shipments', { params }); return data; }
  async deleteOrder(orderId) { const { data } = await this.client.delete(`/orders/${orderId}`); return data; }

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

  async markAsShipped(shipmentData) { const { data } = await this.client.post('/orders/markasshipped', shipmentData); return data; }

  // ─── CARRIERS ─────────────────────────────────────────────

  async listCarriers() { const { data } = await this.client.get('/carriers'); return data; }
  async listServices(carrierCode) { const { data } = await this.client.get('/carriers/listservices', { params: { carrierCode } }); return data; }
  async listPackages(carrierCode) { const { data } = await this.client.get('/carriers/listpackages', { params: { carrierCode } }); return data; }
  async getRates(rateData) { const { data } = await this.client.post('/shipments/getrates', rateData); return data; }

  // ─── BUILD ORDER FROM PDX DATA ────────────────────────────

  /**
   * Build a ShipStation order from a PDX order object.
   * Uses the packaging rules engine to determine dimensions, weight, and service.
   */
  async buildOrderFromPDX(pdxOrder, overrides = {}) {
    const shipping = pdxOrder.shipping || {};
    const dest = shipping.destination || {};
    const ret = shipping.return || {};
    const studio = pdxOrder.studio || {};

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

    if (!hasDestAddress) {
      console.warn(`[ShipStation] Order ${pdxOrder.num}: No shipping destination — using studio address as placeholder`);
    }

    // ─── Use Packaging Rules Engine ─────────────────────
    let packaging;
    try {
      const packagingService = require('./packagingService');
      packaging = await packagingService.determinePackaging(pdxOrder);
      console.log(`[ShipStation] Packaging for ${pdxOrder.num}: ${packaging.packageTypeName} (${packaging.dimensions.length}x${packaging.dimensions.width}x${packaging.dimensions.height}") ${packaging.weight.value}oz — ${packaging.carrierCode}/${packaging.serviceCode}/${packaging.packageCode}`);
      if (packaging.notes?.length > 0) {
        console.log(`[ShipStation] Packaging notes: ${packaging.notes.join('; ')}`);
      }
    } catch (pkgErr) {
      console.error(`[ShipStation] Packaging engine error: ${pkgErr.message} — using defaults`);
      packaging = {
        dimensions: { length: 10, width: 8, height: 0.5, units: 'inches' },
        weight: { value: 4, units: 'ounces' },
        carrierCode: 'stamps_com',
        serviceCode: 'usps_first_class_mail',
        packageCode: 'large_envelope_or_flat',
        itemWeights: [],
      };
    }

    // Build line items, attaching per-item weights from the packaging engine.
    // ShipStation sums line-item weights when SKUs match product records with default
    // weights — so we MUST set per-item weights or our order-level weight gets overwritten.
    // We send weights in GRAMS (integers) rather than ounces because ShipStation
    // truncates fractional ounces per line before summing — losing up to ~1oz on
    // multi-line orders. Grams are integer-valued so this lossy rounding can't bite us.
    const OZ_TO_G = 28.3495;
    const itemWeightMap = {};
    for (const iw of (packaging.itemWeights || [])) {
      if (iw.lineItemKey) itemWeightMap[iw.lineItemKey] = iw.weightOz;
    }

    const items = [];
    for (const item of pdxOrder.items || []) {
      const lineItemKey = String(item.id || '');
      const lineWeightOz = itemWeightMap[lineItemKey];
      const itemPayload = {
        lineItemKey,
        sku: String(item.externalId || ''),
        name: String(item.description || 'Photo Product'),
        quantity: item.quantity || 1,
        unitPrice: 0,
        options: [
          { name: 'Images', value: String((item.images || []).length) + ' file(s)' },
          { name: 'GroupId', value: String(item.groupId || 'default') },
        ],
      };
      // Per-quantity weight: ShipStation expects the unit weight; it multiplies by quantity itself.
      // Our packaging engine returns line-total weight (qty × unit), so divide back out,
      // then convert to grams.
      if (lineWeightOz !== undefined) {
        const qty = item.quantity || 1;
        const unitWeightOz = qty > 0 ? (lineWeightOz / qty) : lineWeightOz;
        const unitWeightG = Math.round(unitWeightOz * OZ_TO_G);
        itemPayload.weight = {
          value: unitWeightG,
          units: 'grams',
        };
      }
      items.push(itemPayload);
    }

    const internalNotes = [
      `Gallery: ${pdxOrder.gallery || 'N/A'}`,
      `Studio: ${pdxOrder.studio?.name || 'N/A'}`,
      `PDX Order ID: ${pdxOrder.id}`,
      `Items: ${items.length}`,
      pdxOrder.groups?.length > 1 ? `Bulk Order (${pdxOrder.groups.length} groups)` : 'Dropship Order',
    ].join(' | ');

    // Allow manual overrides to take precedence
    const finalWeightOz = overrides.weight || packaging.weight;
    const finalDims = overrides.dimensions || packaging.dimensions;
    const finalCarrier = overrides.carrierCode || packaging.carrierCode || null;
    const finalService = overrides.serviceCode || packaging.serviceCode || null;
    const finalPackage = overrides.packageCode || packaging.packageCode || null;

    // Convert order-level weight to grams to match line items (avoids ShipStation's
    // per-line oz truncation behavior on multi-item orders).
    const finalWeightG = (finalWeightOz && typeof finalWeightOz.value === 'number')
      ? { value: Math.round(finalWeightOz.value * OZ_TO_G), units: 'grams' }
      : finalWeightOz;

    const payload = {
      orderNumber: pdxOrder.num,
      orderKey: pdxOrder.id,
      orderDate: pdxOrder.placedAt,
      orderStatus: 'awaiting_shipment',
      customerEmail: pdxOrder.studio?.email || '',
      billTo,
      shipTo,
      items,
      internalNotes: internalNotes + ` | Pkg: ${packaging.packageTypeName} | ${packaging.carrierCode}/${packaging.serviceCode}/${packaging.packageCode}`,
      weight: finalWeightG,
      dimensions: finalDims,
      confirmation: 'none',
      carrierCode: finalCarrier,
      serviceCode: finalService,
      packageCode: finalPackage,
      requestedShippingService: finalService,
    };

    console.log(`[ShipStation] Built order payload for ${pdxOrder.num}: ${items.length} items, ship to ${shipTo.name} (${shipTo.city}, ${shipTo.state}), packageCode=${finalPackage}`);
    return payload;
  }
}

module.exports = new ShipStationService();
