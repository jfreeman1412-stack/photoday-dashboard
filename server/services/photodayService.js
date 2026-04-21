const axios = require('axios');
const config = require('../config');

class PhotoDayService {
  constructor() {
    this.labId = config.photoday.labId;
    this.baseUrl = config.photoday.baseUrl;
    this.secret = config.photoday.secret;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.secret}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error.response?.status;
        const message = error.response?.data?.message || error.response?.data?.error || error.message;
        console.error(`[PhotoDay PDX Error] ${status}: ${message}`);
        throw error;
      }
    );
  }

  // ─── ORDER RETRIEVAL ──────────────────────────────────────

  /**
   * Fetch unprocessed orders (up to 50 per call, oldest first).
   */
  async getOrders() {
    const { data } = await this.client.get(`/pdx/${this.labId}/integrations/orders`);
    return Array.isArray(data) ? data : (data ? [data] : []);
  }

  /**
   * Fetch ALL unprocessed orders across multiple batches.
   * If autoProcess is true, marks each batch as processed before fetching next.
   */
  async getAllOrders({ autoProcess = false } = {}) {
    const allOrders = [];
    let batchCount = 0;
    const maxBatches = 20;

    while (batchCount < maxBatches) {
      const orders = await this.getOrders();
      if (!orders || orders.length === 0) break;

      allOrders.push(...orders);
      batchCount++;

      if (autoProcess) {
        for (const order of orders) {
          try {
            await this.markAsProcessed(order.num);
          } catch (err) {
            console.error(`[PhotoDay] Failed to mark ${order.num} as processed:`, err.message);
          }
        }
      }

      if (orders.length < 50) break;
    }

    console.log(`[PhotoDay] Fetched ${allOrders.length} orders in ${batchCount} batch(es)`);
    return allOrders;
  }

  // ─── ORDER UPDATES ────────────────────────────────────────

  /**
   * Mark order as processed so it won't appear in future retrievals.
   * @param {string} orderNum - Order number (e.g. "SB1773428567"), NOT the UUID
   * @param {string|null} externalId - Your internal ID (optional)
   */
  async markAsProcessed(orderNum, externalId = null) {
    const { data } = await this.client.post(
      `/pdx/${this.labId}/integrations/orders/${orderNum}/processed`,
      { externalId }
    );
    console.log(`[PhotoDay] Order ${orderNum} marked as processed`);
    return data;
  }

  /**
   * Mark order as shipped. PhotoDay notifies the customer with tracking info.
   * @param {string} orderNum - Order number (NOT UUID)
   * @param {string} carrier - UPS|UPSMI|FEDEX|USPS|DHL
   * @param {string} trackingNumber - Tracking number
   */
  async markAsShipped(orderNum, carrier, trackingNumber) {
    const { data } = await this.client.post(
      `/pdx/${this.labId}/integrations/orders/${orderNum}/shipped`,
      { carrier, trackingNumber }
    );
    console.log(`[PhotoDay] Order ${orderNum} marked as shipped (${carrier}: ${trackingNumber})`);
    return data;
  }

  // ─── HELPERS ──────────────────────────────────────────────

  /**
   * Download a print-ready asset from its URL (expires after 30 days).
   */
  async downloadAsset(assetUrl) {
    // Use the URL as-is — don't decode/re-encode to avoid malformed URI errors
    const filename = assetUrl.substring(assetUrl.lastIndexOf('/') + 1).split('?')[0];
    console.log(`[PhotoDay] Downloading: ${decodeURIComponent(filename)}`);
    
    const response = await axios.get(assetUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      // Prevent axios from re-encoding the URL
      paramsSerializer: { encode: (param) => param },
    });
    return Buffer.from(response.data);
  }

  /**
   * Extract all images from an order into a flat array.
   */
  extractOrderImages(order) {
    const images = [];
    for (const item of order.items || []) {
      for (const image of item.images || []) {
        images.push({
          itemId: item.id,
          itemExternalId: item.externalId,
          itemDescription: item.description,
          quantity: item.quantity,
          groupId: item.groupId,
          imageId: image.id,
          imageExternalId: image.externalId,
          assetUrl: image.assetUrl,
          filename: image.filename,
          orientation: image.orientation,
        });
      }
    }
    return images;
  }

  /**
   * Check if order is bulk (multiple groups) or dropship (single group).
   */
  isBulkOrder(order) {
    return order.groups && order.groups.length > 1;
  }

  /**
   * Get normalized shipping info from order.
   */
  getShippingInfo(order) {
    const s = order.shipping || {};
    return {
      option: s.option || null,
      destination: s.destination ? {
        recipient: s.destination.recipient,
        address1: s.destination.address1,
        address2: s.destination.address2,
        city: s.destination.city,
        state: s.destination.state,
        zipCode: s.destination.zipCode,
        country: s.destination.country,
        phone: s.destination.phoneNumber || s.destination.phone,
      } : null,
      returnAddress: s.return || null,
    };
  }

  /**
   * Extract customer name from order (tries destination, then group fields).
   */
  getCustomerName(order) {
    if (order.shipping?.destination?.recipient) {
      const parts = order.shipping.destination.recipient.split(' ');
      return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
    }
    if (order.groups?.length > 0) {
      const fields = order.groups[0].fields || [];
      return {
        firstName: fields.find(f => f.key === 'first_name')?.value || '',
        lastName: fields.find(f => f.key === 'last_name')?.value || '',
      };
    }
    return { firstName: '', lastName: '' };
  }

  /**
   * Get studio email (PDX orders don't have direct customer email).
   */
  getStudioEmail(order) {
    return order.studio?.email || '';
  }
}

module.exports = new PhotoDayService();
