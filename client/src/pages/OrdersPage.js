import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';

const INTERVAL_OPTIONS = [
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 20, label: '20 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
];

export default function OrdersPage() {
  const [activeTab, setActiveTab] = useState('unprocessed');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Orders by status
  const [unprocessedOrders, setUnprocessedOrders] = useState([]);
  const [processedOrders, setProcessedOrders] = useState([]);
  const [shippedOrders, setShippedOrders] = useState([]);
  const [counts, setCounts] = useState({ unprocessed: 0, processed: 0, shipped: 0, total: 0 });

  // Gallery filter
  const [galleryFilter, setGalleryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // Team filter
  const [teamFilter, setTeamFilter] = useState('all');
  const [availableTeams, setAvailableTeams] = useState([]);
  const [gallerySettings, setGallerySettings] = useState({});
  const [showGalleryConfig, setShowGalleryConfig] = useState(null); // gallery name being configured
  const [configSortLevels, setConfigSortLevels] = useState([]);

  // Helper to get a gallery's settings
  const getGalleryConfig = (gallery) => gallerySettings[gallery] || { teamEnabled: false, autoProcess: false, folderSort: null };
  const teamEnabledGalleries = Object.entries(gallerySettings).filter(([_, s]) => s.teamEnabled).map(([name]) => name);

  // Folder sort
  const [folderSort, setFolderSort] = useState([]);
  const [sortOptions, setSortOptions] = useState([]);

  // Auto-fetch settings
  const [autoFetchEnabled, setAutoFetchEnabled] = useState(false);
  const [autoFetchInterval, setAutoFetchInterval] = useState(30);
  const [lastFetch, setLastFetch] = useState(null);

  // Process results
  const [processResults, setProcessResults] = useState(null);

  // Bulk-order expansion: which order rows are expanded to show dancer breakdown
  const [expandedBulkOrders, setExpandedBulkOrders] = useState(() => new Set());
  // Cached dancer data per orderNum: { dancers, totalDancers, totalItems }
  const [dancersByOrder, setDancersByOrder] = useState({});
  // Per-order loading flag while fetching the dancer list
  const [dancersLoading, setDancersLoading] = useState(() => new Set());
  // Per-action loading key (`${orderNum}|${dancerKey}|${itemId||''}`)
  const [dancerActionLoading, setDancerActionLoading] = useState(null);

  // Ship form
  const [shipOrderNum, setShipOrderNum] = useState('');
  const [shipTrackingNum, setShipTrackingNum] = useState('');

  const clearMessages = () => { setError(null); setSuccess(null); };

  // ─── Derive unique galleries from current tab's orders ──
  const currentOrders = useMemo(() => {
    switch (activeTab) {
      case 'unprocessed': return unprocessedOrders;
      case 'processed': return processedOrders;
      case 'shipped': return shippedOrders;
      default: return [];
    }
  }, [activeTab, unprocessedOrders, processedOrders, shippedOrders]);

  const galleries = useMemo(() => {
    const set = new Set();
    currentOrders.forEach(o => { if (o.gallery) set.add(o.gallery); });
    return Array.from(set).sort();
  }, [currentOrders]);

  // Extract unique teams from filtered gallery's orders
  const teams = useMemo(() => {
    const orders = galleryFilter === 'all' ? currentOrders : currentOrders.filter(o => o.gallery === galleryFilter);
    const set = new Set();
    orders.forEach(o => {
      (o.items || []).forEach(item => {
        (item.tags || []).forEach(tag => set.add(tag));
      });
    });
    return Array.from(set).sort();
  }, [currentOrders, galleryFilter]);

  // Filter orders by selected gallery AND team
  const filteredOrders = useMemo(() => {
    let orders = currentOrders;
    if (galleryFilter !== 'all') {
      orders = orders.filter(o => o.gallery === galleryFilter);
    }
    if (teamFilter !== 'all' && teamFilter !== 'no_team') {
      orders = orders.filter(o =>
        (o.items || []).some(item => (item.tags || []).includes(teamFilter))
      );
    } else if (teamFilter === 'no_team') {
      orders = orders.filter(o =>
        (o.items || []).every(item => !item.tags || item.tags.length === 0)
      );
    }
    return orders;
  }, [currentOrders, galleryFilter, teamFilter]);

  // Reset filters when switching tabs
  useEffect(() => { setGalleryFilter('all'); setTeamFilter('all'); }, [activeTab]);
  // Reset team filter when gallery changes
  useEffect(() => { setTeamFilter('all'); }, [galleryFilter]);

  // ─── Load Data ──────────────────────────────────────────
  const loadOrders = useCallback(async (status) => {
    try {
      let data;
      switch (status) {
        case 'unprocessed': data = await api.getUnprocessedOrders(); setUnprocessedOrders(data.orders); break;
        case 'processed': data = await api.getProcessedOrders(); setProcessedOrders(data.orders); break;
        case 'shipped': data = await api.getShippedOrders(); setShippedOrders(data.orders); break;
        default: break;
      }
    } catch (err) { /* silent */ }
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const data = await api.getOrderCounts();
      setCounts(prev => {
        if (data.unprocessed !== prev.unprocessed || data.processed !== prev.processed || data.shipped !== prev.shipped) {
          setTimeout(() => {
            loadOrders('unprocessed');
            loadOrders('processed');
            loadOrders('shipped');
          }, 100);
        }
        return data;
      });
      if (data.autoFetch) {
        setAutoFetchEnabled(data.autoFetch.enabled);
        setAutoFetchInterval(data.autoFetch.intervalMinutes);
        setLastFetch(data.autoFetch.lastFetch);
      }
    } catch (err) { /* silent */ }
  }, [loadOrders]);

  useEffect(() => {
    loadCounts();
    loadOrders('unprocessed');
    loadOrders('processed');
    loadOrders('shipped');
    // Load folder sort settings
    api.getFolderSortOptions().then(setSortOptions).catch(() => {});
    api.getFolderSort().then(d => setFolderSort(d.sortLevels || [])).catch(() => {});
    // Load gallery settings
    api.getGallerySettings().then(d => setGallerySettings(d.gallerySettings || {})).catch(() => {});
    const interval = setInterval(loadCounts, 30000);
    return () => clearInterval(interval);
  }, [loadCounts, loadOrders]);

  useEffect(() => {
    loadOrders(activeTab);
  }, [activeTab, loadOrders]);

  // ─── Fetch New Orders ───────────────────────────────────
  const fetchNewOrders = async () => {
    clearMessages();
    setLoading(true);
    try {
      const result = await api.fetchNewOrders();
      if (result.skipped) {
        setSuccess('Fetch already in progress');
      } else if (result.error) {
        setError(result.error);
      } else {
        setSuccess(`Fetched ${result.fetched} orders from PhotoDay (${result.newOrders} new)`);
      }
      await loadCounts();
      await loadOrders('unprocessed');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Auto-Fetch Toggle ──────────────────────────────────
  const toggleAutoFetch = async (enabled) => {
    try {
      await api.updateAutoFetch(enabled, autoFetchInterval);
      setAutoFetchEnabled(enabled);
      setSuccess(enabled ? `Auto-fetch enabled (every ${autoFetchInterval} min)` : 'Auto-fetch disabled');
    } catch (err) {
      setError(err.message);
    }
  };

  const updateInterval = async (minutes) => {
    setAutoFetchInterval(minutes);
    if (autoFetchEnabled) {
      try {
        await api.updateAutoFetch(true, minutes);
        setSuccess(`Auto-fetch interval updated to ${minutes} minutes`);
      } catch (err) {
        setError(err.message);
      }
    }
  };

  // ─── Process Orders ─────────────────────────────────────
  // ─── Bulk-order dancer expansion ────────────────────────
  // Lazy-load dancer breakdown the first time a bulk row is expanded; cache
  // it so subsequent expansions are instant.
  const toggleBulkExpand = async (orderNum) => {
    setExpandedBulkOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderNum)) next.delete(orderNum); else next.add(orderNum);
      return next;
    });
    // Load on first expand
    if (!expandedBulkOrders.has(orderNum) && !dancersByOrder[orderNum]) {
      setDancersLoading(prev => { const n = new Set(prev); n.add(orderNum); return n; });
      try {
        const result = await api.getBulkDancers(orderNum);
        setDancersByOrder(prev => ({ ...prev, [orderNum]: result }));
      } catch (err) {
        setError(`Could not load dancers for ${orderNum}: ${err.message}`);
      } finally {
        setDancersLoading(prev => { const n = new Set(prev); n.delete(orderNum); return n; });
      }
    }
  };

  // Reprint an entire dancer's order (slip + all items, fresh from PhotoDay)
  const reprintWholeDancer = async (orderNum, dancerKey, dancerName) => {
    const key = `${orderNum}|${dancerKey}|`;
    clearMessages();
    setDancerActionLoading(key);
    try {
      const result = await api.reprintBulkDancer(orderNum, dancerKey);
      setSuccess(`Reprinted ${dancerName}: ${result.txtFile || 'done'}`);
    } catch (err) {
      setError(`Reprint failed for ${dancerName}: ${err.message}`);
    } finally {
      setDancerActionLoading(null);
    }
  };

  // Reprint a single item for a dancer (no slip — matches existing reprint-item behavior)
  const reprintSingleItemForDancer = async (orderNum, dancerKey, itemId, itemDesc, dancerName) => {
    const key = `${orderNum}|${dancerKey}|${itemId}`;
    clearMessages();
    setDancerActionLoading(key);
    try {
      const result = await api.reprintBulkDancerItem(orderNum, dancerKey, itemId);
      setSuccess(`Reprinted ${itemDesc} for ${dancerName}: ${result.txtFile || 'done'}`);
    } catch (err) {
      setError(`Reprint failed: ${err.message}`);
    } finally {
      setDancerActionLoading(null);
    }
  };

  const processSingle = async (orderNum) => {
    clearMessages();
    setLoading(true);
    try {
      // If team filter is active on a team-enabled gallery, process by team
      if (teamFilter && teamFilter !== 'all' && teamFilter !== 'no_team' && teamEnabledGalleries.includes(galleryFilter)) {
        const result = await api.processOrderByTeam(orderNum, teamFilter);
        if (result.allProcessed) {
          setSuccess(`Order ${orderNum} fully processed (all teams done) → ShipStation`);
        } else {
          setSuccess(`Order ${orderNum} — team "${teamFilter}" processed. More teams pending.`);
        }
      } else {
        await api.processOrderByNum(orderNum);
        setSuccess(`Order ${orderNum} processed successfully`);
      }
      await loadCounts();
      await loadOrders('unprocessed');
      await loadOrders('processed');
      // If a search is active, refresh the search results so the row reflects the new state
      if (searchResults !== null && searchQuery.trim().length >= 2) {
        try {
          const results = await api._fetch(`/orders/search?q=${encodeURIComponent(searchQuery.trim())}`);
          setSearchResults(results);
        } catch { /* ignore — main process succeeded */ }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const processFiltered = async () => {
    clearMessages();
    setLoading(true);
    try {
      // If team filter is active, process each order by team
      if (teamFilter && teamFilter !== 'all' && teamFilter !== 'no_team' && teamEnabledGalleries.includes(galleryFilter)) {
        let successCount = 0;
        let errorCount = 0;
        for (const order of filteredOrders) {
          try {
            await api.processOrderByTeam(order.orderNum, teamFilter);
            successCount++;
          } catch (err) {
            errorCount++;
          }
        }
        setSuccess(`Processed ${successCount}/${filteredOrders.length} orders for team "${teamFilter}"${errorCount > 0 ? ` (${errorCount} errors)` : ''}`);
      } else {
        const options = galleryFilter !== 'all' ? { gallery: galleryFilter } : {};
        const result = await api.processAllOrders(options);
        setProcessResults(result);
        const label = galleryFilter !== 'all' ? ` from "${galleryFilter}"` : '';
        setSuccess(`Processed ${result.successCount}/${result.total} orders${label}`);
      }
      await loadCounts();
      await loadOrders('unprocessed');
      await loadOrders('processed');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Ship Order ─────────────────────────────────────────
  const markShipped = async (orderNum, trackingNum) => {
    const oNum = orderNum || shipOrderNum;
    const tNum = trackingNum || shipTrackingNum;
    if (!oNum) { setError('Order number required'); return; }
    clearMessages();
    setLoading(true);
    try {
      await api.shipOrderByNum(oNum, 'USPS', tNum || '');
      setSuccess(`Order ${oNum} marked as shipped${tNum ? ` (${tNum})` : ''}`);
      setShipOrderNum('');
      setShipTrackingNum('');
      await loadCounts();
      await loadOrders('processed');
      await loadOrders('shipped');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Batch Ship All ─────────────────────────────────────
  const [batchTrackingNum, setBatchTrackingNum] = useState('');
  const [showBatchShip, setShowBatchShip] = useState(false);

  const batchShipAll = async () => {
    clearMessages();
    setLoading(true);
    try {
      const gallery = galleryFilter !== 'all' ? galleryFilter : null;
      const result = await api.batchShipOrders('USPS', batchTrackingNum || '', gallery);
      const label = gallery ? ` from "${gallery}"` : '';
      setSuccess(`Shipped ${result.successCount}/${result.total} orders${label}`);
      setBatchTrackingNum('');
      setShowBatchShip(false);
      await loadCounts();
      await loadOrders('processed');
      await loadOrders('shipped');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Check ShipStation ──────────────────────────────────
  const checkShipments = async () => {
    clearMessages();
    setLoading(true);
    try {
      const result = await api.checkShipments();
      setSuccess(result.message);
      await loadCounts();
      await loadOrders('processed');
      await loadOrders('shipped');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Render helpers ─────────────────────────────────────
  const formatDate = (d) => d ? new Date(d).toLocaleString() : '—';

  const renderOrderTable = (orders, status) => {
    if (orders.length === 0) {
      const messages = {
        unprocessed: galleryFilter !== 'all'
          ? `No unprocessed orders for "${galleryFilter}".`
          : 'No unprocessed orders. Click "Fetch New Orders" to pull from PhotoDay.',
        processed: 'No processed orders awaiting shipment.',
        shipped: 'No shipped orders yet.',
      };
      return (
        <div className="empty-state">
          <div className="empty-state-icon">{status === 'unprocessed' ? '⬡' : status === 'processed' ? '◧' : '✓'}</div>
          <div className="empty-state-title">No {status} orders</div>
          <div className="empty-state-text">{messages[status]}</div>
        </div>
      );
    }

    return (
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Order #</th>
              <th>Gallery</th>
              <th>Name</th>
              <th>Items</th>
              <th>Type</th>
              <th>Placed</th>
              {status === 'search' && <th>Status</th>}
              {status === 'processed' && <><th>SS Order</th><th>Processed</th></>}
              {status === 'shipped' && <><th>Carrier</th><th>Tracking</th><th>Shipped</th></>}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <React.Fragment key={order.orderNum}>
              <tr>
                <td className="mono" style={{ fontWeight: 600 }}>
                  {order.isBulk && (
                    <button
                      onClick={() => toggleBulkExpand(order.orderNum)}
                      title={expandedBulkOrders.has(order.orderNum) ? 'Collapse dancers' : 'Show dancers'}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: '0 4px 0 0', color: 'var(--text-secondary)',
                        fontSize: 11, fontFamily: 'monospace',
                      }}
                    >
                      {expandedBulkOrders.has(order.orderNum) ? '▾' : '▸'}
                    </button>
                  )}
                  <a
                    href={`https://pdx.photoday.com/${order.isBulk ? 'orders-bulk' : 'orders'}/${order.orderId}/info`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)', textDecoration: 'none' }}
                    title="Open in PhotoDay"
                  >
                    {order.orderNum}
                  </a>
                </td>
                <td>
                  <span style={{
                    padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: 12,
                    background: 'var(--bg-input)', border: '1px solid var(--border-light)',
                  }}>
                    {order.gallery || '—'}
                  </span>
                </td>
                <td>{order.customerName || '—'}</td>
                <td>
                  <div style={{ fontSize: 12 }}>
                    {(order.items || []).map((item, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', marginBottom: 2 }}>
                        <span>{item.quantity}x {item.description}</span>
                        {(item.tags || []).map((tag, ti) => (
                          <span key={ti} style={{
                            padding: '0px 5px', borderRadius: 'var(--radius-sm)', fontSize: 9,
                            background: 'rgba(232,140,48,0.15)', color: '#e88c30', fontWeight: 600,
                          }}>
                            {tag}
                          </span>
                        ))}
                        {(status === 'processed' || status === 'shipped') && item.id && (
                          <button className="btn btn-sm btn-secondary"
                            onClick={async (e) => {
                              e.stopPropagation();
                              clearMessages(); setLoading(true);
                              try {
                                const result = await api.reprintItem(order.orderNum, item.id);
                                setSuccess(`Reprinted ${item.description}: ${result.txtFile || 'done'}`);
                              } catch (err) { setError(err.message); }
                              finally { setLoading(false); }
                            }}
                            disabled={loading}
                            style={{ padding: '0px 4px', fontSize: 9, lineHeight: '16px', minWidth: 0 }}
                            title="Reprint this item only (download + imposition + txt, no packing slip)">
                            Reprint
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={`badge ${order.isBulk ? 'badge-warning' : 'badge-info'}`}>
                    {order.isBulk ? 'Bulk' : 'Drop'}
                  </span>
                </td>
                <td style={{ fontSize: 12 }}>{formatDate(order.placedAt)}</td>

                {status === 'search' && (
                  <td>
                    <span className={`badge ${
                      order.status === 'shipped' ? 'badge-success' :
                      order.status === 'processed' ? 'badge-warning' :
                      order.status === 'partially_processed' ? 'badge-info' :
                      'badge-secondary'
                    }`}>
                      {order.status === 'processed' ? 'Awaiting Shipment' :
                       order.status === 'partially_processed' ? 'Partial' :
                       order.status === 'shipped' ? 'Shipped' : 'Unprocessed'}
                    </span>
                  </td>
                )}

                {status === 'processed' && (
                  <>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {order.shipstationOrderId ? (
                        <span className="badge badge-success">SS#{order.shipstationOrderId}</span>
                      ) : order.shipstationError ? (
                        <span className="badge badge-error" title={order.shipstationError}>SS Error</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{formatDate(order.processedAt)}</td>
                  </>
                )}

                {status === 'shipped' && (
                  <>
                    <td className="mono" style={{ fontSize: 12 }}>{order.carrier || '—'}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{order.trackingNumber || '—'}</td>
                    <td style={{ fontSize: 12 }}>{formatDate(order.shippedAt)}</td>
                  </>
                )}

                <td>
                  <div className="btn-group">
                    {(() => {
                      // In search mode, derive button visibility from each row's own status
                      // since the table-level `status` prop is "search" (not a real status).
                      const effectiveStatus = status === 'search' ? (order.status || 'unprocessed') : status;
                      return (
                        <>
                          {effectiveStatus === 'unprocessed' && (
                            <button className="btn btn-sm btn-primary" onClick={() => processSingle(order.orderNum)} disabled={loading}>
                              Process
                            </button>
                          )}
                          {(effectiveStatus === 'processed' || effectiveStatus === 'partially_processed') && (
                            <>
                              <button className="btn btn-sm btn-success" onClick={() => {
                                setShipOrderNum(order.orderNum);
                                setActiveTab('ship-modal');
                              }}>
                                Ship
                              </button>
                              <button className="btn btn-sm btn-secondary" onClick={async () => {
                                clearMessages(); setLoading(true);
                                try {
                                  await api.reprocessOrder(order.orderNum);
                                  setSuccess(`Reprocessed ${order.orderNum}`);
                                  await loadCounts();
                                  if (status === 'search') {
                                    // Re-run the search so the row reflects the updated state
                                    const results = await api._fetch(`/orders/search?q=${encodeURIComponent(searchQuery.trim())}`);
                                    setSearchResults(results);
                                  } else {
                                    await loadOrders('processed');
                                  }
                                } catch (err) { setError(err.message); }
                                finally { setLoading(false); }
                              }} disabled={loading} title="Re-download images and regenerate files">
                                Reprocess
                              </button>
                            </>
                          )}
                          {effectiveStatus === 'shipped' && (
                            <button className="btn btn-sm btn-secondary" onClick={async () => {
                              clearMessages(); setLoading(true);
                              try {
                                await api.reprocessOrder(order.orderNum);
                                setSuccess(`Reprocessed ${order.orderNum}`);
                                await loadCounts();
                                if (status === 'search') {
                                  const results = await api._fetch(`/orders/search?q=${encodeURIComponent(searchQuery.trim())}`);
                                  setSearchResults(results);
                                } else {
                                  await loadOrders('shipped');
                                }
                              } catch (err) { setError(err.message); }
                              finally { setLoading(false); }
                            }} disabled={loading} title="Re-download images and regenerate files">
                              Reprocess
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </td>
              </tr>
              {order.isBulk && expandedBulkOrders.has(order.orderNum) && (() => {
                // Compute colspan to match this tab's header layout. Base = 7
                // (Order#, Gallery, Name, Items, Type, Placed, Actions); plus any
                // status-specific columns rendered in this view.
                let cols = 7;
                if (status === 'search') cols += 1;
                else if (status === 'processed') cols += 2;
                else if (status === 'shipped') cols += 3;
                const cached = dancersByOrder[order.orderNum];
                const isLoading = dancersLoading.has(order.orderNum);
                const dancerName = (d) => `${d.lastName}, ${d.firstName}`;
                return (
                  <tr key={`${order.orderNum}-dancers`} style={{ background: 'var(--bg-input)' }}>
                    <td colSpan={cols} style={{ padding: '12px 16px' }}>
                      {isLoading && (
                        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading dancers…</div>
                      )}
                      {!isLoading && !cached && (
                        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Click to load dancers.</div>
                      )}
                      {!isLoading && cached && cached.dancers.length === 0 && (
                        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No dancers found in this bulk order.</div>
                      )}
                      {!isLoading && cached && cached.dancers.length > 0 && (
                        <div>
                          <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                            {cached.totalDancers} dancer{cached.totalDancers === 1 ? '' : 's'} · {cached.totalItems} item{cached.totalItems === 1 ? '' : 's'}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {cached.dancers.map((d) => {
                              const wholeKey = `${order.orderNum}|${d.dancerKey}|`;
                              const isReprintingWhole = dancerActionLoading === wholeKey;
                              return (
                                <div key={d.dancerKey} style={{
                                  display: 'flex', alignItems: 'flex-start', gap: 12,
                                  padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                                  background: 'var(--bg-card)', border: '1px solid var(--border-light)',
                                }}>
                                  <div style={{ minWidth: 36, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                    #{d.dancerNum}
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                                      {dancerName(d)}
                                      {d.customerOrderNums.length > 0 && (
                                        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', fontWeight: 400 }}>
                                          {d.customerOrderNums.join(', ')}
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      {d.items.map((it) => {
                                        const itemKey = `${order.orderNum}|${d.dancerKey}|${it.id}`;
                                        const isReprintingItem = dancerActionLoading === itemKey;
                                        return (
                                          <div key={it.id} style={{
                                            display: 'flex', alignItems: 'center', gap: 6,
                                            fontSize: 12, color: 'var(--text-secondary)',
                                          }}>
                                            <span>{it.quantity}× {it.description}</span>
                                            <button
                                              className="btn btn-sm btn-secondary"
                                              onClick={() => reprintSingleItemForDancer(order.orderNum, d.dancerKey, it.id, it.description, dancerName(d))}
                                              disabled={!!dancerActionLoading}
                                              style={{ padding: '0px 6px', fontSize: 9, lineHeight: '16px', minWidth: 0 }}
                                              title="Reprint this single item (no packing slip)"
                                            >
                                              {isReprintingItem ? '…' : 'Reprint'}
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <button
                                    className="btn btn-sm btn-primary"
                                    onClick={() => reprintWholeDancer(order.orderNum, d.dancerKey, dancerName(d))}
                                    disabled={!!dancerActionLoading}
                                    style={{ alignSelf: 'flex-start' }}
                                    title="Reprint this dancer's full order with packing slip (re-fetches latest images from PhotoDay)"
                                  >
                                    {isReprintingWhole ? 'Reprinting…' : 'Reprint Dancer'}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })()}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // ─── Process button label ───────────────────────────────
  const processButtonLabel = () => {
    const count = filteredOrders.length;
    if (teamFilter && teamFilter !== 'all' && teamFilter !== 'no_team' && teamEnabledGalleries.includes(galleryFilter)) {
      return `Process "${teamFilter}" (${count})`;
    }
    if (galleryFilter !== 'all') {
      return `Process "${galleryFilter}" (${count})`;
    }
    return `Process All (${count})`;
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Order Management</h1>
        <p className="page-subtitle">PhotoDay PDX order tracking and processing</p>
      </div>

      {error && <div className="alert alert-error">⚠ {error}</div>}
      {success && <div className="alert alert-success">✓ {success}</div>}

      {/* ─── Status Bar ──────────────────────────────────── */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card" onClick={() => setActiveTab('unprocessed')} style={{ cursor: 'pointer', borderColor: activeTab === 'unprocessed' ? 'var(--accent)' : undefined }}>
          <span className="stat-label">Unprocessed</span>
          <span className="stat-value" style={{ color: counts.unprocessed > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>{counts.unprocessed}</span>
        </div>
        <div className="stat-card" onClick={() => setActiveTab('processed')} style={{ cursor: 'pointer', borderColor: activeTab === 'processed' ? 'var(--accent)' : undefined }}>
          <span className="stat-label">Awaiting Shipment</span>
          <span className="stat-value" style={{ color: counts.processed > 0 ? 'var(--info)' : 'var(--text-muted)' }}>{counts.processed}</span>
        </div>
        <div className="stat-card" onClick={() => setActiveTab('shipped')} style={{ cursor: 'pointer', borderColor: activeTab === 'shipped' ? 'var(--accent)' : undefined }}>
          <span className="stat-label">Shipped</span>
          <span className="stat-value" style={{ color: 'var(--success)' }}>{counts.shipped}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Orders</span>
          <span className="stat-value">{counts.total}</span>
        </div>
      </div>

      {/* ─── Auto-Fetch Controls ─────────────────────────── */}
      <div className="card" style={{ marginBottom: 24, padding: '16px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <label className="checkbox-wrapper">
            <input type="checkbox" checked={autoFetchEnabled} onChange={(e) => toggleAutoFetch(e.target.checked)} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Auto-fetch orders</span>
          </label>

          <select className="form-select" value={autoFetchInterval} onChange={(e) => updateInterval(parseInt(e.target.value))}
            style={{ width: 160, padding: '6px 10px', fontSize: 13 }}>
            {INTERVAL_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <button className="btn btn-primary btn-sm" onClick={fetchNewOrders} disabled={loading}>
            {loading ? 'Fetching...' : 'Fetch New Orders'}
          </button>

          <button className="btn btn-secondary btn-sm" onClick={checkShipments} disabled={loading}>
            Check ShipStation
          </button>

          <div className="toolbar-spacer" />

          {lastFetch && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Last fetch: {formatDate(lastFetch)}
            </span>
          )}

          {autoFetchEnabled && (
            <span className="badge badge-success" style={{ fontSize: 10 }}>AUTO</span>
          )}
        </div>
      </div>

      {/* ─── Folder Sort Shortcuts ────────────────────────── */}
      <div className="card" style={{ marginBottom: 24, padding: '12px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Sort files by:</span>
          {[
            { levels: ['no_sort'], label: 'Flat' },
            { levels: ['gallery'], label: 'Gallery' },
            { levels: ['shipping_type'], label: 'Shipping Type' },
            { levels: ['gallery', 'shipping_name'], label: 'Gallery → Shipping Name' },
          ].map(preset => {
            const isActive = JSON.stringify(folderSort) === JSON.stringify(preset.levels);
            return (
              <button
                key={preset.label}
                className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                onClick={async () => {
                  try {
                    await api.updateFolderSort(preset.levels);
                    setFolderSort(preset.levels);
                    setSuccess(`Folder sort: ${preset.label}`);
                  } catch (err) { setError(err.message); }
                }}
                style={{ padding: '3px 10px', fontSize: 11 }}
              >
                {preset.label}
              </button>
            );
          })}
          <div className="toolbar-spacer" />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Current: {folderSort.length > 0 ? folderSort.join(' → ') : 'order_id'}
          </span>
        </div>
      </div>

      {/* ─── Tabs ────────────────────────────────────────── */}
      <div className="tabs">
        <button className={`tab ${activeTab === 'unprocessed' ? 'active' : ''}`} onClick={() => setActiveTab('unprocessed')}>
          Unprocessed {counts.unprocessed > 0 && <span className="badge badge-warning" style={{ marginLeft: 6 }}>{counts.unprocessed}</span>}
        </button>
        <button className={`tab ${activeTab === 'processed' ? 'active' : ''}`} onClick={() => setActiveTab('processed')}>
          Awaiting Shipment {counts.processed > 0 && <span className="badge badge-info" style={{ marginLeft: 6 }}>{counts.processed}</span>}
        </button>
        <button className={`tab ${activeTab === 'shipped' ? 'active' : ''}`} onClick={() => setActiveTab('shipped')}>
          Shipped {counts.shipped > 0 && <span className="badge badge-success" style={{ marginLeft: 6 }}>{counts.shipped}</span>}
        </button>
      </div>

      {/* ─── Gallery Filter ──────────────────────────────── */}
      {/* Search Bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px',
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)',
        borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Search:</span>
        <input
          className="form-input"
          placeholder="Order number or customer name..."
          value={searchQuery}
          onChange={e => {
            setSearchQuery(e.target.value);
            if (e.target.value.trim().length < 2) {
              setSearchResults(null);
            }
          }}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && searchQuery.trim().length >= 2) {
              setSearchLoading(true);
              try {
                const results = await api._fetch(`/orders/search?q=${encodeURIComponent(searchQuery.trim())}`);
                setSearchResults(results);
              } catch (err) { setError(err.message); }
              finally { setSearchLoading(false); }
            }
          }}
          style={{ flex: 1, maxWidth: 350, fontSize: 12, padding: '5px 10px' }}
        />
        <button className="btn btn-sm btn-primary" disabled={searchQuery.trim().length < 2 || searchLoading}
          onClick={async () => {
            setSearchLoading(true);
            try {
              const results = await api._fetch(`/orders/search?q=${encodeURIComponent(searchQuery.trim())}`);
              setSearchResults(results);
            } catch (err) { setError(err.message); }
            finally { setSearchLoading(false); }
          }}
          style={{ padding: '4px 12px', fontSize: 11 }}
        >
          {searchLoading ? 'Searching...' : 'Search'}
        </button>
        {searchResults !== null && (
          <button className="btn btn-sm btn-secondary"
            onClick={() => { setSearchQuery(''); setSearchResults(null); }}
            style={{ padding: '4px 10px', fontSize: 11 }}
          >Clear</button>
        )}
        {searchResults !== null && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Search Results */}
      {searchResults !== null && (
        <div style={{ padding: 16, background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)' }}>
          {searchResults.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 20 }}>
              No orders found matching "{searchQuery}"
            </div>
          ) : (
            renderOrderTable(searchResults, 'search')
          )}
        </div>
      )}

      {searchResults === null && galleries.length > 0 && (activeTab === 'unprocessed' || activeTab === 'processed' || activeTab === 'shipped') && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
          background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)',
          marginBottom: 0, borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Gallery:</span>
          <button
            className={`btn btn-sm ${galleryFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setGalleryFilter('all'); setShowGalleryConfig(null); }}
            style={{ padding: '3px 10px', fontSize: 11 }}
          >
            All ({currentOrders.length})
          </button>
          {galleries.map(g => {
            const count = currentOrders.filter(o => o.gallery === g).length;
            const gc = getGalleryConfig(g);
            const hasSettings = gc.teamEnabled || gc.autoProcess || (gc.folderSort && gc.folderSort.length > 0);
            return (
              <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button
                  className={`btn btn-sm ${galleryFilter === g ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setGalleryFilter(g)}
                  style={{ padding: '3px 10px', fontSize: 11, borderRadius: 'var(--radius-sm) 0 0 var(--radius-sm)' }}
                >
                  {g} ({count})
                  {hasSettings && <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.7 }}>⚙</span>}
                </button>
                <button
                  className={`btn btn-sm ${showGalleryConfig === g ? 'btn-primary' : hasSettings ? 'btn-warning' : 'btn-secondary'}`}
                  onClick={() => {
                    if (showGalleryConfig === g) {
                      setShowGalleryConfig(null);
                    } else {
                      setGalleryFilter(g);
                      setShowGalleryConfig(g);
                      setConfigSortLevels(gc.folderSort || []);
                    }
                  }}
                  title="Gallery settings"
                  style={{ padding: '3px 6px', fontSize: 10, minWidth: 0, borderRadius: '0 var(--radius-sm) var(--radius-sm) 0' }}
                >
                  ⚙
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Gallery Config Panel ──────────────────────────── */}
      {showGalleryConfig && (
        <div style={{
          padding: '16px 20px', background: 'var(--bg-card)',
          borderBottom: '2px solid var(--accent)', marginBottom: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              Settings for "{showGalleryConfig}"
            </div>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowGalleryConfig(null)} style={{ padding: '2px 8px', fontSize: 11 }}>Close</button>
          </div>

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Toggles */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={getGalleryConfig(showGalleryConfig).autoProcess || false}
                  onChange={async (e) => {
                    try {
                      const result = await api.updateGallerySettings(showGalleryConfig, { autoProcess: e.target.checked });
                      setGallerySettings(result.gallerySettings || {});
                    } catch (err) { setError(err.message); }
                  }} />
                <span style={{ fontWeight: 600 }}>Auto-process orders</span>
              </label>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 24, marginTop: -6 }}>
                New orders from this gallery will be processed automatically when fetched
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={getGalleryConfig(showGalleryConfig).teamEnabled || false}
                  onChange={async (e) => {
                    try {
                      const result = await api.updateGallerySettings(showGalleryConfig, { teamEnabled: e.target.checked });
                      setGallerySettings(result.gallerySettings || {});
                    } catch (err) { setError(err.message); }
                  }} />
                <span style={{ fontWeight: 600 }}>Team processing</span>
              </label>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 24, marginTop: -6 }}>
                Enable team filter and per-team processing for this gallery
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={getGalleryConfig(showGalleryConfig).skipShipStation || false}
                  onChange={async (e) => {
                    try {
                      const result = await api.updateGallerySettings(showGalleryConfig, { skipShipStation: e.target.checked });
                      setGallerySettings(result.gallerySettings || {});
                    } catch (err) { setError(err.message); }
                  }} />
                <span style={{ fontWeight: 600 }}>Skip ShipStation</span>
              </label>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 24, marginTop: -6 }}>
                Hand delivery — no shipping labels needed. Orders go to Awaiting Shipment for manual completion.
              </div>

              {getGalleryConfig(showGalleryConfig).autoProcess && getGalleryConfig(showGalleryConfig).teamEnabled && (
                <div style={{ fontSize: 11, color: 'var(--warning)', marginLeft: 24, padding: '4px 8px', background: 'rgba(255,152,0,0.1)', borderRadius: 'var(--radius-sm)' }}>
                  Note: With both enabled, auto-process only runs for orders without team tags. Team-tagged orders require manual team selection.
                </div>
              )}
            </div>

            {/* Folder sort */}
            <div style={{ flex: '1 1 300px' }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Folder Sort (for this gallery)</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                {configSortLevels.length === 0 ? 'Using global default' : `Custom: ${configSortLevels.join(' → ')}`}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                {configSortLevels.map((level, i) => (
                  <span key={i} style={{
                    padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: 600,
                    background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    {level}
                    <button onClick={() => {
                      const newLevels = configSortLevels.filter((_, j) => j !== i);
                      setConfigSortLevels(newLevels);
                    }} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 12, fontWeight: 700 }}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                {['gallery', 'team', 'order_id', 'shipping_type', 'shipping_name', 'date'].map(opt => (
                  <button key={opt} className="btn btn-sm btn-secondary"
                    onClick={() => {
                      if (!configSortLevels.includes(opt)) setConfigSortLevels([...configSortLevels, opt]);
                    }}
                    disabled={configSortLevels.includes(opt)}
                    style={{ padding: '2px 6px', fontSize: 10, opacity: configSortLevels.includes(opt) ? 0.4 : 1 }}>
                    + {opt}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={async () => {
                  try {
                    const result = await api.updateGallerySettings(showGalleryConfig, {
                      folderSort: configSortLevels.length > 0 ? configSortLevels : null,
                    });
                    setGallerySettings(result.gallerySettings || {});
                    setSuccess(`Folder sort saved for "${showGalleryConfig}": ${configSortLevels.length > 0 ? configSortLevels.join(' → ') : 'using global default'}`);
                  } catch (err) { setError(err.message); }
                }}>
                  Save Sort
                </button>
                <button className="btn btn-sm btn-secondary" onClick={() => {
                  setConfigSortLevels([]);
                }}>
                  Use Global Default
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Team Filter (appears when gallery is selected AND team-enabled) ── */}
      {teams.length > 0 && galleryFilter !== 'all' && teamEnabledGalleries.includes(galleryFilter) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px',
          background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)',
          marginBottom: 0, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#e88c30' }}>Team:</span>
          <button
            className={`btn btn-sm ${teamFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTeamFilter('all')}
            style={{ padding: '3px 10px', fontSize: 11 }}
          >
            All Teams
          </button>
          {teams.map(t => {
            const galleryOrders = currentOrders.filter(o => o.gallery === galleryFilter);
            const count = galleryOrders.filter(o =>
              (o.items || []).some(item => (item.tags || []).includes(t))
            ).length;
            return (
              <button
                key={t}
                className={`btn btn-sm ${teamFilter === t ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTeamFilter(t)}
                style={{ padding: '3px 10px', fontSize: 11 }}
              >
                {t} ({count})
              </button>
            );
          })}
          <button
            className={`btn btn-sm ${teamFilter === 'no_team' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTeamFilter('no_team')}
            style={{ padding: '3px 10px', fontSize: 11, opacity: teamFilter === 'no_team' ? 1 : 0.6 }}
          >
            No Team
          </button>
        </div>
      )}

      {/* ─── Tab Content ─────────────────────────────────── */}
      {searchResults === null && activeTab === 'unprocessed' && (
        <div className="card" style={{ borderRadius: galleries.length > 0 ? '0 0 var(--radius-md) var(--radius-md)' : undefined }}>
          <div className="card-header">
            <h3 className="card-title">
              Unprocessed Orders
              {galleryFilter !== 'all' && (
                <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text-muted)', marginLeft: 8 }}>
                  — {galleryFilter}
                </span>
              )}
            </h3>
            {filteredOrders.length > 0 && (
              <button className="btn btn-primary" onClick={processFiltered} disabled={loading}>
                {loading ? 'Processing...' : processButtonLabel()}
              </button>
            )}
          </div>
          {renderOrderTable(filteredOrders, 'unprocessed')}

          {processResults && (
            <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-input)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                Processing Results
                {processResults.gallery && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> — {processResults.gallery}</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {processResults.successCount} succeeded, {processResults.errorCount} failed out of {processResults.total}
              </div>
              {processResults.results?.filter(r => !r.success).map((r, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--error)', marginTop: 4 }}>
                  {r.orderNum}: {r.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {searchResults === null && activeTab === 'processed' && (
        <div className="card" style={{ borderRadius: galleries.length > 0 ? '0 0 var(--radius-md) var(--radius-md)' : undefined }}>
          <div className="card-header">
            <h3 className="card-title">
              Awaiting Shipment
              {galleryFilter !== 'all' && (
                <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text-muted)', marginLeft: 8 }}>
                  — {galleryFilter}
                </span>
              )}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                ShipStation polled every 5 min
              </span>
              {filteredOrders.length > 0 && (
                <button className="btn btn-success btn-sm" onClick={() => setShowBatchShip(!showBatchShip)}>
                  {showBatchShip ? 'Cancel' : `Mark All Shipped (${filteredOrders.length})`}
                </button>
              )}
            </div>
          </div>

          {showBatchShip && filteredOrders.length > 0 && (
            <div style={{
              padding: '14px 20px', background: 'var(--bg-input)', borderBottom: '1px solid var(--border-light)',
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                Ship {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}
                {galleryFilter !== 'all' ? ` from "${galleryFilter}"` : ''}:
              </span>
              <input className="form-input" value={batchTrackingNum}
                onChange={(e) => setBatchTrackingNum(e.target.value)}
                placeholder="Tracking number (optional)"
                style={{ width: 250, padding: '6px 10px', fontSize: 13 }}
              />
              <button className="btn btn-success btn-sm" onClick={batchShipAll} disabled={loading}>
                {loading ? 'Shipping...' : `Confirm Ship All${batchTrackingNum ? '' : ' (no tracking)'}`}
              </button>
            </div>
          )}

          {renderOrderTable(filteredOrders, 'processed')}
        </div>
      )}

      {searchResults === null && activeTab === 'shipped' && (
        <div className="card" style={{ borderRadius: galleries.length > 0 ? '0 0 var(--radius-md) var(--radius-md)' : undefined }}>
          <div className="card-header">
            <h3 className="card-title">
              Shipped Orders
              {galleryFilter !== 'all' && (
                <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text-muted)', marginLeft: 8 }}>
                  — {galleryFilter}
                </span>
              )}
            </h3>
            {filteredOrders.length > 0 && (
              <button className="btn btn-primary btn-sm" onClick={async () => {
                clearMessages();
                setLoading(true);
                try {
                  const gallery = galleryFilter !== 'all' ? galleryFilter : null;
                  const result = await api.syncShippedToPhotoDay(gallery);
                  if (result.total === 0) {
                    setSuccess('All shipped orders are already synced to PhotoDay');
                  } else {
                    setSuccess(`Synced ${result.successCount}/${result.total} orders to PhotoDay`);
                  }
                  await loadOrders('shipped');
                } catch (err) {
                  setError(err.message);
                } finally {
                  setLoading(false);
                }
              }} disabled={loading}>
                {loading ? 'Syncing...' : 'Sync to PhotoDay'}
              </button>
            )}
          </div>
          {renderOrderTable(filteredOrders, 'shipped')}
        </div>
      )}

      {/* ─── Ship Modal ──────────────────────────────────── */}
      {activeTab === 'ship-modal' && (
        <div className="card" style={{ maxWidth: 500 }}>
          <h3 className="card-title" style={{ marginBottom: 20 }}>Mark Order as Shipped</h3>
          <div className="form-group">
            <label className="form-label">Order Number</label>
            <input className="form-input" value={shipOrderNum} onChange={(e) => setShipOrderNum(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Tracking Number <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
            <input className="form-input" value={shipTrackingNum} onChange={(e) => setShipTrackingNum(e.target.value)} placeholder="Leave blank if no tracking" />
          </div>
          <div className="btn-group">
            <button className="btn btn-success" onClick={() => markShipped()} disabled={loading}>
              {loading ? 'Sending...' : `Mark as Shipped${shipTrackingNum ? '' : ' (no tracking)'}`}
            </button>
            <button className="btn btn-secondary" onClick={() => setActiveTab('processed')}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
