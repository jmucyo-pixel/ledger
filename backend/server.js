// server.js
// Minimal REST API for the Ledger app: CRUD for deadline "entries",
// backed by SQLite. Runs on one host (see README) and is proxied to
// by nginx on both web servers so the frontend can hit a relative
// /api/... path regardless of which web server answered the request.

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const VALID_CATEGORIES = ['school', 'work', 'personal'];

function validateEntry(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.title !== undefined) {
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
      errors.push('title is required and must be a non-empty string');
    }
  }
  if (!partial || body.date !== undefined) {
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      errors.push('date is required and must be in YYYY-MM-DD format');
    }
  }
  if (!partial || body.category !== undefined) {
    if (!VALID_CATEGORIES.includes(body.category)) {
      errors.push(`category must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }
  }
  if (!partial || body.priority !== undefined) {
    const p = Number(body.priority);
    if (![1, 2, 3].includes(p)) {
      errors.push('priority must be 1, 2, or 3');
    }
  }
  if (body.link) {
    try {
      const parsed = new URL(body.link);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('link must be an http or https URL');
      }
    } catch (_) {
      errors.push('link must be a valid URL (e.g. https://example.com)');
    }
  }
  return errors;
}

// Health check — also used by HAProxy/nginx upstream checks
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// List all entries
app.get('/api/entries', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM entries ORDER BY date ASC').all();
    res.json(rows);
  } catch (err) {
    console.error('GET /api/entries failed:', err);
    res.status(500).json({ error: 'Could not load entries.' });
  }
});

// Create a new entry
app.post('/api/entries', (req, res) => {
  const errors = validateEntry(req.body);
  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  const id = crypto.randomUUID();
  const { title, date, category, priority, notes = '', link = '' } = req.body;

  try {
    db.prepare(`
      INSERT INTO entries (id, title, date, category, priority, notes, link)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, title.trim(), date, category, Number(priority), notes.trim(), link.trim());

    const created = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
    res.status(201).json(created);
  } catch (err) {
    console.error('POST /api/entries failed:', err);
    res.status(500).json({ error: 'Could not create entry.' });
  }
});

// Update an existing entry
app.put('/api/entries/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Entry not found.' });
  }

  const errors = validateEntry(req.body, { partial: true });
  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  const updated = {
    title: req.body.title !== undefined ? req.body.title.trim() : existing.title,
    date: req.body.date !== undefined ? req.body.date : existing.date,
    category: req.body.category !== undefined ? req.body.category : existing.category,
    priority: req.body.priority !== undefined ? Number(req.body.priority) : existing.priority,
    notes: req.body.notes !== undefined ? req.body.notes.trim() : existing.notes,
    link: req.body.link !== undefined ? req.body.link.trim() : existing.link,
  };

  try {
    db.prepare(`
      UPDATE entries
      SET title = ?, date = ?, category = ?, priority = ?, notes = ?, link = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(updated.title, updated.date, updated.category, updated.priority, updated.notes, updated.link, id);

    const result = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
    res.json(result);
  } catch (err) {
    console.error('PUT /api/entries/:id failed:', err);
    res.status(500).json({ error: 'Could not update entry.' });
  }
});

// Delete an entry
app.delete('/api/entries/:id', (req, res) => {
  const { id } = req.params;
  try {
    const result = db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Entry not found.' });
    }
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/entries/:id failed:', err);
    res.status(500).json({ error: 'Could not delete entry.' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.listen(PORT, () => {
  console.log(`Ledger API listening on port ${PORT}`);
});
