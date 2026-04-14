import React, { useState, useEffect } from 'react';
import api from '../services/api';

export default function Dashboard({ onNavigate }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.healthCheck()
      .then(setHealth)
      .catch(() => setHealth(null))
      .finally(() => setLoading(false));
  }, []);

  const quickActions = [
    { label: 'Process Orders', desc: 'Pull & generate txt files', page: 'orders', icon: '⬡' },
    { label: 'Ship Orders', desc: 'Create ShipStation orders', page: 'shipstation', icon: '⬢' },
    { label: 'Print Sheets', desc: 'Generate wallet sheets', page: 'print', icon: '◧' },
    { label: 'Settings', desc: 'Template mappings & config', page: 'settings', icon: '⚙' },
  ];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Production Dashboard</h1>
        <p className="page-subtitle">Sportsline Photography — Order Processing & Fulfillment</p>
      </div>

      {/* System Status */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Server Status</span>
          <span className="stat-value" style={{ fontSize: 20 }}>
            {loading ? '...' : health ? '● Online' : '○ Offline'}
          </span>
          <span className="stat-change positive">
            {health?.environment || '—'}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">PhotoDay API</span>
          <span className="stat-value" style={{ fontSize: 20 }}>
            {health?.services?.photoday ? '● Connected' : '○ Not Set'}
          </span>
          <span className="stat-change" style={{ color: health?.services?.photoday ? 'var(--success)' : 'var(--warning)' }}>
            {health?.services?.photoday ? 'Bearer token configured' : 'Token needed'}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">ShipStation API</span>
          <span className="stat-value" style={{ fontSize: 20 }}>
            {health?.services?.shipstation ? '● Connected' : '○ Not Set'}
          </span>
          <span className="stat-change" style={{ color: health?.services?.shipstation ? 'var(--success)' : 'var(--warning)' }}>
            {health?.services?.shipstation ? 'API key configured' : 'Key needed'}
          </span>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3 className="card-title">Quick Actions</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {quickActions.map((action) => (
            <button
              key={action.page}
              className="btn btn-secondary"
              style={{ padding: '20px', flexDirection: 'column', alignItems: 'flex-start', height: 'auto' }}
              onClick={() => onNavigate(action.page)}
            >
              <span style={{ fontSize: 24, marginBottom: 8 }}>{action.icon}</span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{action.label}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>{action.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Workflow Overview */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Production Workflow</h3>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {[
            { step: '1', label: 'Pull Orders', desc: 'Fetch from PhotoDay by job or order ID' },
            { step: '2', label: 'Download Images', desc: 'Save photos to local folder structure' },
            { step: '3', label: 'Generate TXT Files', desc: 'Create Darkroom-compatible order files' },
            { step: '4', label: 'Print & Pack', desc: 'Generate print sheets, QR codes, packing slips' },
            { step: '5', label: 'Ship', desc: 'Create ShipStation orders, mark as shipped' },
          ].map((item, i) => (
            <div key={i} style={{
              flex: '1 1 160px',
              padding: 16,
              background: 'var(--bg-input)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-light)',
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'var(--accent-subtle)', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, marginBottom: 10,
              }}>{item.step}</div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
