import React, { useState } from 'react';
import api from '../services/api';

export default function ShipStationPage() {
  const [activeTab, setActiveTab] = useState('create');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [ssOrders, setSsOrders] = useState(null);
  const [createResults, setCreateResults] = useState(null);

  // Shipping defaults
  const [carrierCode, setCarrierCode] = useState('usps');
  const [serviceCode, setServiceCode] = useState('usps_first_class_mail');
  const [weightValue, setWeightValue] = useState('4');
  const [dimLength, setDimLength] = useState('10');
  const [dimWidth, setDimWidth] = useState('8');
  const [dimHeight, setDimHeight] = useState('0.5');

  // Ship form
  const [shipSsOrderId, setShipSsOrderId] = useState('');
  const [shipPdOrderNum, setShipPdOrderNum] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');

  const clearMessages = () => { setError(null); setSuccess(null); setCreateResults(null); };

  // ─── Create orders from PDX ─────────────────────────────
  const createFromPDX = async () => {
    clearMessages();
    setLoading(true);
    try {
      const result = await api.createOrdersFromPDX({
        carrierCode,
        serviceCode,
        weight: { value: parseFloat(weightValue), units: 'ounces' },
        dimensions: { length: parseFloat(dimLength), width: parseFloat(dimWidth), height: parseFloat(dimHeight), units: 'inches' },
      });
      setCreateResults(result);
      setSuccess(`Created ${result.successCount}/${result.totalOrders} orders in ShipStation`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSSOrders = async () => {
    clearMessages();
    setLoading(true);
    try {
      const data = await api.getShipstationOrders({ pageSize: 50 });
      setSsOrders(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const shipOrder = async () => {
    if (!shipSsOrderId || !trackingNumber) { setError('ShipStation Order ID and tracking number required'); return; }
    clearMessages();
    setLoading(true);
    try {
      const result = await api.shipOrder(shipSsOrderId, {
        carrierCode,
        trackingNumber,
        orderNum: shipPdOrderNum || null, // PhotoDay order num for callback
      });
      setSuccess(result.message);
      setShipSsOrderId('');
      setShipPdOrderNum('');
      setTrackingNumber('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">ShipStation</h1>
        <p className="page-subtitle">Create orders, manage shipments, and send PhotoDay shipped callbacks</p>
      </div>

      {error && <div className="alert alert-error">⚠ {error}</div>}
      {success && <div className="alert alert-success">✓ {success}</div>}

      <div className="tabs">
        <button className={`tab ${activeTab === 'create' ? 'active' : ''}`} onClick={() => setActiveTab('create')}>Create from PDX</button>
        <button className={`tab ${activeTab === 'manage' ? 'active' : ''}`} onClick={() => setActiveTab('manage')}>Manage Orders</button>
        <button className={`tab ${activeTab === 'ship' ? 'active' : ''}`} onClick={() => setActiveTab('ship')}>Mark Shipped</button>
      </div>

      {activeTab === 'create' && (
        <div>
          <div className="card" style={{ marginBottom: 24 }}>
            <h3 className="card-title" style={{ marginBottom: 8 }}>Create ShipStation Orders from PDX</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Fetches unprocessed PDX orders and creates them in ShipStation with shipping addresses from the order data.
            </p>
            <button className="btn btn-primary" onClick={createFromPDX} disabled={loading}>
              {loading ? 'Creating...' : 'Create Orders in ShipStation'}
            </button>
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            <h3 className="card-title" style={{ marginBottom: 20 }}>Shipping Defaults</h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Carrier</label>
                <select className="form-select" value={carrierCode} onChange={(e) => setCarrierCode(e.target.value)}>
                  <option value="usps">USPS</option>
                  <option value="ups">UPS</option>
                  <option value="fedex">FedEx</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Service</label>
                <input className="form-input" value={serviceCode} onChange={(e) => setServiceCode(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Weight (oz)</label>
                <input className="form-input" type="number" value={weightValue} onChange={(e) => setWeightValue(e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Length (in)</label>
                <input className="form-input" type="number" value={dimLength} onChange={(e) => setDimLength(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Width (in)</label>
                <input className="form-input" type="number" value={dimWidth} onChange={(e) => setDimWidth(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Height (in)</label>
                <input className="form-input" type="number" value={dimHeight} onChange={(e) => setDimHeight(e.target.value)} />
              </div>
            </div>
          </div>

          {createResults && (
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 16 }}>Creation Results</h3>
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>PD Order #</th><th>Status</th><th>SS Order ID</th></tr></thead>
                  <tbody>
                    {createResults.results?.map((r, i) => (
                      <tr key={i}>
                        <td className="mono">{r.orderNum}</td>
                        <td><span className={`badge ${r.success ? 'badge-success' : 'badge-error'}`}>{r.success ? 'Created' : 'Failed'}</span></td>
                        <td className="mono">{r.shipstationOrderId || r.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'manage' && (
        <div className="card">
          <div className="toolbar">
            <button className="btn btn-primary" onClick={fetchSSOrders} disabled={loading}>
              {loading ? 'Loading...' : 'Load ShipStation Orders'}
            </button>
          </div>

          {ssOrders?.orders ? (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>SS Order ID</th><th>Order #</th><th>Customer</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
                <tbody>
                  {ssOrders.orders.map((o) => (
                    <tr key={o.orderId}>
                      <td className="mono">{o.orderId}</td>
                      <td className="mono">{o.orderNumber}</td>
                      <td>{o.shipTo?.name || o.customerEmail || '—'}</td>
                      <td><span className="badge badge-info">{o.orderStatus}</span></td>
                      <td>{new Date(o.orderDate).toLocaleDateString()}</td>
                      <td>
                        <button className="btn btn-sm btn-danger" onClick={async () => {
                          try { await api.deleteShipstationOrder(o.orderId); setSuccess(`Deleted ${o.orderId}`); fetchSSOrders(); }
                          catch (err) { setError(err.message); }
                        }}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">⬢</div>
              <div className="empty-state-title">No orders loaded</div>
              <div className="empty-state-text">Click "Load ShipStation Orders" to view.</div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'ship' && (
        <div className="card" style={{ maxWidth: 500 }}>
          <h3 className="card-title" style={{ marginBottom: 8 }}>Mark Shipped (ShipStation + PhotoDay)</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Marks shipped in ShipStation and sends the PhotoDay callback so the customer gets tracking info.
          </p>
          <div className="form-group">
            <label className="form-label">ShipStation Order ID</label>
            <input className="form-input" value={shipSsOrderId} onChange={(e) => setShipSsOrderId(e.target.value)} placeholder="ShipStation order ID" />
          </div>
          <div className="form-group">
            <label className="form-label">PhotoDay Order Number (for callback)</label>
            <input className="form-input" value={shipPdOrderNum} onChange={(e) => setShipPdOrderNum(e.target.value)} placeholder="e.g., SB1773428567" />
          </div>
          <div className="form-group">
            <label className="form-label">Tracking Number</label>
            <input className="form-input" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} placeholder="Enter tracking number" />
          </div>
          <button className="btn btn-success" onClick={shipOrder} disabled={loading}>
            {loading ? 'Processing...' : 'Mark as Shipped'}
          </button>
        </div>
      )}
    </div>
  );
}
