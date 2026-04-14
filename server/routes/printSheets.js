const express = require('express');
const router = express.Router();
const printSheetService = require('../services/printSheetService');
const path = require('path');

// ─── GENERATE PRINT SHEET ──────────────────────────────────
router.post('/generate', async (req, res) => {
  try {
    const { imagePath, layoutId, outputDir, dpi } = req.body;

    if (!imagePath) {
      return res.status(400).json({ error: 'imagePath is required' });
    }

    const result = await printSheetService.generateAndSavePrintSheet(
      imagePath,
      layoutId || '8-wallet-8x10',
      outputDir,
      { dpi }
    );

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GENERATE PRINT SHEET (PREVIEW) ────────────────────────
// Returns the image directly for preview in the browser
router.post('/preview', async (req, res) => {
  try {
    const { imagePath, layoutId, dpi } = req.body;

    if (!imagePath) {
      return res.status(400).json({ error: 'imagePath is required' });
    }

    const result = await printSheetService.generatePrintSheet(
      imagePath,
      layoutId || '8-wallet-8x10',
      { dpi: dpi || 72 } // Lower DPI for preview
    );

    res.set('Content-Type', 'image/jpeg');
    res.send(result.buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── BATCH GENERATE PRINT SHEETS ───────────────────────────
router.post('/generate-batch', async (req, res) => {
  try {
    const { images, layoutId, outputDir, dpi } = req.body;
    // images: [{ path: "...", name: "..." }, ...]

    if (!images || images.length === 0) {
      return res.status(400).json({ error: 'images array is required' });
    }

    const results = [];
    for (const image of images) {
      try {
        const result = await printSheetService.generateAndSavePrintSheet(
          image.path,
          layoutId || '8-wallet-8x10',
          outputDir,
          { dpi }
        );
        results.push({ imagePath: image.path, success: true, ...result });
      } catch (error) {
        results.push({ imagePath: image.path, success: false, error: error.message });
      }
    }

    res.json({
      totalImages: images.length,
      successCount: results.filter((r) => r.success).length,
      errorCount: results.filter((r) => !r.success).length,
      results,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── LIST AVAILABLE LAYOUTS ─────────────────────────────────
router.get('/layouts', (req, res) => {
  const layouts = printSheetService.getLayouts();
  res.json(layouts);
});

module.exports = router;
