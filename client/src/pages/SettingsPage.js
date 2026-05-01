import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';

export default function SettingsPage({ user }) {
  const [activeSection, setActiveSection] = useState('imposition');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Users
  const [users, setUsers] = useState([]);
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', displayName: '', role: 'operator' });
  const [editingUserId, setEditingUserId] = useState(null);
  const [editPassword, setEditPassword] = useState('');
  const isAdmin = user?.role === 'admin';

  // My Profile (current user's own settings)
  const [profileDownloadPath, setProfileDownloadPath] = useState(user?.downloadPath || '');
  const [profileDisplayName, setProfileDisplayName] = useState(user?.displayName || '');
  const [profilePassword, setProfilePassword] = useState('');
  const [profileSavedPath, setProfileSavedPath] = useState(user?.downloadPath || '');
  useEffect(() => {
    setProfileDownloadPath(user?.downloadPath || '');
    setProfileSavedPath(user?.downloadPath || '');
    setProfileDisplayName(user?.displayName || '');
  }, [user?.downloadPath, user?.displayName]);

  // Imposition
  const [layouts, setLayouts] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [textVariables, setTextVariables] = useState([]);
  const [editingLayout, setEditingLayout] = useState(null);
  const [showLayoutForm, setShowLayoutForm] = useState(false);
  const [newMapping, setNewMapping] = useState({ externalId: '', layoutId: '', orientation: '' });
  // Inline-edit state for an existing mapping. Keyed by `${externalId}__${orientation || 'any'}`
  // so we know which row is in edit mode and what its working values are.
  const [editingMapping, setEditingMapping] = useState(null);
  // editingMapping shape: { key, externalId, oldOrientation, layoutId, orientation }

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
  const [newSpecialty, setNewSpecialty] = useState({ externalId: '', productName: '', subfolder: '', dropShipped: false });
  const [highlightColors, setHighlightColors] = useState({ specialty: '#FFF3CD', quantity: '#D4EDDA' });

  // Path settings
  const [pathSettings, setPathSettings] = useState({ downloadBase: '', darkroomTemplateBase: '', txtOutput: '' });

  // App settings (env overrides)
  const [appSettingsData, setAppSettingsData] = useState({});
  const [appSettingsFields, setAppSettingsFields] = useState([]);
  const [appSettingsForm, setAppSettingsForm] = useState({});
  const [showSecrets, setShowSecrets] = useState({});

  // Packaging config
  const [packagingConfig, setPackagingConfig] = useState(null);
  const [newWeight, setNewWeight] = useState({ externalId: '', weight: '', name: '', category: 'flat' });
  const [packagingTestOrder, setPackagingTestOrder] = useState('');
  const [packagingTestResult, setPackagingTestResult] = useState(null);

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

  const loadPaths = useCallback(async () => {
    try {
      const data = await api.getPathSettings();
      // Use raw overrides only — keeps variables like {date} intact in the input fields
      setPathSettings({
        downloadBase: data.overrides?.downloadBase || '',
        darkroomTemplateBase: data.overrides?.darkroomTemplateBase || '',
        txtOutput: data.overrides?.txtOutput || '',
      });
    } catch (err) { /* silent */ }
  }, []);

  const loadAppSettings = useCallback(async () => {
    try {
      const data = await api.getAppSettings();
      setAppSettingsData(data.settings || {});
      setAppSettingsFields(data.fields || []);
      // Initialize form with current values
      const form = {};
      for (const [key, setting] of Object.entries(data.settings || {})) {
        form[key] = setting.value || '';
      }
      setAppSettingsForm(form);
    } catch (err) { /* silent */ }
  }, []);

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await api.getUsers();
      setUsers(data.users || []);
    } catch (err) { /* silent */ }
  }, [isAdmin]);

  const loadPackaging = useCallback(async () => {
    try {
      const data = await api._fetch('/settings/packaging');
      setPackagingConfig(data);
    } catch (err) { /* silent */ }
  }, []);

  useEffect(() => { loadImposition(); loadTemplates(); loadSizeMappings(); loadFileNameConfig(); loadFolderSort(); loadSpecialty(); loadPaths(); loadAppSettings(); loadUsers(); loadPackaging(); }, [loadImposition, loadTemplates, loadSizeMappings, loadFileNameConfig, loadFolderSort, loadSpecialty, loadPaths, loadAppSettings, loadUsers, loadPackaging]);

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
    if (!newMapping.externalId || !newMapping.layoutId) { setError('External ID and Layout are required'); return; }
    clearMessages();
    try {
      // Empty string = "any orientation"; pass null in that case so backend treats it as agnostic
      const orientation = newMapping.orientation || null;
      await api.addImpositionMapping(newMapping.externalId, newMapping.layoutId, orientation);
      setNewMapping({ externalId: '', layoutId: '', orientation: '' });
      setSuccess('Mapping added');
      await loadImposition();
    }
    catch (err) { setError(err.message); }
  };

  const deleteMappingHandler = async (externalId, orientation = null) => {
    clearMessages();
    try { await api.deleteImpositionMapping(externalId, orientation); setSuccess('Mapping removed'); await loadImposition(); }
    catch (err) { setError(err.message); }
  };

  const startEditMapping = (mapping) => {
    clearMessages();
    setEditingMapping({
      key: `${mapping.externalId}__${mapping.orientation || 'any'}`,
      externalId: mapping.externalId,
      oldOrientation: mapping.orientation || null,
      layoutId: mapping.layoutId,
      orientation: mapping.orientation || '',
    });
  };

  const cancelEditMapping = () => {
    setEditingMapping(null);
    clearMessages();
  };

  const saveEditMapping = async () => {
    if (!editingMapping) return;
    if (!editingMapping.layoutId) { setError('Layout is required'); return; }
    clearMessages();
    try {
      await api.updateImpositionMapping(
        editingMapping.externalId,
        editingMapping.oldOrientation,
        {
          layoutId: editingMapping.layoutId,
          orientation: editingMapping.orientation || null,
        }
      );
      setEditingMapping(null);
      setSuccess('Mapping updated');
      await loadImposition();
    } catch (err) {
      setError(err.message);
    }
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

  // ─── Path Settings ──────────────────────────────────────
  const savePathSettings = async () => {
    clearMessages();
    try {
      const result = await api.updatePathSettings(pathSettings);
      // Keep using the raw values we just saved (with variables intact)
      // Don't replace with the resolved values from the response
      setSuccess('Path settings saved');
    } catch (err) { setError(err.message); }
  };

  // ─── App Settings ───────────────────────────────────────
  const saveAppSettings = async () => {
    clearMessages();
    setLoading(true);
    try {
      const result = await api.updateAppSettings(appSettingsForm);
      setAppSettingsData(result.settings || {});
      // Update form with new masked values
      const form = {};
      for (const [key, setting] of Object.entries(result.settings || {})) {
        form[key] = setting.value || '';
      }
      setAppSettingsForm(form);
      setShowSecrets({});
      setSuccess('Configuration saved. Some changes may require a server restart.');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
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
      setNewSpecialty({ externalId: '', productName: '', subfolder: '', dropShipped: false });
      setSuccess('Specialty product added');
      await loadSpecialty();
    } catch (err) { setError(err.message); }
  };

  const toggleDropShipped = async (externalId, dropShipped) => {
    clearMessages();
    try {
      await api.updateSpecialtyProduct(externalId, { dropShipped });
      setSuccess(dropShipped ? 'Marked drop-shipped — ShipStation will skip this item' : 'Drop-ship flag cleared');
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
        <button className={`tab ${activeSection === 'paths' ? 'active' : ''}`} onClick={() => setActiveSection('paths')}>Paths</button>
        <button className={`tab ${activeSection === 'packaging' ? 'active' : ''}`} onClick={() => setActiveSection('packaging')}>Packaging</button>
        {user && <button className={`tab ${activeSection === 'profile' ? 'active' : ''}`} onClick={() => setActiveSection('profile')}>My Profile</button>}
        {isAdmin && <button className={`tab ${activeSection === 'setup' ? 'active' : ''}`} onClick={() => setActiveSection('setup')}>Setup</button>}
        {isAdmin && <button className={`tab ${activeSection === 'users' ? 'active' : ''}`} onClick={() => setActiveSection('users')}>Users</button>}
      </div>

      {/* ═══ IMPOSITION ══════════════════════════════════════ */}
      {activeSection === 'imposition' && (
        <div>
          {/* Layout list */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <h3 className="card-title">Print Layouts</h3>
              <button className="btn btn-primary btn-sm" onClick={() => {
                setLayoutForm({ ...emptyLayout }); setEditingLayout(null); setShowLayoutForm(true);
                setTimeout(() => document.getElementById('layout-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
              }}>
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
            <div id="layout-form" className="card" style={{ marginBottom: 24, border: '2px solid var(--accent)' }}>
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
                            <label className="form-label" style={{ fontSize: 10 }}>W (")</label>
                            <input className="form-input" type="number" step="0.1" value={overlay.width || ''} onChange={(e) => updateTextOverlay(i, 'width', parseFloat(e.target.value) || 0)}
                              placeholder="auto" style={{ fontSize: 11 }} />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0, flex: '1' }}>
                            <label className="form-label" style={{ fontSize: 10 }}>H (")</label>
                            <input className="form-input" type="number" step="0.1" value={overlay.height || ''} onChange={(e) => updateTextOverlay(i, 'height', parseFloat(e.target.value) || 0)}
                              placeholder="auto" style={{ fontSize: 11 }} />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0, flex: '1' }}>
                            <label className="form-label" style={{ fontSize: 10 }}>Size (pt)</label>
                            <input className="form-input" type="number" min="4" max="200" value={overlay.fontSize} onChange={(e) => updateTextOverlay(i, 'fontSize', parseInt(e.target.value) || 10)}
                              disabled={overlay.autoSize} style={{ fontSize: 11, opacity: overlay.autoSize ? 0.5 : 1 }} />
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
                        <div style={{ display: 'flex', gap: 16, marginTop: 6, alignItems: 'center' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, cursor: 'pointer' }}>
                            <input type="checkbox" checked={overlay.autoSize || false}
                              onChange={(e) => updateTextOverlay(i, 'autoSize', e.target.checked)} />
                            Auto-size to fit
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, cursor: 'pointer' }}>
                            <input type="checkbox" checked={overlay.centerAlign || false}
                              onChange={(e) => updateTextOverlay(i, 'centerAlign', e.target.checked)} />
                            Center align
                          </label>
                          {overlay.autoSize && !overlay.width && (
                            <span style={{ fontSize: 9, color: 'var(--warning)' }}>Set W and H for auto-size to work</span>
                          )}
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
              Map a product's External ID to an imposition layout. Optionally, set a different layout per orientation — when an order comes in, the matching orientation's layout is used. "Any" applies to both vertical and horizontal images.
            </p>

            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0, flex: '0 0 120px' }}>
                <label className="form-label">External ID</label>
                <input className="form-input" value={newMapping.externalId} onChange={(e) => setNewMapping({ ...newMapping, externalId: e.target.value })} placeholder="e.g., 12" />
              </div>
              <div className="form-group" style={{ marginBottom: 0, flex: '0 0 130px' }}>
                <label className="form-label">Orientation</label>
                <select className="form-select" value={newMapping.orientation} onChange={(e) => setNewMapping({ ...newMapping, orientation: e.target.value })}>
                  <option value="">Any</option>
                  <option value="vertical">Vertical</option>
                  <option value="horizontal">Horizontal</option>
                </select>
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
                  <thead><tr><th>External ID</th><th>Orientation</th><th>Layout</th><th>Actions</th></tr></thead>
                  <tbody>
                    {mappings.map(m => {
                      const rowKey = `${m.externalId}__${m.orientation || 'any'}`;
                      const isEditing = editingMapping && editingMapping.key === rowKey;
                      if (isEditing) {
                        return (
                          <tr key={rowKey}>
                            <td className="mono" style={{ fontWeight: 600 }}>{m.externalId}</td>
                            <td>
                              <select
                                className="form-select"
                                value={editingMapping.orientation}
                                onChange={(e) => setEditingMapping({ ...editingMapping, orientation: e.target.value })}
                                style={{ minWidth: 110 }}
                              >
                                <option value="">Any</option>
                                <option value="vertical">Vertical</option>
                                <option value="horizontal">Horizontal</option>
                              </select>
                            </td>
                            <td>
                              <select
                                className="form-select"
                                value={editingMapping.layoutId}
                                onChange={(e) => setEditingMapping({ ...editingMapping, layoutId: e.target.value })}
                              >
                                <option value="">Select a layout...</option>
                                {layouts.map(l => (
                                  <option key={l.id} value={l.id}>{l.name} ({l.cols}×{l.rows} on {l.sheetWidth}"×{l.sheetHeight}")</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <button className="btn btn-sm btn-primary" onClick={saveEditMapping} style={{ marginRight: 4 }}>Save</button>
                              <button className="btn btn-sm" onClick={cancelEditMapping}>Cancel</button>
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={rowKey}>
                          <td className="mono" style={{ fontWeight: 600 }}>{m.externalId}</td>
                          <td style={{ textTransform: 'capitalize', color: m.orientation ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {m.orientation || 'any'}
                          </td>
                          <td>{m.layoutName}</td>
                          <td>
                            <button className="btn btn-sm" onClick={() => startEditMapping(m)} style={{ marginRight: 4 }}>Edit</button>
                            <button className="btn btn-sm btn-danger" onClick={() => deleteMappingHandler(m.externalId, m.orientation)}>Remove</button>
                          </td>
                        </tr>
                      );
                    })}
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
            <div className="form-group" style={{ marginBottom: 0, flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingBottom: 8, cursor: 'pointer' }}
                title="Check if this product is drop-shipped from another lab. ShipStation labels will be skipped for this item.">
                <input type="checkbox" checked={!!newSpecialty.dropShipped}
                  onChange={(e) => setNewSpecialty({ ...newSpecialty, dropShipped: e.target.checked })} />
                Drop-shipped
              </label>
            </div>
            <button className="btn btn-primary btn-sm" onClick={addSpecialty} style={{ marginBottom: 0 }}>Add</button>
          </div>

          {/* Product list */}
          {specialtyProducts.length > 0 ? (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>External ID</th><th>Product Name</th><th>Subfolder</th><th>Full Path</th><th>Drop-Shipped</th><th>Actions</th></tr></thead>
                <tbody>
                  {specialtyProducts.map(p => (
                    <tr key={p.externalId}>
                      <td className="mono" style={{ fontWeight: 600 }}>{p.externalId}</td>
                      <td>{p.productName}</td>
                      <td className="mono">{p.subfolder}</td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {specialtyBasePath ? `${specialtyBasePath}\\${p.subfolder}\\` : `Specialty\\${p.subfolder}\\`}
                      </td>
                      <td>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}
                          title="When checked, ShipStation labels are skipped for this item — another lab fulfills it.">
                          <input type="checkbox" checked={!!p.dropShipped}
                            onChange={(e) => toggleDropShipped(p.externalId, e.target.checked)} />
                          {p.dropShipped ? <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Yes</span> : <span style={{ color: 'var(--text-muted)' }}>No</span>}
                        </label>
                      </td>
                      <td><button className="btn btn-sm btn-danger" onClick={() => deleteSpecialty(p.externalId)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No specialty products configured. Items added here will be excluded from Darkroom and routed to their own folders. Check "Drop-Shipped" on items fulfilled by another lab to also skip ShipStation label creation.
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
      {/* ═══ PATHS ═══════════════════════════════════════════ */}
      {activeSection === 'paths' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">File Paths</h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Configure where processed files are saved. These override the .env file values. Leave blank to use the .env defaults. You can use variables like {'{date}'} to create dynamic folder structures.
          </p>

          {/* Available variables */}
          <div style={{ marginBottom: 20, padding: 12, background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Available Variables</div>
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>Date Variables</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { token: '{date}', desc: 'YYYY-MM-DD' },
                  { token: '{year}', desc: 'Year' },
                  { token: '{month}', desc: 'Month (01-12)' },
                  { token: '{day}', desc: 'Day (01-31)' },
                  { token: '{month_name}', desc: 'Month name' },
                  { token: '{day_of_week}', desc: 'Day name' },
                ].map(v => (
                  <span key={v.token} style={{
                    padding: '3px 8px', borderRadius: 'var(--radius-sm)', fontSize: 11,
                    background: 'var(--accent)', color: '#fff', cursor: 'default',
                  }} title={v.desc}>
                    {v.token}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>Order Variables (resolved per order)</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { token: '{gallery}', desc: 'Gallery name from the order' },
                  { token: '{order_id}', desc: 'Order number' },
                  { token: '{studio}', desc: 'Studio name' },
                ].map(v => (
                  <span key={v.token} style={{
                    padding: '3px 8px', borderRadius: 'var(--radius-sm)', fontSize: 11,
                    background: '#50c878', color: '#fff', cursor: 'default',
                  }} title={v.desc}>
                    {v.token}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Download Base Path</label>
            <input className="form-input" value={pathSettings.downloadBase}
              onChange={(e) => setPathSettings({ ...pathSettings, downloadBase: e.target.value })}
              placeholder="e.g., C:\SportslinePhotos\{date}" />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Root folder where all order images, txt files, and packing slips are saved.
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Darkroom Template Base Path</label>
            <input className="form-input" value={pathSettings.darkroomTemplateBase}
              onChange={(e) => setPathSettings({ ...pathSettings, darkroomTemplateBase: e.target.value })}
              placeholder="e.g., X:\Templates\Borders\sportsline borders" />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Base folder for Darkroom .crd template files.
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">TXT Output Path</label>
            <input className="form-input" value={pathSettings.txtOutput}
              onChange={(e) => setPathSettings({ ...pathSettings, txtOutput: e.target.value })}
              placeholder="e.g., C:\SportslinePhotos\Orders" />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Fallback folder for Darkroom txt files (used only if order folder sort is not configured).
            </div>
          </div>

          {/* Live resolved preview */}
          {(pathSettings.downloadBase || pathSettings.darkroomTemplateBase || pathSettings.txtOutput) && (
            <div style={{ marginBottom: 20, padding: 14, background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Resolved Preview (example order)</div>
              {(() => {
                const now = new Date();
                const yyyy = now.getFullYear().toString();
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                const dd = String(now.getDate()).padStart(2, '0');
                const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
                const resolve = (s) => s ? s
                  .replace(/\{date\}/g, `${yyyy}-${mm}-${dd}`)
                  .replace(/\{year\}/g, yyyy)
                  .replace(/\{month\}/g, mm)
                  .replace(/\{day\}/g, dd)
                  .replace(/\{month_name\}/g, monthNames[now.getMonth()])
                  .replace(/\{day_of_week\}/g, dayNames[now.getDay()])
                  .replace(/\{gallery\}/g, 'Spring Sports 2026')
                  .replace(/\{order_id\}/g, 'SB1773428567')
                  .replace(/\{studio\}/g, 'Sportsline Photography')
                  : '';
                return (
                  <div style={{ fontFamily: 'monospace', fontSize: 11, lineHeight: 1.8 }}>
                    {pathSettings.downloadBase && (
                      <div><span style={{ color: 'var(--text-muted)' }}>Download:</span> <span style={{ color: 'var(--accent)' }}>{resolve(pathSettings.downloadBase)}</span></div>
                    )}
                    {pathSettings.darkroomTemplateBase && (
                      <div><span style={{ color: 'var(--text-muted)' }}>Templates:</span> <span style={{ color: 'var(--accent)' }}>{resolve(pathSettings.darkroomTemplateBase)}</span></div>
                    )}
                    {pathSettings.txtOutput && (
                      <div><span style={{ color: 'var(--text-muted)' }}>TXT Output:</span> <span style={{ color: 'var(--accent)' }}>{resolve(pathSettings.txtOutput)}</span></div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>
                      Using example: gallery="Spring Sports 2026", order="SB1773428567"
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <button className="btn btn-primary" onClick={savePathSettings}>
            Save Path Settings
          </button>
        </div>
      )}

      {/* ═══ MY PROFILE ═════════════════════════════════════════ */}
      {activeSection === 'profile' && user && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">My Profile</h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            These settings apply only to you ({user.username}). When you process orders, files will be saved to your personal download path instead of the shared path. Other users are not affected.
          </p>

          <div style={{ marginBottom: 20, padding: 12, background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Currently active path:</strong>{' '}
            {profileSavedPath
              ? <span className="mono" style={{ color: 'var(--accent)' }}>{profileSavedPath}</span>
              : <span>Using shared/global path (no personal override)</span>}
          </div>

          <div className="form-group">
            <label className="form-label">My Download Base Path</label>
            <input
              className="form-input mono"
              type="text"
              value={profileDownloadPath}
              onChange={(e) => setProfileDownloadPath(e.target.value)}
              placeholder="e.g. C:\Users\Joey\PrintQueue or leave blank to use shared path"
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Supports the same variables as the shared Paths section ({'{date}'}, {'{gallery}'}, {'{order_id}'}, {'{studio}'}, etc.). Leave blank to fall back to the shared path.
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input
              className="form-input"
              type="text"
              value={profileDisplayName}
              onChange={(e) => setProfileDisplayName(e.target.value)}
              placeholder={user.username}
            />
          </div>

          <div className="form-group">
            <label className="form-label">New Password</label>
            <input
              className="form-input"
              type="password"
              value={profilePassword}
              onChange={(e) => setProfilePassword(e.target.value)}
              placeholder="Leave blank to keep current password"
              autoComplete="new-password"
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              disabled={loading}
              onClick={async () => {
                setLoading(true); setError(null); setSuccess(null);
                try {
                  const updates = {};
                  if (profileDownloadPath !== (user.downloadPath || '')) {
                    updates.downloadPath = profileDownloadPath; // empty string clears it
                  }
                  if (profileDisplayName !== (user.displayName || '')) {
                    updates.displayName = profileDisplayName;
                  }
                  if (profilePassword) {
                    updates.password = profilePassword;
                  }
                  if (Object.keys(updates).length === 0) {
                    setError('No changes to save');
                  } else {
                    const result = await api.updateProfile(updates);
                    setSuccess('Profile updated. Changes apply on your next order processing.');
                    setProfilePassword('');
                    if (result?.user?.downloadPath !== undefined) {
                      setProfileSavedPath(result.user.downloadPath || '');
                    }
                  }
                } catch (e) {
                  setError(e.message);
                } finally {
                  setLoading(false);
                }
              }}
            >
              Save Profile
            </button>
            {profileSavedPath && (
              <button
                className="btn btn-secondary"
                disabled={loading}
                onClick={async () => {
                  if (!window.confirm('Clear your personal download path? You will fall back to the shared path.')) return;
                  setLoading(true); setError(null); setSuccess(null);
                  try {
                    await api.updateProfile({ downloadPath: '' });
                    setProfileDownloadPath('');
                    setProfileSavedPath('');
                    setSuccess('Personal path cleared. Now using shared path.');
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Clear My Path
              </button>
            )}
          </div>
        </div>
      )}

      {/* ═══ SETUP (env overrides) ══════════════════════════════ */}
      {activeSection === 'packaging' && (
        <div>
          <h2 style={{ marginBottom: 16 }}>Packaging Rules Engine</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
            Configure product weights and packaging rules to auto-set ShipStation dimensions, weight, and service type.
          </p>

          {/* Test Packaging */}
          <div className="card" style={{ marginBottom: 20 }}>
            <h3>Test Packaging</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Enter an order number to see what packaging the engine would determine.</p>
            <div className="form-row" style={{ gap: 8 }}>
              <input className="form-input" placeholder="Order number" value={packagingTestOrder}
                onChange={e => setPackagingTestOrder(e.target.value)} style={{ maxWidth: 200 }} />
              <button className="btn btn-primary" disabled={!packagingTestOrder || loading} onClick={async () => {
                setLoading(true); setPackagingTestResult(null);
                try {
                  const result = await api._fetch(`/settings/packaging/test/${packagingTestOrder}`, { method: 'POST' });
                  setPackagingTestResult(result);
                } catch (err) { setError(err.message); }
                finally { setLoading(false); }
              }}>Test</button>
            </div>
            {packagingTestResult && (
              <div style={{ marginTop: 12, padding: 12, background: 'rgba(76,175,80,0.1)', borderRadius: 'var(--radius-md)', fontSize: 13 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{packagingTestResult.packageTypeName}</div>
                <div>Dimensions: {packagingTestResult.dimensions?.length}×{packagingTestResult.dimensions?.width}×{packagingTestResult.dimensions?.height}"</div>
                <div>Weight: {packagingTestResult.weight?.value}oz</div>
                <div>Carrier: {packagingTestResult.carrierCode} / {packagingTestResult.serviceCode} / {packagingTestResult.packageCode}</div>
                {packagingTestResult.notes?.length > 0 && (
                  <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 11 }}>
                    {packagingTestResult.notes.map((n, i) => <div key={i}>• {n}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Product Weights */}
          <div className="card" style={{ marginBottom: 20 }}>
            <h3>Product Weights</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Set the weight (in ounces) and category for each product SKU.</p>

            {packagingConfig && (
              <table className="data-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr><th>SKU</th><th>Product Name</th><th>Weight (oz)</th><th>Category</th><th></th></tr>
                </thead>
                <tbody>
                  {Object.entries(packagingConfig.productWeights || {}).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([sku, data]) => (
                    <tr key={sku}>
                      <td style={{ fontWeight: 600 }}>{sku}</td>
                      <td>{data.name}</td>
                      <td>
                        <input className="form-input" type="number" step="0.1" value={data.weight}
                          style={{ width: 70, fontSize: 12, padding: '2px 6px' }}
                          onChange={async (e) => {
                            try {
                              await api._fetch(`/settings/packaging/weights/${sku}`, {
                                method: 'PUT', body: JSON.stringify({ ...data, weight: parseFloat(e.target.value) || 0 }),
                              });
                              loadPackaging();
                            } catch (err) { setError(err.message); }
                          }} />
                      </td>
                      <td>
                        <select className="form-input" value={data.category}
                          style={{ width: 100, fontSize: 12, padding: '2px 6px' }}
                          onChange={async (e) => {
                            try {
                              await api._fetch(`/settings/packaging/weights/${sku}`, {
                                method: 'PUT', body: JSON.stringify({ ...data, category: e.target.value }),
                              });
                              loadPackaging();
                            } catch (err) { setError(err.message); }
                          }}>
                          <option value="flat">Flat</option>
                          <option value="rigid">Rigid</option>
                          <option value="bulky">Bulky</option>
                          <option value="pano">Pano</option>
                          <option value="digital">Digital</option>
                        </select>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-danger" onClick={async () => {
                          if (!window.confirm(`Delete weight for SKU ${sku}?`)) return;
                          try {
                            await api._fetch(`/settings/packaging/weights/${sku}`, { method: 'DELETE' });
                            loadPackaging();
                          } catch (err) { setError(err.message); }
                        }}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Add new weight */}
            <div className="form-row" style={{ gap: 8, marginTop: 12 }}>
              <input className="form-input" placeholder="SKU" value={newWeight.externalId}
                onChange={e => setNewWeight(p => ({ ...p, externalId: e.target.value }))} style={{ width: 70 }} />
              <input className="form-input" placeholder="Product Name" value={newWeight.name}
                onChange={e => setNewWeight(p => ({ ...p, name: e.target.value }))} style={{ flex: 1 }} />
              <input className="form-input" type="number" step="0.1" placeholder="oz" value={newWeight.weight}
                onChange={e => setNewWeight(p => ({ ...p, weight: e.target.value }))} style={{ width: 70 }} />
              <select className="form-input" value={newWeight.category}
                onChange={e => setNewWeight(p => ({ ...p, category: e.target.value }))} style={{ width: 100 }}>
                <option value="flat">Flat</option>
                <option value="rigid">Rigid</option>
                <option value="bulky">Bulky</option>
                <option value="pano">Pano</option>
                <option value="digital">Digital</option>
              </select>
              <button className="btn btn-primary" disabled={!newWeight.externalId} onClick={async () => {
                try {
                  await api._fetch(`/settings/packaging/weights/${newWeight.externalId}`, {
                    method: 'PUT', body: JSON.stringify(newWeight),
                  });
                  setNewWeight({ externalId: '', weight: '', name: '', category: 'flat' });
                  loadPackaging();
                  setSuccess('Product weight added');
                } catch (err) { setError(err.message); }
              }}>Add</button>
            </div>
          </div>

          {/* Packaging Types */}
          <div className="card" style={{ marginBottom: 20 }}>
            <h3>Packaging Types</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Package dimensions and base weights for each container type.</p>

            {packagingConfig && (
              <table className="data-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr><th>Package</th><th>L"</th><th>W"</th><th>H"</th><th>Base Wt (oz)</th><th>Service</th></tr>
                </thead>
                <tbody>
                  {Object.entries(packagingConfig.packagingTypes || {}).map(([id, pkg]) => (
                    <tr key={id}>
                      <td style={{ fontWeight: 600 }}>{pkg.name}</td>
                      <td>
                        <input className="form-input" type="number" step="0.5" value={pkg.length}
                          style={{ width: 50, fontSize: 12, padding: '2px 4px' }}
                          onChange={async (e) => {
                            const updated = { ...packagingConfig.packagingTypes, [id]: { ...pkg, length: parseFloat(e.target.value) || 0 } };
                            try {
                              await api._fetch('/settings/packaging', { method: 'PUT', body: JSON.stringify({ packagingTypes: updated }) });
                              loadPackaging();
                            } catch (err) { setError(err.message); }
                          }} />
                      </td>
                      <td>
                        <input className="form-input" type="number" step="0.5" value={pkg.width}
                          style={{ width: 50, fontSize: 12, padding: '2px 4px' }}
                          onChange={async (e) => {
                            const updated = { ...packagingConfig.packagingTypes, [id]: { ...pkg, width: parseFloat(e.target.value) || 0 } };
                            try {
                              await api._fetch('/settings/packaging', { method: 'PUT', body: JSON.stringify({ packagingTypes: updated }) });
                              loadPackaging();
                            } catch (err) { setError(err.message); }
                          }} />
                      </td>
                      <td>
                        <input className="form-input" type="number" step="0.5" value={pkg.height}
                          style={{ width: 50, fontSize: 12, padding: '2px 4px' }}
                          onChange={async (e) => {
                            const updated = { ...packagingConfig.packagingTypes, [id]: { ...pkg, height: parseFloat(e.target.value) || 0 } };
                            try {
                              await api._fetch('/settings/packaging', { method: 'PUT', body: JSON.stringify({ packagingTypes: updated }) });
                              loadPackaging();
                            } catch (err) { setError(err.message); }
                          }} />
                      </td>
                      <td>
                        <input className="form-input" type="number" step="1" value={pkg.baseWeight}
                          style={{ width: 50, fontSize: 12, padding: '2px 4px' }}
                          onChange={async (e) => {
                            const updated = { ...packagingConfig.packagingTypes, [id]: { ...pkg, baseWeight: parseFloat(e.target.value) || 0 } };
                            try {
                              await api._fetch('/settings/packaging', { method: 'PUT', body: JSON.stringify({ packagingTypes: updated }) });
                              loadPackaging();
                            } catch (err) { setError(err.message); }
                          }} />
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pkg.service}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Force Package SKUs */}
          <div className="card" style={{ marginBottom: 20 }}>
            <h3>Force Package Service SKUs</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Items with these SKUs force USPS Package service instead of Large Flat Mailer.
            </p>
            {packagingConfig && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {(packagingConfig.forcePackageSKUs || []).map(sku => (
                  <span key={sku} style={{
                    padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                    background: 'rgba(232,140,48,0.15)', color: '#e88c30', fontWeight: 600, fontSize: 12,
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    {sku} ({packagingConfig.productWeights?.[sku]?.name || '?'})
                    <button style={{ background: 'none', border: 'none', color: '#e88c30', cursor: 'pointer', fontSize: 14, padding: 0 }}
                      onClick={async () => {
                        const updated = (packagingConfig.forcePackageSKUs || []).filter(s => s !== sku);
                        try {
                          await api._fetch('/settings/packaging', { method: 'PUT', body: JSON.stringify({ forcePackageSKUs: updated }) });
                          loadPackaging();
                        } catch (err) { setError(err.message); }
                      }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="form-row" style={{ gap: 8 }}>
              <input className="form-input" placeholder="SKU to add" id="addForcePkgSku" style={{ width: 100 }} />
              <button className="btn btn-sm btn-primary" onClick={async () => {
                const input = document.getElementById('addForcePkgSku');
                const sku = input.value.trim();
                if (!sku) return;
                const updated = [...(packagingConfig?.forcePackageSKUs || []), sku];
                try {
                  await api._fetch('/settings/packaging', { method: 'PUT', body: JSON.stringify({ forcePackageSKUs: updated }) });
                  input.value = '';
                  loadPackaging();
                } catch (err) { setError(err.message); }
              }}>Add SKU</button>
            </div>
          </div>

          {/* Magnet Threshold */}
          <div className="card" style={{ marginBottom: 20 }}>
            <h3>Magnet Threshold</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Combined count across all listed Magnet SKUs. When the total count of items with these SKUs reaches the threshold, the order ships as a Package instead of a Flat envelope.
            </p>
            {packagingConfig && (() => {
              const rule = packagingConfig.magnetThreshold || { skus: ['15'], threshold: 3 };
              const skuList = Array.isArray(rule.skus) ? rule.skus : [];
              const skuText = skuList.join(', ');

              const saveRule = async (newRule) => {
                try {
                  await api._fetch('/settings/packaging', {
                    method: 'PUT',
                    body: JSON.stringify({ magnetThreshold: newRule }),
                  });
                  loadPackaging();
                } catch (err) { setError(err.message); }
              };

              return (
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ marginBottom: 0, flex: '1 1 280px' }}>
                    <label className="form-label" style={{ fontSize: 13 }}>Magnet SKUs (comma-separated)</label>
                    <input
                      className="form-input mono"
                      defaultValue={skuText}
                      placeholder="e.g., 15, 17"
                      onBlur={(e) => {
                        const newSkus = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                        if (newSkus.join(',') !== skuList.join(',')) {
                          saveRule({ skus: newSkus, threshold: rule.threshold });
                        }
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0, flex: '0 0 120px' }}>
                    <label className="form-label" style={{ fontSize: 13 }}>Threshold</label>
                    <input
                      className="form-input"
                      type="number"
                      min="1"
                      defaultValue={rule.threshold || 3}
                      onBlur={(e) => {
                        const n = parseInt(e.target.value, 10) || 3;
                        if (n !== rule.threshold) saveRule({ skus: skuList, threshold: n });
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'flex-end', paddingBottom: 8 }}>
                    or more sets total
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Framed Pano SKUs */}
          <div className="card" style={{ marginBottom: 20 }}>
            <h3>Framed Pano SKUs</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              SKUs for framed panoramics that trigger special packaging (e.g., 26x10x2 or 31x11x2).
            </p>
            {packagingConfig && (
              <div>
                <div className="form-row" style={{ gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 13, minWidth: 160 }}>8x24 Framed Pano SKUs:</label>
                  <input className="form-input" defaultValue={(packagingConfig.framedPanoSmallSKUs || []).join(', ')}
                    key={'fps-' + (packagingConfig.framedPanoSmallSKUs || []).join(',')}
                    placeholder="e.g. 34, 38" style={{ flex: 1 }}
                    onBlur={async (e) => {
                      const skus = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      try {
                        await api._fetch('/settings/packaging', { method: 'PUT', body: JSON.stringify({ framedPanoSmallSKUs: skus }) });
                        loadPackaging();
                      } catch (err) { setError(err.message); }
                    }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>→ 26×10×2</span>
                </div>
                <div className="form-row" style={{ gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 13, minWidth: 160 }}>10x30 Framed Pano SKUs:</label>
                  <input className="form-input" defaultValue={(packagingConfig.framedPanoLargeSKUs || []).join(', ')}
                    key={'fpl-' + (packagingConfig.framedPanoLargeSKUs || []).join(',')}
                    placeholder="e.g. 37, 39" style={{ flex: 1 }}
                    onBlur={async (e) => {
                      const skus = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      try {
                        await api._fetch('/settings/packaging', { method: 'PUT', body: JSON.stringify({ framedPanoLargeSKUs: skus }) });
                        loadPackaging();
                      } catch (err) { setError(err.message); }
                    }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>→ 31×11×2</span>
                </div>
              </div>
            )}
          </div>

          {/* Box Route SKUs */}
          <div className="card" style={{ marginBottom: 20 }}>
            <h3>Box Route SKUs</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              SKUs that should ship in a Medium Box rather than a flat mailer. Use for plaques, canvas wraps, framed prints, mouse pads, or any rigid product that won't survive an envelope. SKUs 21 and 22 are already handled by a hardcoded plaque rule and don't need to be added here.
            </p>
            {packagingConfig && (
              <div className="form-row" style={{ gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 13, minWidth: 160 }}>Box-route SKUs:</label>
                <input className="form-input" defaultValue={(packagingConfig.boxRouteSKUs || []).join(', ')}
                  key={'brs-' + (packagingConfig.boxRouteSKUs || []).join(',')}
                  placeholder="e.g. 31, 36" style={{ flex: 1 }}
                  onBlur={async (e) => {
                    const skus = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                    try {
                      await api._fetch('/settings/packaging', { method: 'PUT', body: JSON.stringify({ boxRouteSKUs: skus }) });
                      loadPackaging();
                    } catch (err) { setError(err.message); }
                  }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>→ Medium Box</span>
              </div>
            )}
          </div>

          {/* Package Bundles */}
          <div className="card" style={{ marginBottom: 20 }}>
            <h3>Package Bundles</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Multi-product packages with a combined weight. "Force Package" means the bundle contains rigid items.
            </p>
            {packagingConfig && (
              <table className="data-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr><th>SKU</th><th>Name</th><th>Weight (oz)</th><th>Force Package</th></tr>
                </thead>
                <tbody>
                  {Object.entries(packagingConfig.packageBundles || {}).map(([sku, data]) => (
                    <tr key={sku}>
                      <td style={{ fontWeight: 600 }}>{sku}</td>
                      <td>{data.name}</td>
                      <td>
                        <input className="form-input" type="number" step="0.5" value={data.weight}
                          style={{ width: 70, fontSize: 12, padding: '2px 6px' }}
                          onChange={async (e) => {
                            const updated = { ...packagingConfig.packageBundles, [sku]: { ...data, weight: parseFloat(e.target.value) || 0 } };
                            try {
                              await api._fetch('/settings/packaging', { method: 'PUT', body: JSON.stringify({ packageBundles: updated }) });
                              loadPackaging();
                            } catch (err) { setError(err.message); }
                          }} />
                      </td>
                      <td>
                        <input type="checkbox" checked={data.forcePackage || false}
                          onChange={async (e) => {
                            const updated = { ...packagingConfig.packageBundles, [sku]: { ...data, forcePackage: e.target.checked } };
                            try {
                              await api._fetch('/settings/packaging', { method: 'PUT', body: JSON.stringify({ packageBundles: updated }) });
                              loadPackaging();
                            } catch (err) { setError(err.message); }
                          }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeSection === 'setup' && isAdmin && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Application Configuration</h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Configure API credentials and application settings. These values override the .env file and are saved securely. Secret values are masked after saving.
          </p>

          {(() => {
            const sections = [
              { id: 'photoday', label: 'PhotoDay PDX', icon: '📷' },
              { id: 'shipstation', label: 'ShipStation', icon: '📦' },
              { id: 'defaults', label: 'Defaults', icon: '⚙️' },
              { id: 'server', label: 'Server', icon: '🖥️' },
            ];

            return sections.map(section => {
              const sectionFields = appSettingsFields.filter(f => f.section === section.id);
              if (sectionFields.length === 0) return null;

              return (
                <div key={section.id} style={{ marginBottom: 24 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{section.icon}</span> {section.label}
                  </div>

                  {sectionFields.map(field => {
                    const setting = appSettingsData[field.key] || {};
                    const isSecret = field.secret;
                    const isRevealed = showSecrets[field.key];
                    const formValue = appSettingsForm[field.key] || '';
                    const isMasked = isSecret && formValue === '••••••••';

                    return (
                      <div className="form-group" key={field.key} style={{ marginBottom: 12 }}>
                        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {field.label}
                          {isSecret && setting.hasValue && (
                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: '#fff' }}>
                              Configured
                            </span>
                          )}
                        </label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            className="form-input"
                            type={isSecret && !isRevealed ? 'password' : 'text'}
                            value={formValue}
                            onChange={(e) => setAppSettingsForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                            placeholder={field.default || `Enter ${field.label}`}
                            style={{ flex: 1 }}
                          />
                          {isSecret && (
                            <button
                              className="btn btn-sm btn-secondary"
                              onClick={() => setShowSecrets(prev => ({ ...prev, [field.key]: !prev[field.key] }))}
                              style={{ minWidth: 60, fontSize: 11 }}
                              title={isRevealed ? 'Hide' : 'Show'}
                            >
                              {isRevealed ? 'Hide' : 'Show'}
                            </button>
                          )}
                        </div>
                        {isSecret && isMasked && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                            Value is set. Clear and re-enter to change.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={saveAppSettings} disabled={loading}>
              {loading ? 'Saving...' : 'Save Configuration'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Some changes (port, API credentials) require a server restart to take full effect.
            </span>
          </div>
        </div>
      )}
      {/* ═══ USERS (admin only) ══════════════════════════════ */}
      {activeSection === 'users' && isAdmin && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">User Management</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setShowNewUser(!showNewUser); setNewUser({ username: '', password: '', displayName: '', role: 'operator' }); }}>
              {showNewUser ? 'Cancel' : '+ New User'}
            </button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Manage who can access the dashboard. Admins can do everything. Operators can process and ship orders. Viewers can only see the dashboard.
          </p>

          {/* New user form */}
          {showNewUser && (
            <div style={{ padding: 16, background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', marginBottom: 20, border: '1px solid var(--border-light)' }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Create New User</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ marginBottom: 0, flex: '1 1 140px' }}>
                  <label className="form-label">Username</label>
                  <input className="form-input" value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    placeholder="e.g., jsmith" />
                </div>
                <div className="form-group" style={{ marginBottom: 0, flex: '1 1 140px' }}>
                  <label className="form-label">Password</label>
                  <input className="form-input" type="password" value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="Enter password" />
                </div>
                <div className="form-group" style={{ marginBottom: 0, flex: '1 1 160px' }}>
                  <label className="form-label">Display Name</label>
                  <input className="form-input" value={newUser.displayName}
                    onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                    placeholder="e.g., John Smith" />
                </div>
                <div className="form-group" style={{ marginBottom: 0, flex: '0 0 130px' }}>
                  <label className="form-label">Role</label>
                  <select className="form-input" value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                    <option value="admin">Admin</option>
                    <option value="operator">Operator</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                <button className="btn btn-success btn-sm" disabled={loading || !newUser.username || !newUser.password}
                  onClick={async () => {
                    clearMessages(); setLoading(true);
                    try {
                      await api.createUser(newUser);
                      setSuccess(`User "${newUser.username}" created`);
                      setShowNewUser(false);
                      setNewUser({ username: '', password: '', displayName: '', role: 'operator' });
                      await loadUsers();
                    } catch (err) { setError(err.message); }
                    finally { setLoading(false); }
                  }}>
                  Create
                </button>
              </div>
            </div>
          )}

          {/* User list */}
          {users.length > 0 ? (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr><th>Username</th><th>Display Name</th><th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const isEditing = editingUserId === u.id;
                    const roleBadge = {
                      admin: { bg: 'rgba(220,53,69,0.15)', color: '#DC3545' },
                      operator: { bg: 'rgba(33,150,243,0.15)', color: '#2196F3' },
                      viewer: { bg: 'rgba(76,175,80,0.15)', color: '#4CAF50' },
                    };
                    const badge = roleBadge[u.role] || roleBadge.operator;

                    return (
                      <React.Fragment key={u.id}>
                        <tr>
                          <td className="mono" style={{ fontWeight: 600 }}>{u.username}</td>
                          <td>{u.displayName || '—'}</td>
                          <td>
                            {isEditing ? (
                              <select className="form-input" defaultValue={u.role} style={{ padding: '2px 6px', fontSize: 12, width: 100 }}
                                onChange={async (e) => {
                                  try {
                                    await api.updateUser(u.id, { role: e.target.value });
                                    setSuccess(`Role updated for ${u.username}`);
                                    await loadUsers();
                                  } catch (err) { setError(err.message); }
                                }}>
                                <option value="admin">Admin</option>
                                <option value="operator">Operator</option>
                                <option value="viewer">Viewer</option>
                              </select>
                            ) : (
                              <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: 600, background: badge.bg, color: badge.color, textTransform: 'uppercase' }}>
                                {u.role}
                              </span>
                            )}
                          </td>
                          <td>
                            <span style={{ color: u.active ? 'var(--success)' : 'var(--text-muted)', fontSize: 12 }}>
                              {u.active ? 'Active' : 'Disabled'}
                            </span>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                          </td>
                          <td>
                            <div className="btn-group">
                              <button className="btn btn-sm btn-secondary"
                                onClick={() => setEditingUserId(isEditing ? null : u.id)}>
                                {isEditing ? 'Done' : 'Edit'}
                              </button>
                              {u.username !== 'admin' && (
                                <button className="btn btn-sm btn-danger"
                                  onClick={async () => {
                                    if (!window.confirm(`Disable user "${u.username}"?`)) return;
                                    try {
                                      await api.deleteUser(u.id);
                                      setSuccess(`User "${u.username}" disabled`);
                                      await loadUsers();
                                    } catch (err) { setError(err.message); }
                                  }}>
                                  Disable
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {/* Password change row */}
                        {isEditing && (
                          <tr>
                            <td colSpan="6" style={{ padding: '8px 14px', background: 'var(--bg-input)' }}>
                              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                <span style={{ fontSize: 12, fontWeight: 600 }}>Change password:</span>
                                <input className="form-input" type="password" placeholder="New password"
                                  value={editPassword} onChange={(e) => setEditPassword(e.target.value)}
                                  style={{ width: 200, padding: '4px 8px', fontSize: 12 }} />
                                <button className="btn btn-sm btn-primary" disabled={!editPassword}
                                  onClick={async () => {
                                    try {
                                      await api.updateUser(u.id, { password: editPassword });
                                      setSuccess(`Password updated for ${u.username}`);
                                      setEditPassword('');
                                    } catch (err) { setError(err.message); }
                                  }}>
                                  Update Password
                                </button>
                                {u.id === user?.id && (
                                  <span style={{ fontSize: 11, color: 'var(--warning)' }}>This is your account</span>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                                <span style={{ fontSize: 12, fontWeight: 600 }}>Display name:</span>
                                <input className="form-input" defaultValue={u.displayName}
                                  style={{ width: 200, padding: '4px 8px', fontSize: 12 }}
                                  onBlur={async (e) => {
                                    if (e.target.value !== u.displayName) {
                                      try {
                                        await api.updateUser(u.id, { displayName: e.target.value });
                                        setSuccess(`Display name updated for ${u.username}`);
                                        await loadUsers();
                                      } catch (err) { setError(err.message); }
                                    }
                                  }} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No users found</div>
          )}
        </div>
      )}
    </div>
  );
}
