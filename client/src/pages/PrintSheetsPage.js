import React, { useState, useEffect } from 'react';
import api from '../services/api';

export default function PrintSheetsPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [layouts, setLayouts] = useState([]);

  // Form state
  const [imagePath, setImagePath] = useState('');
  const [selectedLayout, setSelectedLayout] = useState('8-wallet-8x10');
  const [outputDir, setOutputDir] = useState('');

  const clearMessages = () => { setError(null); setSuccess(null); };

  useEffect(() => {
    loadLayouts();
  }, []);

  const loadLayouts = async () => {
    try {
      const data = await api.getPrintLayouts();
      setLayouts(data);
    } catch (err) { /* ignore */ }
  };

  const generateSheet = async () => {
    if (!imagePath) { setError('Enter the path to an image'); return; }
    clearMessages();
    setLoading(true);
    try {
      const result = await api.generatePrintSheet({
        imagePath,
        layoutId: selectedLayout,
        outputDir: outputDir || undefined,
      });
      setSuccess(`Print sheet generated: ${result.filename} (${result.width}x${result.height}px at ${result.dpi} DPI)`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Print Sheets</h1>
        <p className="page-subtitle">Generate print-ready sheets for wallets and other formats</p>
      </div>

      {error && <div className="alert alert-error">⚠ {error}</div>}
      {success && <div className="alert alert-success">✓ {success}</div>}

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 20 }}>Generate Print Sheet</h3>

          <div className="form-group">
            <label className="form-label">Image Path</label>
            <input
              className="form-input"
              value={imagePath}
              onChange={(e) => setImagePath(e.target.value)}
              placeholder="e.g., C:\SportslinePhotos\109518\photo.jpg"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Layout</label>
            <select
              className="form-select"
              value={selectedLayout}
              onChange={(e) => setSelectedLayout(e.target.value)}
            >
              {layouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.cols}x{l.rows} — {l.itemWidth}"x{l.itemHeight}" items on {l.sheetWidth}"x{l.sheetHeight}")
                </option>
              ))}
              {layouts.length === 0 && <option value="8-wallet-8x10">8 Wallets on 8x10</option>}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Output Directory (optional)</label>
            <input
              className="form-input"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="Leave blank for default"
            />
          </div>

          <button className="btn btn-primary" onClick={generateSheet} disabled={loading}>
            {loading ? 'Generating...' : 'Generate Print Sheet'}
          </button>
        </div>

        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 20 }}>Available Layouts</h3>

          {layouts.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {layouts.map((l) => (
                <div
                  key={l.id}
                  style={{
                    padding: 16,
                    background: selectedLayout === l.id ? 'var(--accent-subtle)' : 'var(--bg-input)',
                    border: `1px solid ${selectedLayout === l.id ? 'var(--accent)' : 'var(--border-light)'}`,
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedLayout(l.id)}
                >
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{l.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {l.cols} cols × {l.rows} rows = {l.cols * l.rows} items
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Item: {l.itemWidth}" × {l.itemHeight}" — Sheet: {l.sheetWidth}" × {l.sheetHeight}"
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">◧</div>
              <div className="empty-state-title">Default layout ready</div>
              <div className="empty-state-text">
                8 wallets (2.5"×3.5") on an 8"×10" sheet at 300 DPI. More layouts coming soon.
              </div>
            </div>
          )}

          <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-input)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Wallet Sheet Preview</div>
            <div style={{
              width: '100%',
              aspectRatio: '10/8',
              background: 'white',
              borderRadius: 4,
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gridTemplateRows: 'repeat(2, 1fr)',
              gap: 2,
              padding: 8,
            }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{
                  background: '#e0e0e0',
                  borderRadius: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  color: '#888',
                  fontWeight: 600,
                }}>
                  2.5×3.5
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
