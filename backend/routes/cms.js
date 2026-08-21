const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const upload = require('../middleware/uploadCms');

const router = express.Router();
const VALID_SECTIONS = [
  'homepage_hero', 'announcement_bar', 'footer', 'seo_homepage',
  'help_support_page', 'about_us_page', 'delivery_returns_page', 'faq_page'
];

function deleteImageFile(url) {
  const filePath = path.join(__dirname, '..', 'public', url.replace(/^\//, ''));
  fs.unlink(filePath, () => {}); // best-effort; ignore if already gone
}

function readSection(section) {
  const row = db.prepare('SELECT value_json FROM cms_content WHERE key = ?').get(section);
  return row ? JSON.parse(row.value_json) : {};
}

function writeSection(section, value) {
  db.prepare(
    `INSERT INTO cms_content (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`
  ).run(section, JSON.stringify(value));
}

router.get('/:section', (req, res) => {
  if (!VALID_SECTIONS.includes(req.params.section)) {
    return res.status(404).json({ error: 'Unknown CMS section' });
  }
  const row = db.prepare('SELECT value_json FROM cms_content WHERE key = ?').get(req.params.section);
  if (!row) return res.status(404).json({ error: 'Section not found' });
  res.json(JSON.parse(row.value_json));
});

router.put('/:section', (req, res) => {
  if (!VALID_SECTIONS.includes(req.params.section)) {
    return res.status(404).json({ error: 'Unknown CMS section' });
  }
  const value = JSON.stringify(req.body || {});
  db.prepare(
    `INSERT INTO cms_content (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`
  ).run(req.params.section, value);
  res.json(req.body || {});
});

// ── SECTION IMAGE (e.g. homepage hero banner picture) ──
router.post('/:section/image', (req, res) => {
  if (!VALID_SECTIONS.includes(req.params.section)) {
    return res.status(404).json({ error: 'Unknown CMS section' });
  }
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image file was uploaded' });

    const current = readSection(req.params.section);
    const oldUrl = current.image_url;
    current.image_url = `/uploads/cms/${req.file.filename}`;
    writeSection(req.params.section, current);

    if (oldUrl && oldUrl.startsWith('/uploads/cms/')) deleteImageFile(oldUrl);

    res.status(201).json(current);
  });
});

router.delete('/:section/image', (req, res) => {
  if (!VALID_SECTIONS.includes(req.params.section)) {
    return res.status(404).json({ error: 'Unknown CMS section' });
  }
  const current = readSection(req.params.section);
  const oldUrl = current.image_url;
  delete current.image_url;
  writeSection(req.params.section, current);

  if (oldUrl && oldUrl.startsWith('/uploads/cms/')) deleteImageFile(oldUrl);

  res.json(current);
});

module.exports = router;
