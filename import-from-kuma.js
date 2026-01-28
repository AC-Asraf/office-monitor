#!/usr/bin/env node

/**
 * Import monitors from Uptime Kuma database
 */

const Database = require('better-sqlite3');
const path = require('path');

// Source: Uptime Kuma database
const kumaDbPath = path.join(process.env.HOME, 'monitoring/uptime-kuma-data/kuma.db');

// Destination: Office Monitor database
const monitorDbPath = path.join(__dirname, 'monitor.db');

console.log('📥 Importing from Uptime Kuma...\n');
console.log(`Source: ${kumaDbPath}`);
console.log(`Destination: ${monitorDbPath}\n`);

// Open databases
const kumaDb = new Database(kumaDbPath, { readonly: true });
const monitorDb = new Database(monitorDbPath);

// Create tables if they don't exist
monitorDb.exec(`
  CREATE TABLE IF NOT EXISTS monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'ping',
    hostname TEXT,
    url TEXT,
    floor TEXT,
    device_type TEXT,
    active INTEGER DEFAULT 1,
    interval INTEGER DEFAULT 30,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS heartbeats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL,
    status INTEGER NOT NULL,
    ping REAL,
    message TEXT,
    time DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_time ON heartbeats(monitor_id, time DESC);
`);

// Get monitors from Uptime Kuma (excluding groups)
const kumaMonitors = kumaDb.prepare(`
  SELECT
    m.id as kuma_id,
    m.name,
    m.type,
    m.hostname,
    m.url,
    m.active,
    m.interval,
    m.parent,
    t.name as tag_name
  FROM monitor m
  LEFT JOIN monitor_tag mt ON m.id = mt.monitor_id
  LEFT JOIN tag t ON mt.tag_id = t.id
  WHERE m.type != 'group'
  ORDER BY m.id
`).all();

// Group monitors and their tags
const monitorsMap = new Map();
kumaMonitors.forEach(row => {
  if (!monitorsMap.has(row.kuma_id)) {
    monitorsMap.set(row.kuma_id, {
      kuma_id: row.kuma_id,
      name: row.name,
      type: row.type,
      hostname: row.hostname,
      url: row.url,
      active: row.active,
      interval: row.interval,
      parent: row.parent,
      tags: []
    });
  }
  if (row.tag_name) {
    monitorsMap.get(row.kuma_id).tags.push(row.tag_name);
  }
});

const monitors = Array.from(monitorsMap.values());

// Determine device type based on parent group
// Parent 21 = Access Points, 22 = Printers, 31 = Poly Lens
const parentToType = {
  21: 'accessPoints',
  22: 'printers',
  31: 'polyLens'
};

// Map to track old ID -> new ID
const idMap = new Map();

// Insert monitors
const insertMonitor = monitorDb.prepare(`
  INSERT INTO monitors (name, type, hostname, url, floor, device_type, active, interval)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

console.log(`Found ${monitors.length} monitors to import:\n`);

let imported = 0;
let skipped = 0;

monitors.forEach(m => {
  // Determine floor from tags
  let floor = null;
  m.tags.forEach(tag => {
    if (tag.includes('Floor')) {
      floor = tag;
    }
  });

  // Fallback: extract floor from name
  if (!floor) {
    const name = m.name.toLowerCase();
    if (name.includes('1st floor') || name.includes('1st-floor')) floor = '1st Floor';
    else if (name.includes('2nd floor') || name.includes('2nd-floor')) floor = '2nd Floor';
    else if (name.includes('3rd floor') || name.includes('3rd-floor')) floor = '3rd Floor';
    else if (name.includes('5th floor') || name.includes('5th-floor')) floor = '5th Floor';
  }

  // Determine device type from parent
  const deviceType = parentToType[m.parent] || 'polyLens';

  // Extract hostname from URL if needed
  let hostname = m.hostname;
  if (!hostname && m.url) {
    const match = m.url.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (match) hostname = match[1];
  }

  try {
    const result = insertMonitor.run(
      m.name,
      m.type,
      hostname,
      m.url,
      floor,
      deviceType,
      m.active,
      m.interval || 30
    );

    idMap.set(m.kuma_id, result.lastInsertRowid);
    console.log(`  ✓ ${m.name} (${floor || 'No floor'}, ${deviceType})`);
    imported++;
  } catch (error) {
    console.log(`  ✗ ${m.name}: ${error.message}`);
    skipped++;
  }
});

// Import recent heartbeats (last 24 hours)
console.log('\n📊 Importing recent heartbeats...');

const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const heartbeats = kumaDb.prepare(`
  SELECT monitor_id, status, ping, msg, time
  FROM heartbeat
  WHERE time >= ?
  ORDER BY time ASC
`).all(yesterday);

const insertHeartbeat = monitorDb.prepare(`
  INSERT INTO heartbeats (monitor_id, status, ping, message, time)
  VALUES (?, ?, ?, ?, ?)
`);

let heartbeatCount = 0;
heartbeats.forEach(hb => {
  const newMonitorId = idMap.get(hb.monitor_id);
  if (newMonitorId) {
    try {
      insertHeartbeat.run(newMonitorId, hb.status, hb.ping, hb.msg, hb.time);
      heartbeatCount++;
    } catch (e) {
      // Skip duplicates
    }
  }
});

console.log(`  Imported ${heartbeatCount} heartbeats\n`);

// Close databases
kumaDb.close();
monitorDb.close();

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✅ Import complete!`);
console.log(`   Monitors: ${imported} imported, ${skipped} skipped`);
console.log(`   Heartbeats: ${heartbeatCount} imported`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('To start the monitor:\n');
console.log('  cd ~/Desktop/Claude\\ Project/office-monitor');
console.log('  npm start\n');
