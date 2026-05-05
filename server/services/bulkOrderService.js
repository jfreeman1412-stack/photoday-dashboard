/**
 * Bulk order helpers.
 *
 * Pure logic, no I/O. Turns a PhotoDay PDX bulk order's items+groups into
 * dancer buckets used by both:
 *   - schedulerService.processBulkOrder (initial batch run)
 *   - schedulerService.reprintBulkDancer (per-dancer reprint)
 *
 * Keeping the bucketing in one place ensures both flows produce identical
 * results — same dancer numbers, same merge behavior for same-named dancers,
 * same field extraction.
 *
 * Bucket key: `${last}|${first}` (lowercased, trimmed). Two dancers with the
 * exact same first+last name in different groups share a bucket; this matches
 * the existing scheduler behavior where Lily Pouliot's two groups merge into
 * one print job.
 */

class BulkOrderService {
  /**
   * Build a deterministic, URL-safe key from a dancer's name.
   * Used for routing reprints by dancer.
   *
   * Examples:
   *   ('Adelyn', 'Augst')        → 'augst-adelyn'
   *   ('Mary Ann', "O'Brien")    → 'obrien-mary-ann'
   *   ('', 'Smith')              → 'smith-'
   *   ('Smith', '')              → '-smith'  (firstName empty)
   */
  makeDancerKey(firstName, lastName) {
    const slug = (s) => (s || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')   // non-alphanumerics → dash
      .replace(/^-+|-+$/g, '');      // trim leading/trailing dashes
    return `${slug(lastName)}-${slug(firstName)}`;
  }

  /**
   * List all dancers in a bulk PDX order.
   *
   * @param {object} orderData - PDX order JSON (must have items[] and groups[])
   * @returns {Array<DancerBucket>} sorted by lastName, then firstName
   *
   * DancerBucket shape:
   *   {
   *     dancerKey:         string  ('augst-adelyn')
   *     dancerNum:         string  ('001'..'NNN', position in sorted list)
   *     firstName:         string
   *     lastName:          string
   *     items:             Array<orderItem>  (subset of orderData.items)
   *     itemUuids:         Array<string>
   *     customerOrderNums: Array<string>     (deduped; usually 1 entry, sometimes more
   *                                           if the same dancer name spans multiple
   *                                           sub-orders inside the bulk)
   *     groupIds:          Array<string>     (PDX group IDs this dancer's items came from)
   *   }
   */
  listDancers(orderData) {
    if (!orderData || !Array.isArray(orderData.items) || !Array.isArray(orderData.groups)) {
      return [];
    }

    // Index groups by id for fast lookup
    const groupById = new Map();
    for (const group of orderData.groups) {
      if (group && group.id) groupById.set(group.id, group);
    }

    // Bucket items by dancer
    const buckets = new Map();
    for (const item of orderData.items) {
      const group = groupById.get(item.groupId);
      if (!group) continue;

      const fields = group.fields || [];
      const firstName = (fields.find(f => f.key === 'first_name')?.value || '').trim();
      const lastName = (fields.find(f => f.key === 'last_name')?.value || '').trim();
      const customerOrderNum = (fields.find(f => f.key === 'num')?.value || '').trim();

      if (!firstName && !lastName) continue;

      const key = `${lastName.toLowerCase()}|${firstName.toLowerCase()}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          firstName,
          lastName,
          items: [],
          itemUuids: [],
          customerOrderNums: new Set(),
          groupIds: new Set(),
        });
      }
      const bucket = buckets.get(key);
      bucket.items.push(item);
      bucket.itemUuids.push(item.id);
      if (customerOrderNum) bucket.customerOrderNums.add(customerOrderNum);
      bucket.groupIds.add(group.id);
    }

    // Sort: lastName, then firstName, both case-insensitive
    const sorted = [...buckets.values()].sort((a, b) => {
      const lc = a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' });
      if (lc !== 0) return lc;
      return a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' });
    });

    // Assign dancerNum + dancerKey based on final sorted position
    return sorted.map((bucket, idx) => ({
      dancerKey: this.makeDancerKey(bucket.firstName, bucket.lastName),
      dancerNum: String(idx + 1).padStart(3, '0'),
      firstName: bucket.firstName,
      lastName: bucket.lastName,
      items: bucket.items,
      itemUuids: bucket.itemUuids,
      customerOrderNums: [...bucket.customerOrderNums],
      groupIds: [...bucket.groupIds],
    }));
  }

  /**
   * Find a single dancer by key.
   * @returns {DancerBucket|null}
   */
  getDancerByKey(orderData, dancerKey) {
    if (!dancerKey) return null;
    const dancers = this.listDancers(orderData);
    return dancers.find(d => d.dancerKey === dancerKey) || null;
  }

  /**
   * Build a synthetic sub-order suitable for passing to packingSlipService,
   * impositionService, or darkroomService. Contains only this dancer's items
   * and only this dancer's groups (so any code that reads order.groups won't
   * leak other dancers' info onto this dancer's slip / txt).
   *
   * @param {object} order - Full PDX order
   * @param {DancerBucket} dancer - Bucket from listDancers / getDancerByKey
   * @param {object} [opts]
   * @param {string} [opts.itemId] - If set, restrict items to just this one
   * @returns {object} synthetic order
   */
  buildSubOrder(order, dancer, opts = {}) {
    if (!order || !dancer) {
      throw new Error('buildSubOrder requires order and dancer');
    }

    let items = dancer.items;
    if (opts.itemId) {
      items = items.filter(i => i.id === opts.itemId);
    }

    const groupIdSet = new Set(dancer.groupIds);
    const groups = (order.groups || []).filter(g => groupIdSet.has(g.id));

    return { ...order, items, groups };
  }

  /**
   * Pick the customer-order-num to display on slips/txts for a dancer.
   * - If exactly one order num: use it (e.g. 'RA1776878064')
   * - Otherwise: fall back to the parent bulk order num (so the slip is at
   *   least traceable, even though no single order num applies)
   *
   * @returns {string}
   */
  resolveDancerOrderNum(dancer, fallbackOrderNum) {
    if (dancer.customerOrderNums.length === 1) return dancer.customerOrderNums[0];
    return fallbackOrderNum || '';
  }
}

module.exports = new BulkOrderService();
