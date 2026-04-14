import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('imposition');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Imposition
  const [layouts, setLayouts] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [textVariables, setTextVariables] = useState([]);
  const [editingLayout, setEditingLayout] = useState(null);
  const [showLayoutForm, setShowLayoutForm] = useState(false);
  const [newMapping, setNewMapping] = useState({ externalId: '', layoutId: '' });

  // Layout form
  const emptyLayout = {
    name: '', cols: 4, rows: 2, itemWidth: 2.5, itemHeight: 3.5,
    sheetWidth: 10, sheetHeight: 8, dpi: 300, colGap: 0.01, rowGap: 0.01,
    centerOnSheet: false, marginLeft: 0, marginTop: 0, textOverlays: [],
  };
  const [layoutForm, setLayoutForm] = useState({ ...emptyLayout });

  // Template mappings
  const [templateMappings, setTemplateMappings] = useState([]);
  const [newTemplate, setNewTemplate] = useState({ productName: '', externalId: '', templatePath: '', size: '' });

  // Size mappings
  const [sizeMappings, setSizeMappings] = useState([]);
  const [newSize, setNewSize] = useState({ externalId: '', size: '', productName: '' });

  // Filename config
  const [fileNameConfig, setFileNameConfig] = useState({ pattern: '{order_number}', extension: '.txt' });

  // Folder sort
  const [folderSortLevels, setFolderSortLevels] = useState([]);
  const [folderSortOptions, setFolderSortOptions] = useState([]);

  // Specialty products
  const [specialtyProducts, setSpecialtyProducts] = useState([]);
  const [specialtyBasePath, setSpecialtyBasePath] = useState('');
  const [newSpecialty, setNewSpecialty] = useState({ externalId: '', productName: '', subfolder: '' });
  const [highlightColors, setHighlightColors] = useState({ specialty: '#FFF3CD', quantity: '#D4EDDA' });

  const clearMessages = () => { setError(null); setSuccess(null); };

  // ─── Load data ──────────────────────────────────────────
  const loadImposition = useCallback(async () => {
    try {
      const [l, m, tv] = await Promise.all([
        api.getImpositionLayouts(),
        api.getImpositionMappings(),
        api.getImpositionTextVariables(),
      ]);
      setLayouts(l);
      setMappings(m);
      setTextVariables(tv);
    } catch (err) { /* silent */ }
  }, []);

  const loadTemplates = useCallback(async () => {
    try { setTemplateMappings(await api.getTemplateMappings()); } catch (err) { /* silent */ }
  }, []);

  const loadSizeMappings = useCallback(async () => {
    try { setSizeMappings(await api.getSizeMappings()); } catch (err) { /* silent */ }
  }, []);

  const loadFileNameConfig = useCallback(async () => {
    try { setFileNameConfig(await api.getFileNameConfig()); } catch (err) { /* silent */ }
  }, []);

  const loadFolderSort = useCallback(async () => {
    try {
      const [opts, current] = await Promise.all([api.getFolderSortOptions(), api.getFolderSort()]);
      setFolderSortOptions(opts);
      setFolderSortLevels(current.sortLevels || []);
    } catch (err) { /* silent */ }
  }, []);

  const loadSpecialty = useCallback(async () => {
    try {
      const data = await api.getSpecialtyConfig();
      setSpecialtyProducts(data.products || []);
      setSpecialtyBasePath(data.basePath || '');
      setHighlightColors(data.highlightColors || { specialty: '#FFF3CD', quantity: '#D4EDDA' });
    } catch (err) { /* silent */ }
  }, []);

  useEffect(() => { loadImposition(); loadTemplates(); loadSizeMappings(); loadFileNameConfig(); loadFolderSort(); loadSpecialty(); }, [loadImposition, loadTemplates, loadSizeMappings, loadFileNameConfig, loadFolderSort, loadSpecialty]);

  // ─── Layout form helpers ────────────────────────────────
  const updateField = (field, value) => setLayoutForm(prev => ({ ...prev, [field]: value }));

  const layoutPreview = useMemo(() => {
    const { cols, rows, itemWidth, itemHeight, sheetWidth, sheetHeight } = layoutForm;
    const totalItems = cols * rows;
    const contentW = (cols * parseFloat(itemWidth)).toFixed(1);
    const contentH = (rows * parseFloat(itemHeight)).toFixed(1);
    const extraW = (parseFloat(sheetWidth) - contentW).toFixed(1);
    const extraH = (parseFloat(sheetHeight) - contentH).toFixed(1);
    return {
      text: `${totalItems} items (${cols}×${rows}), each ${itemWidth}"×${itemHeight}" → content area ${contentW}"×${contentH}" on ${sheetWidth}"×${sheetHeight}" sheet`,
      extraW: parseFloat(extraW),
      extraH: parseFloat(extraH),
    };
  }, [layoutForm]);

  // ─── Text overlay management ────────────────────────────
  const addTextOverlay = () => {
    setLayoutForm(prev => ({
      ...prev,
      textOverlays: [...prev.textOverlays, { text: '', x: 0, y: parseFloat(prev.sheetHeight) - 0.5, fontSize: 10, color: '#000000' }],
    }));
  };

  const updateTextOverlay = (index, field, value) => {
    setLayoutForm(prev => {
      const overlays = [...prev.textOverlays];
      overlays[index] = { ...overlays[index], [field]: value };
      return { ...prev, textOverlays: overlays };
    });
  };

  const removeTextOverlay = (index) => {
    setLayoutForm(prev => ({
      ...prev,
      textOverlays: prev.textOverlays.filter((_, i) => i !== index),
    }));
  };

  const insertVariable = (index, token) => {
    setLayoutForm(prev => {
      const overlays = [...prev.textOverlays];
      overlays[index] = { ...overlays[index], text: (overlays[index].text || '') + token };
      return { ...prev, textOverlays: overlays };
    });
  };

  // ─── Layout CRUD ────────────────────────────────────────
  const saveLayout = async () => {
    clearMessages(); setLoading(true);
    try {
      if (editingLayout) {
        await api.updateImpositionLayout(editingLayout, layoutForm);
        setSuccess('Layout updated');
      } else {
        await api.addImpositionLayout(layoutForm);
        setSuccess('Layout created');
      }
      setShowLayoutForm(false); setEditingLayout(null); setLayoutForm({ ...emptyLayout });
      await loadImposition();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const editLayout = (layout) => {
    // Backward compatibility: migrate old single 'gap' to colGap/rowGap
    const migrated = { ...layout };
    if (migrated.gap !== undefined && migrated.colGap === undefined) {
      migrated.colGap = migrated.gap;
      migrated.rowGap = migrated.gap;
    }
    setLayoutForm({ ...emptyLayout, ...migrated, textOverlays: layout.textOverlays || [] });
    setEditingLayout(layout.id);
    setShowLayoutForm(true);
  };

  const deleteLayout = async (id) => {
    clearMessages();
    try { await api.deleteImpositionLayout(id); setSuccess('Layout deleted'); await loadImposition(); }
    catch (err) { setError(err.message); }
  };

  // ─── Mapping CRUD ───────────────────────────────────────
  const addMappingHandler = async () => {
    if (!newMapping.externalId || !newMapping.layoutId) { setError('Both fields required'); return; }
    clearMessages();
    try { await api.addImpositionMapping(newMapping.externalId, newMapping.layoutId); setNewMapping({ externalId: '', layoutId: '' }); setSuccess('Mapping added'); await loadImposition(); }
    catch (err) { setError(err.message); }
  };

  const deleteMappingHandler = async (externalId) => {
    clearMessages();
    try { await api.deleteImpositionMapping(externalId); setSuccess('Mapping removed'); await loadImposition(); }
    catch (err) { setError(err.message); }
  };

  // ─── Template CRUD ──────────────────────────────────────
  const addTemplate = async () => {
    if (!newTemplate.productName || !newTemplate.templatePath) { setError('Product name and template path required'); return; }
    clearMessages();
    try { await api.addTemplateMapping(newTemplate); setNewTemplate({ productName: '', externalId: '', templatePath: '', size: '' }); setSuccess('Template mapping added'); await loadTemplates(); }
    catch (err) { setError(err.message); }
  };

  const deleteTemplate = async (id) => {
    clearMessages();
    try { await api.deleteTemplateMapping(id); setSuccess('Template removed'); await loadTemplates(); }
    catch (err) { setError(err.message); }
  };

  // ─── Size Mapping CRUD ────────────────────────────────────
  const addSize = async () => {
    if (!newSize.externalId || !newSize.size) { setError('External ID and size are required'); return; }
    clearMessages();
    try {
      await api.addSizeMapping(newSize);
      setNewSize({ externalId: '', size: '', productName: '' });
      setSuccess('Size mapping added');
      await loadSizeMappings();
    } catch (err) { setError(err.message); }
  };

  const deleteSize = async (externalId) => {
    clearMessages();
    try { await api.deleteSizeMapping(externalId); setSuccess('Size mapping removed'); await loadSizeMappings(); }
    catch (err) { setError(err.message); }
  };

  // ─── Filename ───────────────────────────────────────────
  const saveFileNameConfig = async () => {
    clearMessages();
    try { await api.updateFileNameConfig(fileNameConfig); setSuccess('Filename config saved'); }
    catch (err) { setError(err.message); }
  };

  // ─── Specialty Products ─────────────────────────────────
  const addSpecialty = async () => {
    if (!newSpecialty.externalId || !newSpecialty.productName) { setError('External ID and product name required'); return; }
    clearMessages();
    try {
      await api.addSpecialtyProduct({
        ...newSpecialty,
        subfolder: newSpecialty.subfolder || newSpecialty.productName,
      });
      setNewSpecialty({ externalId: '', productName: '', subfolder: '' });
      setSuccess('Specialty product added');
      await loadSpecialty();
    } catch (err) { setError(err.message); }
  };

  const deleteSpecialty = async (externalId) => {
    clearMessages();
    try { await api.deleteSpecialtyProduct(externalId); setSuccess('Specialty product removed'); await loadSpecialty(); }
    catch (err) { setError(err.message); }
  };

  const saveSpecialtyBasePath = async () => {
    clearMessages();
    try { await api.setSpecialtyBasePath(specialtyBasePath); setSuccess('Specialty base path saved'); }
    catch (err) { setError(err.message); }
  };

  // ─── Folder Sort ────────────────────────────────────────
  const isNoSort = folderSortLevels.includes('no_sort');

  const addSortLevel = (id) => {
    if (id === 'no_sort') {
      // No Sort replaces everything
      setFolderSortLevels(['no_sort']);
      return;
    }
    if (isNoSort) return; // Can't add to No Sort
    if (folderSortLevels.includes(id)) return;
    setFolderSortLevels(prev => [...prev, id]);
  };

  const removeSortLevel = (index) => {
    setFolderSortLevels(prev => prev.filter((_, i) => i !== index));
  };

  const moveSortLevel = (index, direction) => {
    setFolderSortLevels(prev => {
      const arr = [...prev];
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= arr.length) return arr;
      [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
      return arr;
    });
  };

  const saveFolderSort = async () => {
    if (folderSortLevels.length === 0) { setError('At least one sort level required'); return; }
    clearMessages();
    try {
      await api.updateFolderSort(folderSortLevels);
      setSuccess('Folder sort saved: ' + folderSortLevels.join(' → '));
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Imposition layouts, template mappings, and configuration</p>
      </div>

      {error && <div className="alert alert-error">⚠ {error}</div>}
      {success && <div className="alert alert-success">✓ {success}</div>}

      <div className="tabs">
        <button className={`tab ${activeSection === 'imposition' ? 'active' : ''}`} onClick={() => setActiveSection('imposition')}>Imposition Layouts</button>
        <button className={`tab ${activeSection === 'sizes' ? 'active' : ''}`} onClick={() => setActiveSection('sizes')}>Product Sizes</button>
        <button className={`tab ${activeSection === 'specialty' ? 'active' : ''}`} onClick={() => setActiveSection('specialty')}>Specialty Products</button>
        <button className={`tab ${activeSection === 'folders' ? 'active' : ''}`} onClick={() => setActiveSection('folders')}>Folder Sort</button>
        <button className={`tab ${activeSection === 'templates' ? 'active' : ''}`} onClick={() => setActiveSection('templates')}>Darkroom Templates</button>
        <button className={`tab ${activeSection === 'filename' ? 'active' : ''}`} onClick={() => setActiveSection('filename')}>Filename Config</button>
      </div>

      {/* ═══ IMPOSITION ══════════════════════════════════════ */}
      {activeSection === 'imposition' && (
        <div>
          {/* Layout list */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <h3 className="card-title">Print Layouts</h3>
              <button className="btn btn-primary btn-sm" onClick={() => { setLayoutForm({ ...emptyLayout }); setEditingLayout(null); setShowLayoutForm(true); }}>
                + New Layout
              </button>
            </div>
            {layouts.length > 0 ? (
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Name</th><th>Grid</th><th>Item Size</th><th>Sheet Size</th><th>DPI</th><th>Col/Row Gap</th><th>Text</th><th>Actions</th></tr></thead>
                  <tbody>
                    {layouts.map(l => (
                      <tr key={l.id}>
                        <td style={{ fontWeight: 600 }}>{l.name}</td>
                        <td className="mono">{l.cols}×{l.rows} ({l.cols * l.rows})</td>
                        <td className="mono">{l.itemWidth}"×{l.itemHeight}"</td>
                        <td className="mono">{l.sheetWidth}"×{l.sheetHeight}"</td>
                        <td className="mono">{l.dpi}</td>
                        <td className="mono">{l.colGap || l.gap || 0}" / {l.rowGap || l.gap || 0}"</td>
                        <td className="mono">{(l.textOverlays || []).length}</td>
                        <td>
                          <div className="btn-group">
                            <button className="btn btn-sm btn-secondary" onClick={() => editLayout(l)}>Edit</button>
                            <button className="btn btn-sm btn-danger" onClick={() => deleteLayout(l.id)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">⊞</div>
                <div className="empty-state-title">No layouts defined</div>
                <div className="empty-state-text">Create a layout to define how images are tiled onto print sheets.</div>
              </div>
            )}
          </div>

          {/* Layout form */}
          {showLayoutForm && (
            <div className="card" style={{ marginBottom: 24, border: '2px solid var(--accent)' }}>
              <h3 className="card-title" style={{ marginBottom: 16 }}>{editingLayout ? 'Edit Layout' : 'New Layout'}</h3>

              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                {/* Left: Form fields */}
                <div style={{ flex: '1 1 400px', minWidth: 300 }}>
                  <div className="form-group">
                    <label className="form-label">Layout Name</label>
                    <input className="form-input" value={layoutForm.name} onChange={(e) => updateField('name', e.target.value)} placeholder="e.g., 8 Wallets on 8x10" />
                  </div>

                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Columns</label><input className="form-input" type="number" min="1" value={layoutForm.cols} onChange={(e) => updateField('cols', e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">Rows</label><input className="form-input" type="number" min="1" value={layoutForm.rows} onChange={(e) => updateField('rows', e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">Item W (")</label><input className="form-input" type="number" step="0.1" value={layoutForm.itemWidth} onChange={(e) => updateField('itemWidth', e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">Item H (")</label><input className="form-input" type="number" step="0.1" value={layoutForm.itemHeight} onChange={(e) => updateField('itemHeight', e.target.value)} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Sheet W (")</label><input className="form-input" type="number" step="0.1" value={layoutForm.sheetWidth} onChange={(e) => updateField('sheetWidth', e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">Sheet H (")</label><input className="form-input" type="number" step="0.1" value={layoutForm.sheetHeight} onChange={(e) => updateField('sheetHeight', e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">DPI</label><input className="form-input" type="number" value={layoutForm.dpi} onChange={(e) => updateField('dpi', e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">Col Gap (")</label><input className="form-input" type="number" min="0" step="0.01" value={layoutForm.colGap} onChange={(e) => updateField('colGap', e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">Row Gap (")</label><input className="form-input" type="number" min="0" step="0.01" value={layoutForm.rowGap} onChange={(e) => updateField('rowGap', e.target.value)} /></div>
                  </div>

                  {/* Position on sheet */}
                  {(() => {
                    const sw = parseFloat(layoutForm.sheetWidth) || 10;
                    const sh = parseFloat(layoutForm.sheetHeight) || 8;
                    const iw = parseFloat(layoutForm.itemWidth) || 2.5;
                    const ih = parseFloat(layoutForm.itemHeight) || 3.5;
                    const c = parseInt(layoutForm.cols) || 1;
                    const r = parseInt(layoutForm.rows) || 1;
                    const cg = parseFloat(layoutForm.colGap) || 0;
                    const rg = parseFloat(layoutForm.rowGap) || 0;
                    const contentW = (c * iw) + ((c - 1) * cg);
                    const contentH = (r * ih) + ((r - 1) * rg);
                    const calcMarginLeft = Math.max((sw - contentW) / 2, 0);
                    const calcMarginTop = Math.max((sh - contentH) / 2, 0);
                    const isCentered = layoutForm.centerOnSheet;

                    return (
                      <div className="form-row" style={{ alignItems: 'flex-end' }}>
                        <div className="form-group" style={{ flex: '0 0 auto' }}>
                          <label className="form-label" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input type="checkbox" checked={isCentered} onChange={(e) => {
                              updateField('centerOnSheet', e.target.checked);
                              if (e.target.checked) {
                                updateField('marginLeft', parseFloat(calcMarginLeft.toFixed(2)));
                                updateField('marginTop', parseFloat(calcMarginTop.toFixed(2)));
                              }
                            }} />
                            Center on sheet
                          </label>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Left Margin (")</label>
                          <input className="form-input" type="number" min="0" step="0.1"
                            value={isCentered ? parseFloat(calcMarginLeft.toFixed(2)) : (layoutForm.marginLeft || 0)}
                            onChange={(e) => updateField('marginLeft', parseFloat(e.target.value) || 0)}
                            disabled={isCentered}
                            style={{ opacity: isCentered ? 0.5 : 1 }} />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Top Margin (")</label>
                          <input className="form-input" type="number" min="0" step="0.1"
                            value={isCentered ? parseFloat(calcMarginTop.toFixed(2)) : (layoutForm.marginTop || 0)}
                            onChange={(e) => updateField('marginTop', parseFloat(e.target.value) || 0)}
                            disabled={isCentered}
                            style={{ opacity: isCentered ? 0.5 : 1 }} />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Info */}
                  <div style={{ padding: '8px 12px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 16 }}>
                    {layoutPreview.text}
                    {(layoutPreview.extraW > 0 || layoutPreview.extraH > 0) && (
                      <span style={{ color: 'var(--warning)', marginLeft: 8 }}>
                        Extra: {layoutPreview.extraW > 0 ? `${layoutPreview.extraW}" right` : ''}{layoutPreview.extraW > 0 && layoutPreview.extraH > 0 ? ', ' : ''}{layoutPreview.extraH > 0 ? `${layoutPreview.extraH}" bottom` : ''}
                      </span>
                    )}
                  </div>

                  {/* Text Overlays */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <label className="form-label" style={{ marginBottom: 0, fontWeight: 700 }}>Text Overlays</label>
                      <button className="btn btn-sm btn-secondary" onClick={addTextOverlay}>+ Add Text</button>
                    </div>

                    {layoutForm.textOverlays.length === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>No text overlays. Add text to empty areas of the sheet.</div>
                    )}

                    {layoutForm.textOverlays.map((overlay, i) => (
                      <div key={i} style={{ padding: 10, background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', marginBottom: 8, border: '1px solid var(--border-light)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 600 }}>Text #{i + 1}</span>
                          <button className="btn btn-sm btn-danger" onClick={() => removeTextOverlay(i)} style={{ padding: '1px 6px', fontSize: 10 }}>✕</button>
                        </div>

                        <div className="form-group" style={{ marginBottom: 6 }}>
                          <label className="form-label" style={{ fontSize: 10 }}>Text (use \\n for line breaks)</label>
                          <textarea className="form-input" value={overlay.text} onChange={(e) => updateTextOverlay(i, 'text', e.target.value)}
                            placeholder="e.g., Order: {order_id}\\nGallery: {gallery}" style={{ fontSize: 11, minHeight: 50, resize: 'vertical' }} />
                        </div>

                        {/* Variable buttons */}
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8 }}>
                          {textVariables.map(v => (
                            <button key={v.token} className="btn btn-sm btn-secondary"
                              onClick={() => insertVariable(i, v.token)}
                              title={v.description}
                              style={{ padding: '1px 4px', fontSize: 9 }}>
                              {v.token}
                            </button>
                          ))}
                          <button className="btn btn-sm btn-secondary"
                            onClick={() => insertVariable(i, '\\n')}
                            title="Insert line break"
                            style={{ padding: '1px 4px', fontSize: 9, fontWeight: 700 }}>
                            ↵ newline
                          </button>
                        </div>

                        <div className="form-row">
                          <div className="form-group" style={{ marginBottom: 0, flex: '1' }}>
                            <label className="form-label" style={{ fontSize: 10 }}>X (")</label>
                            <input className="form-input" type="number" step="0.1" value={overlay.x} onChange={(e) => updateTextOverlay(i, 'x', parseFloat(e.target.value) || 0)} style={{ fontSize: 11 }} />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0, flex: '1' }}>
                            <label className="form-label" style={{ fontSize: 10 }}>Y (")</label>
                            <input className="form-input" type="number" step="0.1" value={overlay.y} onChange={(e) => updateTextOverlay(i, 'y', parseFloat(e.target.value) || 0)} style={{ fontSize: 11 }} />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0, flex: '1' }}>
                            <label className="form-label" style={{ fontSize: 10 }}>Size (pt)</label>
                            <input className="form-input" type="number" min="4" max="72" value={overlay.fontSize} onChange={(e) => updateTextOverlay(i, 'fontSize', parseInt(e.target.value) || 10)} style={{ fontSize: 11 }} />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0, flex: '1' }}>
                            <label className="form-label" style={{ fontSize: 10 }}>Rotate (°)</label>
                            <input className="form-input" type="number" min="-360" max="360" value={overlay.rotation || 0} onChange={(e) => updateTextOverlay(i, 'rotation', parseInt(e.target.value) || 0)} style={{ fontSize: 11 }} />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0, flex: '0 0 50px' }}>
                            <label className="form-label" style={{ fontSize: 10 }}>Color</label>
                            <input type="color" value={overlay.color || '#000000'} onChange={(e) => updateTextOverlay(i, 'color', e.target.value)}
                              style={{ width: '100%', height: 28, border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)' }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: Live Preview */}
                <div style={{ flex: '0 0 360px', minWidth: 300 }}>
                  <label className="form-label" style={{ fontWeight: 700, marginBottom: 8 }}>Live Preview</label>
                  <div style={{ background: '#2a2a3a', borderRadius: 'var(--radius-sm)', padding: 16 }}>
                    {(() => {
                      const sw = parseFloat(layoutForm.sheetWidth) || 10;
                      const sh = parseFloat(layoutForm.sheetHeight) || 8;
                      const iw = parseFloat(layoutForm.itemWidth) || 2.5;
                      const ih = parseFloat(layoutForm.itemHeight) || 3.5;
                      const c = parseInt(layoutForm.cols) || 1;
                      const r = parseInt(layoutForm.rows) || 1;
                      const cg = parseFloat(layoutForm.colGap) || 0;
                      const rg = parseFloat(layoutForm.rowGap) || 0;

                      // Margin/centering
                      const contentW_in = (c * iw) + ((c - 1) * cg);
                      const contentH_in = (r * ih) + ((r - 1) * rg);
                      const isCentered = layoutForm.centerOnSheet;
                      const offsetLeft = isCentered ? Math.max((sw - contentW_in) / 2, 0) : (parseFloat(layoutForm.marginLeft) || 0);
                      const offsetTop = isCentered ? Math.max((sh - contentH_in) / 2, 0) : (parseFloat(layoutForm.marginTop) || 0);

                      // Scale: everything is in inches, convert to preview pixels
                      const maxW = 328;
                      const maxH = 400;
                      const scaleX = maxW / sw;
                      const scaleY = maxH / sh;
                      const scale = Math.min(scaleX, scaleY);

                      // All positions in preview pixels = inches × scale
                      const pvW = Math.round(sw * scale);
                      const pvH = Math.round(sh * scale);

                      // Content area
                      const extraW_in = sw - contentW_in - offsetLeft;
                      const extraH_in = sh - contentH_in - offsetTop;

                      // SVG includes margin for labels
                      const uiMargin = 24;
                      const svgW = pvW + uiMargin * 2;
                      const svgH = pvH + uiMargin * 2 + 20;

                      // Build grid cells — all positions in inches then scaled, offset by margins
                      const cells = [];
                      for (let row = 0; row < r; row++) {
                        for (let col = 0; col < c; col++) {
                          const xIn = offsetLeft + col * (iw + cg);
                          const yIn = offsetTop + row * (ih + rg);
                          const x = uiMargin + xIn * scale;
                          const y = uiMargin + yIn * scale;
                          const w = iw * scale;
                          const h = ih * scale;
                          cells.push(
                            <rect key={`c${row}-${col}`} x={x} y={y} width={w} height={h}
                              fill="#4a90d9" fillOpacity="0.25" stroke="#4a90d9" strokeWidth="1.5" rx="2" />
                          );
                          cells.push(
                            <text key={`t${row}-${col}`} x={x + w / 2} y={y + h / 2 + 4}
                              textAnchor="middle" fontSize="11" fill="#4a90d9" fontWeight="600">
                              {`${iw}"×${ih}"`}
                            </text>
                          );
                        }
                      }

                      // Gap indicators
                      const gapLines = [];
                      if (cg > 0) {
                        for (let col = 1; col < c; col++) {
                          const gapStartIn = offsetLeft + col * iw + (col - 1) * cg;
                          const gapX = uiMargin + gapStartIn * scale;
                          const gapW = cg * scale;
                          gapLines.push(
                            <g key={`cg${col}`}>
                              <rect x={gapX} y={uiMargin + offsetTop * scale} width={Math.max(gapW, 1)} height={contentH_in * scale}
                                fill="#ff6b6b" fillOpacity="0.15" />
                              {gapW > 8 && (
                                <text x={gapX + gapW / 2} y={uiMargin + (offsetTop + contentH_in) * scale + 12}
                                  textAnchor="middle" fontSize="8" fill="#ff6b6b">{cg}"</text>
                              )}
                            </g>
                          );
                        }
                      }
                      if (rg > 0) {
                        for (let row = 1; row < r; row++) {
                          const gapStartIn = offsetTop + row * ih + (row - 1) * rg;
                          const gapY = uiMargin + gapStartIn * scale;
                          const gapH = rg * scale;
                          gapLines.push(
                            <g key={`rg${row}`}>
                              <rect x={uiMargin + offsetLeft * scale} y={gapY} width={contentW_in * scale} height={Math.max(gapH, 1)}
                                fill="#ff6b6b" fillOpacity="0.15" />
                            </g>
                          );
                        }
                      }

                      // Extra space shading
                      const extraSpace = [];
                      if (extraW_in > 0.01) {
                        const exX = uiMargin + (offsetLeft + contentW_in) * scale;
                        extraSpace.push(
                          <g key="exW">
                            <rect x={exX} y={uiMargin} width={extraW_in * scale} height={pvH}
                              fill="#ffaa00" fillOpacity="0.08" stroke="#ffaa00" strokeWidth="0.5" strokeDasharray="4,3" />
                            <text x={exX + (extraW_in * scale) / 2} y={uiMargin + pvH / 2}
                              textAnchor="middle" fontSize="9" fill="#ffaa00" fontWeight="600">
                              {extraW_in.toFixed(1)}"
                            </text>
                          </g>
                        );
                      }
                      // Left margin shading
                      if (offsetLeft > 0.01) {
                        extraSpace.push(
                          <g key="mL">
                            <rect x={uiMargin} y={uiMargin} width={offsetLeft * scale} height={pvH}
                              fill="#66bb6a" fillOpacity="0.08" stroke="#66bb6a" strokeWidth="0.5" strokeDasharray="4,3" />
                            <text x={uiMargin + (offsetLeft * scale) / 2} y={uiMargin + pvH / 2}
                              textAnchor="middle" fontSize="9" fill="#66bb6a" fontWeight="600">
                              {offsetLeft.toFixed(1)}"
                            </text>
                          </g>
                        );
                      }
                      if (extraH_in > 0.01) {
                        const exY = uiMargin + (offsetTop + contentH_in) * scale;
                        extraSpace.push(
                          <g key="exH">
                            <rect x={uiMargin} y={exY} width={pvW} height={extraH_in * scale}
                              fill="#ffaa00" fillOpacity="0.08" stroke="#ffaa00" strokeWidth="0.5" strokeDasharray="4,3" />
                            <text x={uiMargin + pvW / 2} y={exY + (extraH_in * scale) / 2 + 3}
                              textAnchor="middle" fontSize="9" fill="#ffaa00" fontWeight="600">
                              {extraH_in.toFixed(1)}"
                            </text>
                          </g>
                        );
                      }
                      // Top margin shading
                      if (offsetTop > 0.01) {
                        extraSpace.push(
                          <g key="mT">
                            <rect x={uiMargin} y={uiMargin} width={pvW} height={offsetTop * scale}
                              fill="#66bb6a" fillOpacity="0.08" stroke="#66bb6a" strokeWidth="0.5" strokeDasharray="4,3" />
                            <text x={uiMargin + pvW / 2} y={uiMargin + (offsetTop * scale) / 2 + 3}
                              textAnchor="middle" fontSize="9" fill="#66bb6a" fontWeight="600">
                              {offsetTop.toFixed(1)}"
                            </text>
                          </g>
                        );
                      }

                      // Text overlays — positioned in inches, same coordinate system
                      const textIndicators = (layoutForm.textOverlays || []).map((ov, idx) => {
                        const tx = uiMargin + (ov.x || 0) * scale;
                        const ty = uiMargin + (ov.y || 0) * scale;
                        const rot = ov.rotation || 0;
                        const lines = (ov.text || 'Text').split('\\n');
                        const displayText = lines[0].substring(0, 25);
                        const textColor = ov.color || '#000';
                        const fSize = Math.max(Math.round((ov.fontSize || 10) * scale / 30), 7);
                        const labelW = Math.min(displayText.length * fSize * 0.6 + 8, pvW);
                        const labelH = fSize + 6;

                        return (
                          <g key={`ov${idx}`} transform={`rotate(${rot} ${tx} ${ty})`}>
                            <rect x={tx} y={ty - 2} width={labelW} height={labelH * lines.length}
                              fill={textColor} fillOpacity="0.12" rx="2" stroke={textColor} strokeWidth="1" strokeDasharray="2,2" />
                            <text x={tx + 3} y={ty + fSize - 1} fontSize={fSize} fill={textColor} fontFamily="Arial" fontWeight="600">
                              {displayText}{lines.length > 1 ? '...' : ''}
                            </text>
                            {/* Position label */}
                            <text x={tx} y={ty - 5} fontSize="7" fill="#aaa">
                              ({(ov.x || 0)}", {(ov.y || 0)}")
                            </text>
                          </g>
                        );
                      });

                      // Ruler ticks along top and left
                      const rulerTicks = [];
                      for (let i = 0; i <= sw; i++) {
                        const x = uiMargin + i * scale;
                        const isMajor = i === Math.floor(i);
                        rulerTicks.push(
                          <line key={`rtx${i}`} x1={x} y1={uiMargin - (isMajor ? 8 : 4)} x2={x} y2={uiMargin}
                            stroke="#888" strokeWidth={isMajor ? 0.8 : 0.4} />
                        );
                        if (isMajor && i > 0 && i < sw) {
                          rulerTicks.push(
                            <text key={`rtxl${i}`} x={x} y={uiMargin - 10} textAnchor="middle" fontSize="7" fill="#888">{i}"</text>
                          );
                        }
                      }
                      for (let i = 0; i <= sh; i++) {
                        const y = uiMargin + i * scale;
                        const isMajor = i === Math.floor(i);
                        rulerTicks.push(
                          <line key={`rty${i}`} x1={uiMargin - (isMajor ? 8 : 4)} y1={y} x2={uiMargin} y2={y}
                            stroke="#888" strokeWidth={isMajor ? 0.8 : 0.4} />
                        );
                        if (isMajor && i > 0 && i < sh) {
                          rulerTicks.push(
                            <text key={`rtyl${i}`} x={uiMargin - 12} y={y + 3} textAnchor="end" fontSize="7" fill="#888">{i}"</text>
                          );
                        }
                      }

                      return (
                        <svg width={svgW} height={svgH} style={{ display: 'block' }}>
                          {/* Dark background */}
                          <rect width={svgW} height={svgH} fill="#2a2a3a" />

                          {/* Rulers */}
                          {rulerTicks}

                          {/* Sheet — white with strong border */}
                          <rect x={uiMargin} y={uiMargin} width={pvW} height={pvH}
                            fill="white" stroke="#666" strokeWidth="2" />

                          {/* Extra space */}
                          {extraSpace}

                          {/* Gap indicators */}
                          {gapLines}

                          {/* Image cells */}
                          {cells}

                          {/* Text overlays */}
                          {textIndicators}

                          {/* Bottom dimensions */}
                          <text x={uiMargin + pvW / 2} y={uiMargin + pvH + 16}
                            textAnchor="middle" fontSize="10" fill="#aaa" fontWeight="600">
                            {sw}" × {sh}" sheet
                          </text>
                        </svg>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <div className="btn-group" style={{ marginTop: 16 }}>
                <button className="btn btn-primary" onClick={saveLayout} disabled={loading || !layoutForm.name}>
                  {loading ? 'Saving...' : editingLayout ? 'Update Layout' : 'Create Layout'}
                </button>
                <button className="btn btn-secondary" onClick={() => { setShowLayoutForm(false); setEditingLayout(null); }}>Cancel</button>
              </div>
            </div>
          )}

          {/* ExternalId mappings */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Product → Layout Mappings</h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Map a product's External ID to an imposition layout. Matching items are automatically composed during order processing.
            </p>

            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0, flex: '0 0 140px' }}>
                <label className="form-label">External ID</label>
                <input className="form-input" value={newMapping.externalId} onChange={(e) => setNewMapping({ ...newMapping, externalId: e.target.value })} placeholder="e.g., 12" />
              </div>
              <div className="form-group" style={{ marginBottom: 0, flex: '1 1 200px' }}>
                <label className="form-label">Layout</label>
                <select className="form-select" value={newMapping.layoutId} onChange={(e) => setNewMapping({ ...newMapping, layoutId: e.target.value })}>
                  <option value="">Select a layout...</option>
                  {layouts.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.cols}×{l.rows} on {l.sheetWidth}"×{l.sheetHeight}")</option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary btn-sm" onClick={addMappingHandler} style={{ marginBottom: 0 }}>Add Mapping</button>
            </div>

            {mappings.length > 0 ? (
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>External ID</th><th>Layout</th><th>Actions</th></tr></thead>
                  <tbody>
                    {mappings.map(m => (
                      <tr key={m.externalId}>
                        <td className="mono" style={{ fontWeight: 600 }}>{m.externalId}</td>
                        <td>{m.layoutName}</td>
                        <td><button className="btn btn-sm btn-danger" onClick={() => deleteMappingHandler(m.externalId)}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No mappings configured.</div>
            )}
          </div>
        </div>
      )}

      {/* ═══ PRODUCT SIZES ═════════════════════════════════════ */}
      {activeSection === 'sizes' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Product Size Mappings</h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            Map each product's External ID to its print size. This determines the "Size=" value in Darkroom txt files. If no mapping exists, the system falls back to parsing the product description.
          </p>

          {/* Add size form */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0, flex: '0 0 120px' }}>
              <label className="form-label">External ID</label>
              <input className="form-input" value={newSize.externalId} onChange={(e) => setNewSize({ ...newSize, externalId: e.target.value })} placeholder="e.g., 10" />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: '0 0 120px' }}>
              <label className="form-label">Print Size</label>
              <input className="form-input" value={newSize.size} onChange={(e) => setNewSize({ ...newSize, size: e.target.value })} placeholder="e.g., 5x7" />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: '1 1 180px' }}>
              <label className="form-label">Product Name (optional)</label>
              <input className="form-input" value={newSize.productName} onChange={(e) => setNewSize({ ...newSize, productName: e.target.value })} placeholder="e.g., 5x7 Individual Print" />
            </div>
            <button className="btn btn-primary btn-sm" onClick={addSize} style={{ marginBottom: 0 }}>Add</button>
          </div>

          {/* Existing mappings */}
          {sizeMappings.length > 0 ? (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>External ID</th><th>Print Size</th><th>Product Name</th><th>Actions</th></tr></thead>
                <tbody>
                  {sizeMappings.map(m => (
                    <tr key={m.externalId}>
                      <td className="mono" style={{ fontWeight: 600 }}>{m.externalId}</td>
                      <td className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{m.size}</td>
                      <td>{m.productName || '—'}</td>
                      <td><button className="btn btn-sm btn-danger" onClick={() => deleteSize(m.externalId)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No size mappings configured. Products without a mapping will show "0x0" in the txt file.
            </div>
          )}
        </div>
      )}

      {/* ═══ SPECIALTY PRODUCTS ════════════════════════════════ */}
      {activeSection === 'specialty' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Specialty Products</h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Specialty items are excluded from Darkroom txt files and their images are routed to a separate folder organized by product name. They still appear on packing slips (highlighted in yellow) and are sent to ShipStation.
          </p>

          {/* Base path */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 24 }}>
            <div className="form-group" style={{ marginBottom: 0, flex: '1' }}>
              <label className="form-label">Specialty Base Folder</label>
              <input className="form-input" value={specialtyBasePath}
                onChange={(e) => setSpecialtyBasePath(e.target.value)}
                placeholder="e.g., C:\SportslinePhotos\Specialty" />
            </div>
            <button className="btn btn-primary btn-sm" onClick={saveSpecialtyBasePath} style={{ marginBottom: 0 }}>Save Path</button>
          </div>

          {/* Add product */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0, flex: '0 0 120px' }}>
              <label className="form-label">External ID</label>
              <input className="form-input" value={newSpecialty.externalId}
                onChange={(e) => setNewSpecialty({ ...newSpecialty, externalId: e.target.value })}
                placeholder="e.g., 15" />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: '1 1 180px' }}>
              <label className="form-label">Product Name</label>
              <input className="form-input" value={newSpecialty.productName}
                onChange={(e) => setNewSpecialty({ ...newSpecialty, productName: e.target.value })}
                placeholder="e.g., 3x5 Magnet" />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: '1 1 180px' }}>
              <label className="form-label">Subfolder <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(defaults to product name)</span></label>
              <input className="form-input" value={newSpecialty.subfolder}
                onChange={(e) => setNewSpecialty({ ...newSpecialty, subfolder: e.target.value })}
                placeholder={newSpecialty.productName || 'auto'} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={addSpecialty} style={{ marginBottom: 0 }}>Add</button>
          </div>

          {/* Product list */}
          {specialtyProducts.length > 0 ? (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>External ID</th><th>Product Name</th><th>Subfolder</th><th>Full Path</th><th>Actions</th></tr></thead>
                <tbody>
                  {specialtyProducts.map(p => (
                    <tr key={p.externalId}>
                      <td className="mono" style={{ fontWeight: 600 }}>{p.externalId}</td>
                      <td>{p.productName}</td>
                      <td className="mono">{p.subfolder}</td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {specialtyBasePath ? `${specialtyBasePath}\\${p.subfolder}\\` : `Specialty\\${p.subfolder}\\`}
                      </td>
                      <td><button className="btn btn-sm btn-danger" onClick={() => deleteSpecialty(p.externalId)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No specialty products configured. Items added here will be excluded from Darkroom and routed to their own folders.
            </div>
          )}

          {/* Highlight Color Pickers */}
          <div style={{ marginTop: 20, padding: 14, background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>Packing Slip Highlight Colors</div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="color" value={highlightColors.specialty}
                  onChange={async (e) => {
                    const newColors = { ...highlightColors, specialty: e.target.value };
                    setHighlightColors(newColors);
                    try { await api.setHighlightColors(newColors); } catch (err) { /* silent */ }
                  }}
                  style={{ width: 36, height: 36, border: '2px solid #ccc', borderRadius: 6, cursor: 'pointer', padding: 0 }}
                  title="Click to change specialty highlight color"
                />
                <span>Specialty item</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="color" value={highlightColors.quantity}
                  onChange={async (e) => {
                    const newColors = { ...highlightColors, quantity: e.target.value };
                    setHighlightColors(newColors);
                    try { await api.setHighlightColors(newColors); } catch (err) { /* silent */ }
                  }}
                  style={{ width: 36, height: 36, border: '2px solid #ccc', borderRadius: 6, cursor: 'pointer', padding: 0 }}
                  title="Click to change quantity highlight color"
                />
                <span>Quantity &gt; 1</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ FOLDER SORT ════════════════════════════════════ */}
      {activeSection === 'folders' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Folder Sort Hierarchy</h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Configure how downloaded images and txt files are organized into folders. Build a hierarchy by adding sort levels — files will be nested in folders following this order. The txt file always stays in the same folder as its images.
          </p>

          {/* Current hierarchy */}
          <div style={{ marginBottom: 24 }}>
            <label className="form-label" style={{ fontWeight: 700, marginBottom: 12, display: 'block' }}>Current Sort Order</label>
            {folderSortLevels.length === 0 ? (
              <div style={{ padding: 16, background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: 13 }}>
                No sort levels configured. Add levels below to organize your files.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {folderSortLevels.map((levelId, index) => {
                  const option = folderSortOptions.find(o => o.id === levelId);
                  return (
                    <div key={index} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 16px', background: 'var(--bg-input)',
                      borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)',
                    }}>
                      <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', width: 24 }}>{index + 1}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{option?.label || levelId}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{option?.description || ''}</div>
                      </div>
                      <button className="btn btn-sm btn-secondary" onClick={() => moveSortLevel(index, -1)} disabled={index === 0}
                        style={{ padding: '2px 8px', fontSize: 12 }}>↑</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => moveSortLevel(index, 1)} disabled={index === folderSortLevels.length - 1}
                        style={{ padding: '2px 8px', fontSize: 12 }}>↓</button>
                      <button className="btn btn-sm btn-danger" onClick={() => removeSortLevel(index)}
                        style={{ padding: '2px 8px', fontSize: 12 }}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add level buttons */}
          <div style={{ marginBottom: 24 }}>
            <label className="form-label" style={{ fontWeight: 700, marginBottom: 8, display: 'block' }}>Add Sort Level</label>
            {isNoSort && (
              <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 8 }}>
                "No Sort" is active — all other sort levels are disabled. Remove "No Sort" to add sort levels.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {folderSortOptions.map(opt => {
                const isActive = folderSortLevels.includes(opt.id);
                const isDisabled = opt.id === 'no_sort'
                  ? (isNoSort || folderSortLevels.length > 0) && !isNoSort  // Only available when no levels set, or already selected
                  : isActive || isNoSort; // Grey out all others when No Sort is on

                // No Sort is only available as the first selection (when nothing else is selected)
                const noSortDisabled = opt.id === 'no_sort' && folderSortLevels.length > 0 && !isNoSort;

                return (
                  <button
                    key={opt.id}
                    className={`btn btn-sm ${isActive ? 'btn-primary' : isDisabled || noSortDisabled ? 'btn-secondary' : 'btn-primary'}`}
                    onClick={() => addSortLevel(opt.id)}
                    disabled={isDisabled || noSortDisabled}
                    style={{
                      padding: '4px 12px', fontSize: 12,
                      opacity: (isDisabled || noSortDisabled) && !isActive ? 0.4 : 1,
                    }}
                    title={opt.description}
                  >
                    + {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preview */}
          {folderSortLevels.length > 0 && (
            <div style={{
              padding: 14, background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)',
              marginBottom: 20, fontSize: 12, fontFamily: 'monospace',
            }}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontFamily: 'inherit', fontSize: 12 }}>Folder Preview:</div>
              <div style={{ color: 'var(--text-secondary)' }}>
                {`C:\\SportslinePhotos\\`}
                {folderSortLevels.map((level, i) => {
                  const examples = {
                    gallery: 'Test 4', order_id: 'SB1773428567', shipping_type: 'Dropship',
                    shipping_name: 'Ground', studio: 'Sportsline Photography', date: '2026-04-13',
                    no_sort: '',
                  };
                  if (level === 'no_sort') return null;
                  return (
                    <span key={i}>
                      {`${examples[level] || level}\\`}
                    </span>
                  );
                })}
                {folderSortLevels.includes('no_sort') && (
                  <span style={{ color: 'var(--warning)' }}>(all files in root — no subfolders)</span>
                )}
                <br />
                <span style={{ color: 'var(--text-muted)' }}>
                  {'  ├── image1.jpg'}<br />
                  {'  ├── image2.jpg'}<br />
                  {'  └── SB1773428567.txt'}
                </span>
              </div>
            </div>
          )}

          <button className="btn btn-primary" onClick={saveFolderSort}>
            Save Folder Sort
          </button>
        </div>
      )}

      {/* ═══ DARKROOM TEMPLATES ═══════════════════════════════ */}
      {activeSection === 'templates' && (
        <div className="card">
          <div className="card-header"><h3 className="card-title">Darkroom Template Mappings</h3></div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Map product names or External IDs to Darkroom .crd template files.</p>

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0, flex: '1 1 160px' }}>
              <label className="form-label">Product Name</label>
              <input className="form-input" value={newTemplate.productName} onChange={(e) => setNewTemplate({ ...newTemplate, productName: e.target.value })} placeholder="e.g., Memory Mate" />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: '0 0 100px' }}>
              <label className="form-label">External ID</label>
              <input className="form-input" value={newTemplate.externalId} onChange={(e) => setNewTemplate({ ...newTemplate, externalId: e.target.value })} placeholder="e.g., 6" />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: '0 0 80px' }}>
              <label className="form-label">Size</label>
              <input className="form-input" value={newTemplate.size} onChange={(e) => setNewTemplate({ ...newTemplate, size: e.target.value })} placeholder="8x10" />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: '2 1 300px' }}>
              <label className="form-label">Template Path</label>
              <input className="form-input" value={newTemplate.templatePath} onChange={(e) => setNewTemplate({ ...newTemplate, templatePath: e.target.value })} placeholder="X:\Templates\..." />
            </div>
            <button className="btn btn-primary btn-sm" onClick={addTemplate} style={{ marginBottom: 0 }}>Add</button>
          </div>

          {templateMappings.length > 0 ? (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Product</th><th>External ID</th><th>Size</th><th>Template Path</th><th>Actions</th></tr></thead>
                <tbody>
                  {templateMappings.map(m => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600 }}>{m.productName}</td>
                      <td className="mono">{m.externalId || '—'}</td>
                      <td className="mono">{m.size || '—'}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{m.templatePath}</td>
                      <td><button className="btn btn-sm btn-danger" onClick={() => deleteTemplate(m.id)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No template mappings.</div>
          )}
        </div>
      )}

      {/* ═══ FILENAME CONFIG ═════════════════════════════════ */}
      {activeSection === 'filename' && (
        <div className="card" style={{ maxWidth: 500 }}>
          <h3 className="card-title" style={{ marginBottom: 16 }}>Darkroom Filename Config</h3>
          <div className="form-group">
            <label className="form-label">Filename Pattern</label>
            <input className="form-input" value={fileNameConfig.pattern} onChange={(e) => setFileNameConfig({ ...fileNameConfig, pattern: e.target.value })} />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Tokens: {'{order_number}'}, {'{first_name}'}, {'{last_name}'}, {'{gallery}'}, {'{date}'}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Extension</label>
            <input className="form-input" value={fileNameConfig.extension} onChange={(e) => setFileNameConfig({ ...fileNameConfig, extension: e.target.value })} />
          </div>
          <button className="btn btn-primary" onClick={saveFileNameConfig}>Save</button>
        </div>
      )}
    </div>
  );
}
