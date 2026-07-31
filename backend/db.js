// db.js
// Sets up the SQLite database file and the `entries` table used to
// store deadlines. Uses better-sqlite3, a synchronous, file-based
// SQLite driver — no separate database server process needed.

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.LEDGER_DB_PATH || path.join(__dirname, 'data.sqlite');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('school', 'work', 'personal')),
    priority INTEGER NOT NULL CHECK (priority IN (1, 2, 3)),
    notes TEXT DEFAULT '',
    link TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration: older database files created before the `link` field
// existed won't have this column. Add it if missing, so upgrading
// doesn't require deleting existing data.
const columns = db.prepare('PRAGMA table_info(entries)').all();
if (!columns.some(col => col.name === 'link')) {
  db.exec("ALTER TABLE entries ADD COLUMN link TEXT DEFAULT ''");
}

module.exports = db;
