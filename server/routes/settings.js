const express = require('express');
const router = express.Router();
const darkroomService = require('../services/darkroomService');
const printSheetService = require('../services/printSheetService');
const config = require('../config');

// ─── TEMPLATE MAPPINGS ──────────────────────────────────────

router.get('/template-mappings', async (req, res) => {
  try {
    const mappings = await darkroomService.getMappings();
    res.json(mappings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/template-mappings', async (req, res) => {
  try {
    const mappings = await darkroomService.addMapping(req.body);
    res.json({ success: true, mappings });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/template-mappings/:id', async (req, res) => {
  try {
    const mapping = await darkroomService.updateMapping(req.params.id, req.body);
    res.json({ success: true, mapping });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/template-mappings/:id', async (req, res) => {
  try {
    const mappings = await darkroomService.deleteMapping(req.params.id);
    res.json({ success: true, mappings });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── SIZE MAPPINGS (externalId → print size) ────────────────

router.get('/size-mappings', async (req, res) => {
  try {
    const mappings = await darkroomService.getSizeMappings();
    res.json(mappings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/size-mappings', async (req, res) => {
  try {
    const mappings = await darkroomService.addSizeMapping(req.body);
    res.json({ success: true, mappings });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/size-mappings/:externalId', async (req, res) => {
  try {
    const mappings = await darkroomService.deleteSizeMapping(req.params.externalId);
    res.json({ success: true, mappings });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── FILENAME CONFIG ────────────────────────────────────────

router.get('/filename-config', async (req, res) => {
  try {
    const config = await darkroomService.getFileNameConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/filename-config', async (req, res) => {
  try {
    const config = await darkroomService.updateFileNameConfig(req.body);
    res.json({ success: true, config });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── PRINT SHEET LAYOUTS ───────────────────────────────────

router.get('/print-layouts', (req, res) => {
  try {
    const layouts = printSheetService.getLayouts();
    res.json(layouts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/print-layouts', (req, res) => {
  try {
    const { id, ...layoutConfig } = req.body;
    const layout = printSheetService.addLayout(id, layoutConfig);
    res.json({ success: true, layout });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── APP SETTINGS ───────────────────────────────────────────

router.get('/app-config', (req, res) => {
  res.json({
    paths: config.paths,
    defaults: config.defaults,
    photodayConfigured: !!(config.photoday.secret && config.photoday.labId),
    shipstationConfigured: !!config.shipstation.apiKey,
  });
});

// ─── SPECIALTY PRODUCTS ─────────────────────────────────────
const specialtyService = require('../services/specialtyService');

router.get('/specialty', async (req, res) => {
  try {
    const config = await specialtyService.getConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/specialty/base-path', async (req, res) => {
  try {
    const { basePath } = req.body;
    if (!basePath) return res.status(400).json({ error: 'basePath required' });
    const result = await specialtyService.setBasePath(basePath);
    res.json({ success: true, basePath: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/specialty/products', async (req, res) => {
  try {
    const products = await specialtyService.addProduct(req.body);
    res.json({ success: true, products });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/specialty/products/:externalId', async (req, res) => {
  try {
    const products = await specialtyService.deleteProduct(req.params.externalId);
    res.json({ success: true, products });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/specialty/highlight-colors', async (req, res) => {
  try {
    const colors = await specialtyService.setHighlightColors(req.body);
    res.json({ success: true, colors });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── FOLDER SORT ────────────────────────────────────────────
const folderSortService = require('../services/folderSortService');

router.get('/folder-sort/options', (req, res) => {
  res.json(folderSortService.getSortOptions());
});

router.get('/folder-sort', async (req, res) => {
  try {
    const levels = await folderSortService.getSortLevels();
    res.json({ sortLevels: levels });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/folder-sort', async (req, res) => {
  try {
    const { sortLevels } = req.body;
    if (!sortLevels || !Array.isArray(sortLevels)) {
      return res.status(400).json({ error: 'sortLevels array is required' });
    }
    const result = await folderSortService.setSortLevels(sortLevels);
    res.json({ success: true, sortLevels: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── IMPOSITION LAYOUTS ─────────────────────────────────────
const impositionService = require('../services/impositionService');

router.get('/imposition/text-variables', (req, res) => {
  res.json(impositionService.getTextVariables());
});

router.get('/imposition/layouts', async (req, res) => {
  try {
    const layouts = await impositionService.getLayouts();
    res.json(layouts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/imposition/layouts', async (req, res) => {
  try {
    const layout = await impositionService.addLayout(req.body);
    res.json({ success: true, layout });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/imposition/layouts/:id', async (req, res) => {
  try {
    const layout = await impositionService.updateLayout(req.params.id, req.body);
    res.json({ success: true, layout });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/imposition/layouts/:id', async (req, res) => {
  try {
    const layouts = await impositionService.deleteLayout(req.params.id);
    res.json({ success: true, layouts });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── IMPOSITION MAPPINGS (externalId → layout) ─────────────
router.get('/imposition/mappings', async (req, res) => {
  try {
    const mappings = await impositionService.getMappings();
    res.json(mappings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/imposition/mappings', async (req, res) => {
  try {
    const { externalId, layoutId } = req.body;
    if (!externalId || !layoutId) {
      return res.status(400).json({ error: 'externalId and layoutId are required' });
    }
    const mappings = await impositionService.addMapping(externalId, layoutId);
    res.json({ success: true, mappings });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/imposition/mappings/:externalId', async (req, res) => {
  try {
    const mappings = await impositionService.deleteMapping(req.params.externalId);
    res.json({ success: true, mappings });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
