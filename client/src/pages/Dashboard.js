import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Dashboard({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [message, setMessage] = useState(null);

  const loadDashboard = useCallback(async () => {
    try {
      const result = await api.getDashboardAnalytics();
      setData(result);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 60000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  const doFetchOrders = async () => {
    setActionLoading('fetch');
    try {
      const result = await api.fetchNewOrders();
      setMessage(`Fetched ${result.newCount || 0} new orders`);
      await loadDashboard();
    } catch (err) { setMessage('Fetch failed: ' + err.message); }
    finally { setActionLoading(null); }
  };

  const doProcessAll = async () => {
    setActionLoading('process');
    try {
      const result = await api.processAllOrders();
      setMessage(`Processed ${result.successCount || 0}/${result.total || 0} orders`);
      await loadDashboard();
    } catch (err) { setMessage('Process failed: ' + err.message); }
    finally { setActionLoading(null); }
  };

  const doCheckShipStation = async () => {
    setActionLoading('shipstation');
    try {
      await api.checkShipments();
      setMessage('ShipStation check complete');
      await loadDashboard();
    } catch (err) { setMessage('ShipStation check failed: ' + err.message); }
    finally { setActionLoading(null); }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Loading dashboard...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Unable to load dashboard</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Check server connection</div>
      </div>
    );
  }

  const { counts, throughput, avgProcessTimeMs, totalImages, totalImagesThisWeek, specialtyPending, productBreakdown, galleries, volumeByDay, recentOrders } = data;

  const maxVol = Math.max(...volumeByDay.map(d => Math.max(d.fetched, d.processed, d.shipped)), 1);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Production Dashboard</h1>
        <p className="page-subtitle">Sportsline Photography — Order Processing & Fulfillment</p>
      </div>

      {message && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          {message}
          <button onClick={() => setMessage(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 16, color: 'inherit' }}>×</button>
        </div>
      )}

      {/* ─── Status Cards ─────────────────────────────────────── */}
      <div className="stats-grid">
        <div className="stat-card" style={{ cursor: 'pointer', borderColor: counts.unprocessed > 0 ? 'var(--warning)' : undefined }}
          onClick={() => onNavigate('orders')}>
          <span className="stat-label">UNPROCESSED</span>
          <span className="stat-value" style={{ color: counts.unprocessed > 0 ? 'var(--warning)' : undefined }}>{counts.unprocessed}</span>
          <span className="stat-change">{counts.unprocessed > 0 ? 'Needs attention' : 'All clear'}</span>
        </div>
        <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => onNavigate('orders')}>
          <span className="stat-label">AWAITING SHIPMENT</span>
          <span className="stat-value" style={{ color: counts.processed > 0 ? 'var(--info)' : undefined }}>{counts.processed}</span>
          <span className="stat-change">{counts.processed > 0 ? 'Ready to ship' : 'None pending'}</span>
        </div>
        <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => onNavigate('orders')}>
          <span className="stat-label">SHIPPED</span>
          <span className="stat-value" style={{ color: 'var(--success)' }}>{counts.shipped}</span>
          <span className="stat-change">Total shipped</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">TOTAL ORDERS</span>
          <span className="stat-value">{counts.total}</span>
          <span className="stat-change">All time</span>
        </div>
      </div>

      {/* ─── Throughput + Quick Actions ────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Production Throughput</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            {[
              { label: 'Today', value: throughput.today },
              { label: 'This Week', value: throughput.thisWeek },
              { label: 'This Month', value: throughput.thisMonth },
            ].map(t => (
              <div key={t.label} style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)' }}>{t.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t.label}</div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 12, marginTop: 8, fontSize: 12 }}>
            {[
              { label: 'Avg processing time', value: formatDuration(avgProcessTimeMs) },
              { label: 'Total images (all time)', value: totalImages.toLocaleString() },
              { label: 'Images this week', value: totalImagesThisWeek.toLocaleString() },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                <span style={{ fontWeight: 600 }}>{s.value}</span>
              </div>
            ))}
            {specialtyPending > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--warning)' }}>Specialty items pending</span>
                <span style={{ fontWeight: 600, color: 'var(--warning)' }}>{specialtyPending}</span>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Quick Actions</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="btn btn-primary" onClick={doFetchOrders} disabled={!!actionLoading}
              style={{ justifyContent: 'space-between', padding: '14px 18px' }}>
              <span><span style={{ fontWeight: 700 }}>Fetch New Orders</span><span style={{ fontSize: 11, marginLeft: 8, opacity: 0.7 }}>Pull from PhotoDay</span></span>
              {actionLoading === 'fetch' ? '...' : '📥'}
            </button>
            {counts.unprocessed > 0 && (
              <button className="btn btn-success" onClick={doProcessAll} disabled={!!actionLoading}
                style={{ justifyContent: 'space-between', padding: '14px 18px' }}>
                <span><span style={{ fontWeight: 700 }}>Process All Orders</span><span style={{ fontSize: 11, marginLeft: 8, opacity: 0.7 }}>{counts.unprocessed} waiting</span></span>
                {actionLoading === 'process' ? '...' : '⚡'}
              </button>
            )}
            <button className="btn btn-secondary" onClick={doCheckShipStation} disabled={!!actionLoading}
              style={{ justifyContent: 'space-between', padding: '14px 18px' }}>
              <span><span style={{ fontWeight: 700 }}>Check ShipStation</span><span style={{ fontSize: 11, marginLeft: 8, opacity: 0.7 }}>Detect shipped labels</span></span>
              {actionLoading === 'shipstation' ? '...' : '📦'}
            </button>
            <button className="btn btn-secondary" onClick={() => onNavigate('orders')}
              style={{ justifyContent: 'space-between', padding: '14px 18px' }}>
              <span><span style={{ fontWeight: 700 }}>View Orders</span><span style={{ fontSize: 11, marginLeft: 8, opacity: 0.7 }}>Order management</span></span>
              →
            </button>
            <button className="btn btn-secondary" onClick={() => onNavigate('settings')}
              style={{ justifyContent: 'space-between', padding: '14px 18px' }}>
              <span><span style={{ fontWeight: 700 }}>Settings</span><span style={{ fontSize: 11, marginLeft: 8, opacity: 0.7 }}>Layouts, products, config</span></span>
              ⚙
            </button>
          </div>
        </div>
      </div>

      {/* ─── Order Volume Chart ───────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <h3 className="card-title">Order Volume (Last 14 Days)</h3>
          <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#4a90d9', display: 'inline-block' }} /> Fetched</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#50c878', display: 'inline-block' }} /> Processed</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#ff8c42', display: 'inline-block' }} /> Shipped</span>
          </div>
        </div>
        <div style={{ height: 160, display: 'flex', alignItems: 'flex-end', gap: 4, padding: '0 4px' }}>
          {volumeByDay.map((day) => (
            <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: 140, width: '100%', justifyContent: 'center' }}>
                <div style={{ width: '28%', height: Math.max((day.fetched / maxVol) * 140, day.fetched > 0 ? 4 : 0), background: '#4a90d9', borderRadius: '2px 2px 0 0' }}
                  title={`${day.date}: ${day.fetched} fetched`} />
                <div style={{ width: '28%', height: Math.max((day.processed / maxVol) * 140, day.processed > 0 ? 4 : 0), background: '#50c878', borderRadius: '2px 2px 0 0' }}
                  title={`${day.date}: ${day.processed} processed`} />
                <div style={{ width: '28%', height: Math.max((day.shipped / maxVol) * 140, day.shipped > 0 ? 4 : 0), background: '#ff8c42', borderRadius: '2px 2px 0 0' }}
                  title={`${day.date}: ${day.shipped} shipped`} />
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{day.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Gallery Overview + Product Breakdown ──────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Gallery Overview</h3>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{galleries.length} active</span>
          </div>
          {galleries.length > 0 ? (
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {galleries.map(g => (
                <div key={g.name}
                  onClick={() => onNavigate('orders')}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-light)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{g.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{g.total} order{g.total !== 1 ? 's' : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {g.unprocessed > 0 && (
                      <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: 600, background: 'rgba(255,152,0,0.15)', color: 'var(--warning)' }}>
                        {g.unprocessed} unprocessed
                      </span>
                    )}
                    {g.processed > 0 && (
                      <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: 600, background: 'rgba(33,150,243,0.15)', color: 'var(--info)' }}>
                        {g.processed} pending
                      </span>
                    )}
                    <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>→</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No galleries yet</div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Items by Product Type</h3>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>All time</span>
          </div>
          {productBreakdown.length > 0 ? (
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {productBreakdown.map((p, i) => {
                const maxCount = productBreakdown[0]?.count || 1;
                return (
                  <div key={i} style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-light)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{p.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{p.count}</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--bg-input)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(p.count / maxCount) * 100}%`, background: 'var(--accent)', borderRadius: 2 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No products processed yet</div>
          )}
        </div>
      </div>

      {/* ─── Recent Orders ────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Recent Orders</h3>
          <button className="btn btn-sm btn-secondary" onClick={() => onNavigate('orders')}>View All →</button>
        </div>
        {recentOrders.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr><th>Order #</th><th>Gallery</th><th>Items</th><th>Status</th><th>Processed</th><th>Shipped</th></tr>
              </thead>
              <tbody>
                {recentOrders.map(o => (
                  <tr key={o.orderNum}>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      <a href={`https://pdx.photoday.com/${o.isBulk ? 'orders-bulk' : 'orders'}/${o.orderId}/info`}
                        target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                        {o.orderNum}
                      </a>
                    </td>
                    <td>{o.gallery || '—'}</td>
                    <td>{o.itemCount}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: 600,
                        background: o.status === 'shipped' ? 'rgba(76,175,80,0.15)' : o.status === 'processed' ? 'rgba(33,150,243,0.15)' : 'rgba(255,152,0,0.15)',
                        color: o.status === 'shipped' ? 'var(--success)' : o.status === 'processed' ? 'var(--info)' : 'var(--warning)',
                      }}>
                        {o.status}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatDate(o.processedAt)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatDate(o.shippedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No recent orders</div>
        )}
      </div>
    </div>
  );
}
