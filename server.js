require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const ping = require('ping');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const snmp = require('net-snmp');
const WebSocket = require('ws');

// Create HTTPS agent that ignores self-signed certificates
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Configuration
const PORT = process.env.PORT || 3002;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 30000;
const PING_TIMEOUT = parseInt(process.env.PING_TIMEOUT) || 5000;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL;

// Poly Lens Configuration
const POLY_LENS_CLIENT_ID = process.env.POLY_LENS_CLIENT_ID;
const POLY_LENS_CLIENT_SECRET = process.env.POLY_LENS_CLIENT_SECRET;
const POLY_LENS_AUTH_URL = 'https://login.lens.poly.com/oauth/token';
const POLY_LENS_GRAPHQL_URL = 'https://api.silica-prod01.io.lens.poly.com/graphql';

// ==================== DATABASE SETUP ====================

const dbPath = path.join(__dirname, 'monitor.db');
const db = new Database(dbPath);

// Create tables
db.exec(`
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

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'slack',
    webhook_url TEXT,
    channel TEXT,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_time ON heartbeats(monitor_id, time DESC);

  CREATE TABLE IF NOT EXISTS floor_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    floor TEXT UNIQUE NOT NULL,
    image_data TEXT,
    image_type TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    client_id TEXT,
    client_secret TEXT,
    webhook_url TEXT,
    config TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pending_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    change_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    data TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME,
    reviewed_by INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS device_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    icon TEXT DEFAULT '📟',
    color TEXT DEFAULT '#6B7280'
  );

  CREATE TABLE IF NOT EXISTS room_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT UNIQUE NOT NULL,
    floor TEXT NOT NULL,
    pos_x REAL NOT NULL,
    pos_y REAL NOT NULL,
    tv_pos_x REAL,
    tv_pos_y REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS poly_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    hardware_model TEXT,
    serial_number TEXT,
    software_version TEXT,
    ip_address TEXT,
    room TEXT,
    floor TEXT,
    connected INTEGER DEFAULT 0,
    last_seen DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS poly_heartbeats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poly_device_id INTEGER NOT NULL,
    connected INTEGER NOT NULL,
    ip_address TEXT,
    time DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (poly_device_id) REFERENCES poly_devices(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_poly_heartbeats_device_time ON poly_heartbeats(poly_device_id, time DESC);

  CREATE TABLE IF NOT EXISTS printer_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL,
    toner_black INTEGER,
    toner_cyan INTEGER,
    toner_magenta INTEGER,
    toner_yellow INTEGER,
    toner_waste INTEGER,
    paper_level INTEGER,
    paper_tray1 INTEGER,
    paper_tray2 INTEGER,
    error_state TEXT,
    error_description TEXT,
    page_count INTEGER,
    model TEXT,
    serial_number TEXT,
    time DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_printer_status_monitor_time ON printer_status(monitor_id, time DESC);

  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER,
    device_name TEXT NOT NULL,
    device_type TEXT,
    type TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    duration_minutes INTEGER,
    notes TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents(started_at DESC);

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);

  CREATE TABLE IF NOT EXISTS zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    floor TEXT NOT NULL,
    name TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    color TEXT DEFAULT '#3B82F6',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Run migrations for new columns (safe to run multiple times)
const migrations = [
  `ALTER TABLE monitors ADD COLUMN pos_x REAL DEFAULT NULL`,
  `ALTER TABLE monitors ADD COLUMN pos_y REAL DEFAULT NULL`,
  `ALTER TABLE monitors ADD COLUMN tv_pos_x REAL DEFAULT NULL`,
  `ALTER TABLE monitors ADD COLUMN tv_pos_y REAL DEFAULT NULL`,
  `ALTER TABLE monitors ADD COLUMN maintenance INTEGER DEFAULT 0`,
  `ALTER TABLE monitors ADD COLUMN maintenance_note TEXT DEFAULT NULL`,
  `ALTER TABLE monitors ADD COLUMN maintenance_until DATETIME DEFAULT NULL`,
  `ALTER TABLE monitors ADD COLUMN disabled INTEGER DEFAULT 0`,
  // Poly devices maintenance columns
  `ALTER TABLE poly_devices ADD COLUMN maintenance INTEGER DEFAULT 0`,
  `ALTER TABLE poly_devices ADD COLUMN maintenance_note TEXT DEFAULT NULL`,
  `ALTER TABLE poly_devices ADD COLUMN maintenance_until DATETIME DEFAULT NULL`,
  `ALTER TABLE poly_devices ADD COLUMN disabled INTEGER DEFAULT 0`,
  // Threshold alerts dismissed column
  `ALTER TABLE threshold_alerts ADD COLUMN dismissed_at DATETIME DEFAULT NULL`,
  `ALTER TABLE threshold_alerts ADD COLUMN dismissed_by TEXT DEFAULT NULL`,
  // Device notes column
  `ALTER TABLE monitors ADD COLUMN notes TEXT DEFAULT NULL`,
  // Health score columns
  `ALTER TABLE monitors ADD COLUMN health_score INTEGER DEFAULT 100`,
  `ALTER TABLE monitors ADD COLUMN last_health_update DATETIME DEFAULT NULL`,
  // Room positions TV mode columns
  `ALTER TABLE room_positions ADD COLUMN tv_pos_x REAL DEFAULT NULL`,
  `ALTER TABLE room_positions ADD COLUMN tv_pos_y REAL DEFAULT NULL`,
  // 2FA columns for users
  `ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT NULL`,
  `ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN totp_verified INTEGER DEFAULT 0`,
  // Custom check interval per device
  `ALTER TABLE monitors ADD COLUMN check_interval INTEGER DEFAULT NULL`,
  // 3D position height (pos_z) for 3D floor view
  `ALTER TABLE monitors ADD COLUMN pos_z REAL DEFAULT NULL`,
  `ALTER TABLE room_positions ADD COLUMN pos_z REAL DEFAULT NULL`,
  // Floor zones type column (room = closed polygon, wall = open path)
  `ALTER TABLE floor_zones ADD COLUMN type TEXT DEFAULT 'room'`,
  // Serial number for printers and devices
  `ALTER TABLE monitors ADD COLUMN serial_number TEXT DEFAULT NULL`,
];

migrations.forEach(sql => {
  try {
    db.exec(sql);
  } catch (e) {
    // Column already exists, ignore
  }
});

// Create threshold alerts table (for tracking sent alerts)
db.exec(`
  CREATE TABLE IF NOT EXISTS threshold_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL,
    alert_type TEXT NOT NULL,
    alert_value INTEGER,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_threshold_alerts_monitor ON threshold_alerts(monitor_id, alert_type, resolved_at);
`);

// Create activity log table (tracks all user actions)
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    entity_name TEXT,
    details TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(username);
`);

// Create incidents table (tracks device outages)
db.exec(`
  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER,
    poly_device_id TEXT,
    device_name TEXT NOT NULL,
    device_type TEXT,
    floor TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    duration_seconds INTEGER,
    resolution_notes TEXT,
    acknowledged_by TEXT,
    acknowledged_at DATETIME
  );
  CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents(started_at);
  CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents(monitor_id);
`);

// Create device tags table
db.exec(`
  CREATE TABLE IF NOT EXISTS device_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    color TEXT DEFAULT '#3B82F6',
    priority INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create monitor_tags junction table
db.exec(`
  CREATE TABLE IF NOT EXISTS monitor_tags (
    monitor_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (monitor_id, tag_id),
    FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES device_tags(id) ON DELETE CASCADE
  );
`);

// Create custom alert rules table
db.exec(`
  CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER,
    tag_id INTEGER,
    rule_type TEXT NOT NULL,
    condition TEXT NOT NULL,
    threshold INTEGER,
    retry_count INTEGER DEFAULT 3,
    notify_slack INTEGER DEFAULT 1,
    notify_webhook TEXT,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES device_tags(id) ON DELETE CASCADE
  );
`);

// Create webhooks table
db.exec(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    type TEXT DEFAULT 'generic',
    events TEXT DEFAULT 'all',
    headers TEXT,
    enabled INTEGER DEFAULT 1,
    last_triggered DATETIME,
    last_status INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create scheduled reports table
db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    report_type TEXT DEFAULT 'summary',
    recipients TEXT,
    slack_channel TEXT,
    include_floors TEXT,
    include_device_types TEXT,
    last_sent DATETIME,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create user_notifications table (for notification center UI)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    severity TEXT DEFAULT 'info',
    entity_type TEXT,
    entity_id TEXT,
    read_at DATETIME,
    dismissed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
try { db.exec('CREATE INDEX IF NOT EXISTS idx_user_notifications_created ON user_notifications(created_at)'); } catch(e) {}

// Create API health monitors table
db.exec(`
  CREATE TABLE IF NOT EXISTS api_monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    method TEXT DEFAULT 'GET',
    headers TEXT,
    body TEXT,
    expected_status INTEGER DEFAULT 200,
    timeout INTEGER DEFAULT 10000,
    interval INTEGER DEFAULT 60000,
    enabled INTEGER DEFAULT 1,
    last_check DATETIME,
    last_status TEXT,
    last_response_time INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create device templates table
db.exec(`
  CREATE TABLE IF NOT EXISTS device_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'ping',
    device_type TEXT,
    default_interval INTEGER DEFAULT 30,
    icon TEXT,
    color TEXT,
    snmp_enabled INTEGER DEFAULT 0,
    snmp_community TEXT DEFAULT 'public',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create saved filters table
db.exec(`
  CREATE TABLE IF NOT EXISTS saved_filters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    filter_config TEXT NOT NULL,
    is_global INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Create floor zones table
db.exec(`
  CREATE TABLE IF NOT EXISTS floor_zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    floor TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#3B82F6',
    opacity REAL DEFAULT 0.2,
    points TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insert default device templates
const defaultTemplates = [
  { name: 'Access Point', type: 'ping', device_type: 'accessPoints', icon: '📡', color: '#3B82F6' },
  { name: 'Network Printer', type: 'ping', device_type: 'printers', icon: '🖨️', color: '#8B5CF6', snmp_enabled: 1 },
  { name: 'Network Switch', type: 'ping', device_type: 'switch', icon: '🔌', color: '#22C55E' },
  { name: 'Server', type: 'ping', device_type: 'server', icon: '🖥️', color: '#F59E0B' },
  { name: 'Router', type: 'ping', device_type: 'router', icon: '📶', color: '#EF4444' },
  { name: 'IP Camera', type: 'ping', device_type: 'camera', icon: '📹', color: '#06B6D4' },
  { name: 'Web Service', type: 'http', device_type: 'service', icon: '🌐', color: '#EC4899' }
];
const insertTemplate = db.prepare('INSERT OR IGNORE INTO device_templates (name, type, device_type, icon, color, snmp_enabled) VALUES (?, ?, ?, ?, ?, ?)');
defaultTemplates.forEach(t => insertTemplate.run(t.name, t.type, t.device_type, t.icon, t.color, t.snmp_enabled || 0));

// Insert default tags
const defaultTags = [
  { name: 'Critical', color: '#EF4444', priority: 100 },
  { name: 'VIP Room', color: '#8B5CF6', priority: 90 },
  { name: 'Meeting Room', color: '#3B82F6', priority: 50 },
  { name: 'Common Area', color: '#22C55E', priority: 30 }
];
const insertTag = db.prepare('INSERT OR IGNORE INTO device_tags (name, color, priority) VALUES (?, ?, ?)');
defaultTags.forEach(t => insertTag.run(t.name, t.color, t.priority));

// Initialize default settings from environment variables
const defaultSettings = {
  slack_webhook_url: process.env.SLACK_WEBHOOK_URL || '',
  slack_channel: process.env.SLACK_CHANNEL || '',
  slack_enabled: '1',
  poly_lens_client_id: process.env.POLY_LENS_CLIENT_ID || '',
  poly_lens_client_secret: process.env.POLY_LENS_CLIENT_SECRET || '',
  check_interval: String(CHECK_INTERVAL),
  ping_timeout: String(PING_TIMEOUT)
};

const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
Object.entries(defaultSettings).forEach(([key, value]) => {
  insertSetting.run(key, value);
});

// Initialize default admin user from environment variables
const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'changeme123';

const insertUser = db.prepare(`INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)`);
insertUser.run(defaultAdminUsername, defaultAdminPassword, 'admin');

// Initialize default device types
const defaultDeviceTypes = [
  { name: 'accessPoints', icon: '📡', color: '#3B82F6' },
  { name: 'printers', icon: '🖨️', color: '#8B5CF6' },
  { name: 'polyLens', icon: '📹', color: '#F59E0B' }
];

const insertDeviceType = db.prepare(`INSERT OR IGNORE INTO device_types (name, icon, color) VALUES (?, ?, ?)`);
defaultDeviceTypes.forEach(dt => {
  insertDeviceType.run(dt.name, dt.icon, dt.color);
});

// Migrate existing Poly Lens to API integrations
const existingPolyLens = db.prepare(`SELECT * FROM api_integrations WHERE type = 'poly_lens'`).get();
const polyLensClientId = db.prepare(`SELECT value FROM settings WHERE key = 'poly_lens_client_id'`).get();
if (!existingPolyLens && polyLensClientId?.value) {
  const polyLensSecret = db.prepare(`SELECT value FROM settings WHERE key = 'poly_lens_client_secret'`).get();
  db.prepare(`INSERT INTO api_integrations (name, type, client_id, client_secret, active)
    VALUES (?, ?, ?, ?, ?)`).run(
    'Poly Lens',
    'poly_lens',
    polyLensClientId.value,
    polyLensSecret?.value || '',
    1
  );
}

// ==================== MONITORING STATE ====================

const monitorStatus = new Map(); // monitor_id -> { status, lastChange, lastCheck }
let isFirstRun = true; // Skip alerts on initial run
let polyLensToken = null;
let polyLensTokenExpiry = null;
let polyLensDevices = [];
let polyLensLastFetch = null;

// Load last known status from database on startup
function loadPreviousStatus() {
  const monitors = db.prepare('SELECT id FROM monitors').all();
  for (const monitor of monitors) {
    const lastHeartbeat = db.prepare(`
      SELECT status, time FROM heartbeats
      WHERE monitor_id = ?
      ORDER BY time DESC
      LIMIT 1
    `).get(monitor.id);

    if (lastHeartbeat) {
      monitorStatus.set(monitor.id, {
        status: lastHeartbeat.status,
        lastChange: new Date(lastHeartbeat.time),
        lastCheck: new Date(lastHeartbeat.time)
      });
    }
  }
  console.log(`Loaded previous status for ${monitorStatus.size} monitors`);
}

// Load previous status immediately
loadPreviousStatus();

// ==================== SETTINGS HELPERS ====================

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(row => { settings[row.key] = row.value; });
  return settings;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// ==================== AUTHENTICATION ====================

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
  db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)').run(userId, token, expiresAt);
  return token;
}

function getSession(token) {
  const session = db.prepare(`
    SELECT s.*, u.username, u.role FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  return session;
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  }

  req.user = {
    id: session.user_id,
    username: session.username,
    role: session.role
  };
  next();
}

// Admin-only middleware
function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// Optional auth (for public endpoints that behave differently when authenticated)
function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (token) {
    const session = getSession(token);
    if (session) {
      req.user = {
        id: session.user_id,
        username: session.username,
        role: session.role
      };
    }
  }
  next();
}

// ==================== PENDING CHANGES ====================

function createPendingChange(userId, changeType, entityType, entityId, data) {
  const stmt = db.prepare(`
    INSERT INTO pending_changes (user_id, change_type, entity_type, entity_id, data)
    VALUES (?, ?, ?, ?, ?)
  `);
  return stmt.run(userId, changeType, entityType, entityId, JSON.stringify(data));
}

function getPendingChanges(status = 'pending') {
  return db.prepare(`
    SELECT pc.*, u.username as requested_by
    FROM pending_changes pc
    JOIN users u ON pc.user_id = u.id
    WHERE pc.status = ?
    ORDER BY pc.created_at DESC
  `).all(status);
}

function approvePendingChange(changeId, adminId) {
  const change = db.prepare('SELECT * FROM pending_changes WHERE id = ?').get(changeId);
  if (!change) return { success: false, error: 'Change not found' };

  const data = JSON.parse(change.data);

  // Apply the change based on type
  if (change.change_type === 'update' && change.entity_type === 'monitor') {
    db.prepare(`
      UPDATE monitors SET name = ?, type = ?, hostname = ?, url = ?, floor = ?, device_type = ?, active = ?, interval = ?
      WHERE id = ?
    `).run(data.name, data.type, data.hostname, data.url, data.floor, data.device_type, data.active, data.interval, change.entity_id);
  } else if (change.change_type === 'delete' && change.entity_type === 'monitor') {
    db.prepare('DELETE FROM heartbeats WHERE monitor_id = ?').run(change.entity_id);
    db.prepare('DELETE FROM monitors WHERE id = ?').run(change.entity_id);
  } else if (change.change_type === 'update' && change.entity_type === 'api_integration') {
    db.prepare(`
      UPDATE api_integrations SET name = ?, client_id = ?, client_secret = ?, webhook_url = ?, config = ?, active = ?
      WHERE id = ?
    `).run(data.name, data.client_id, data.client_secret, data.webhook_url, data.config, data.active, change.entity_id);
  } else if (change.change_type === 'update' && change.entity_type === 'notification') {
    db.prepare(`
      UPDATE notifications SET name = ?, webhook_url = ?, channel = ?, active = ?
      WHERE id = ?
    `).run(data.name, data.webhook_url, data.channel, data.active, change.entity_id);
  }

  // Mark as approved
  db.prepare(`
    UPDATE pending_changes SET status = 'approved', reviewed_at = datetime('now'), reviewed_by = ?
    WHERE id = ?
  `).run(adminId, changeId);

  return { success: true };
}

function rejectPendingChange(changeId, adminId) {
  db.prepare(`
    UPDATE pending_changes SET status = 'rejected', reviewed_at = datetime('now'), reviewed_by = ?
    WHERE id = ?
  `).run(adminId, changeId);
  return { success: true };
}

// ==================== SLACK NOTIFICATIONS ====================

async function sendSlackAlert(monitor, status, message, alertType = 'status') {
  const webhookUrl = getSetting('slack_webhook_url');
  const slackEnabled = getSetting('slack_enabled');
  const slackChannel = getSetting('slack_channel');

  if (!webhookUrl || slackEnabled !== '1') {
    console.log('Slack notifications disabled or not configured');
    return;
  }

  // Check if device is in maintenance mode (skip status alerts only)
  if (alertType === 'status' && monitor.maintenance === 1) {
    // Check if maintenance has expired
    if (monitor.maintenance_until) {
      const maintenanceEnd = new Date(monitor.maintenance_until);
      if (maintenanceEnd > new Date()) {
        console.log(`Skipping alert for ${monitor.name} - in maintenance mode until ${maintenanceEnd}`);
        return;
      }
    } else {
      console.log(`Skipping alert for ${monitor.name} - in maintenance mode`);
      return;
    }
  }

  const emoji = status === 1 ? ':white_check_mark:' : ':red_circle:';
  const statusText = status === 1 ? 'UP' : 'DOWN';
  const color = status === 1 ? '#22C55E' : '#EF4444';

  const payload = {
    channel: slackChannel,
    attachments: [{
      color: color,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} *${monitor.name}* is *${statusText}*`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `*Type:* ${monitor.device_type || monitor.type} | *IP:* ${monitor.hostname || monitor.url} | *Floor:* ${monitor.floor || 'N/A'}`
            }
          ]
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: message ? `_${message}_` : `_${new Date().toLocaleString()}_`
            }
          ]
        }
      ]
    }]
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('Slack alert failed:', response.status);
    } else {
      console.log(`Slack alert sent: ${monitor.name} is ${statusText}`);
    }
  } catch (error) {
    console.error('Slack alert error:', error.message);
  }
}

// ==================== MONITORING ENGINE ====================

async function checkMonitor(monitor) {
  let status = 0;
  let pingTime = null;
  let message = '';

  try {
    if (monitor.type === 'ping') {
      const result = await ping.promise.probe(monitor.hostname, {
        timeout: PING_TIMEOUT / 1000,
        extra: ['-c', '1']
      });
      status = result.alive ? 1 : 0;
      pingTime = result.time === 'unknown' ? null : parseFloat(result.time);
      message = result.alive ? '' : 'Host unreachable';
    } else if (monitor.type === 'http') {
      const startTime = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT);

      try {
        // Use custom HTTPS agent to handle self-signed certificates
        const isHttps = monitor.url.startsWith('https://');
        const fetchOptions = {
          method: 'GET',
          signal: controller.signal,
          headers: { 'User-Agent': 'OfficeMonitor/1.0' }
        };

        // For HTTPS with self-signed certs, use node's http module
        if (isHttps) {
          const url = new URL(monitor.url);
          const result = await new Promise((resolve, reject) => {
            const req = https.request({
              hostname: url.hostname,
              port: url.port || 443,
              path: url.pathname || '/',
              method: 'GET',
              rejectUnauthorized: false,
              timeout: PING_TIMEOUT
            }, (res) => {
              resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, statusText: res.statusMessage });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.end();
          });
          clearTimeout(timeout);
          pingTime = Date.now() - startTime;
          status = result.ok ? 1 : 0;
          message = `${result.status} - ${result.statusText}`;
        } else {
          const response = await fetch(monitor.url, fetchOptions);
          clearTimeout(timeout);
          pingTime = Date.now() - startTime;
          status = response.ok ? 1 : 0;
          message = `${response.status} - ${response.statusText}`;
        }
      } catch (e) {
        clearTimeout(timeout);
        status = 0;
        message = e.name === 'AbortError' ? 'Timeout' : e.message;
      }
    }
  } catch (error) {
    status = 0;
    message = error.message;
  }

  return { status, pingTime, message };
}

// Track pending down alerts that need retry confirmation
const pendingDownAlerts = new Map(); // monitor_id -> { firstFailTime, retryScheduled }

async function runMonitorCheck(monitor) {
  const { status, pingTime, message } = await checkMonitor(monitor);

  // Save heartbeat
  const stmt = db.prepare(`
    INSERT INTO heartbeats (monitor_id, status, ping, message)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(monitor.id, status, pingTime, message);

  // Check for status change
  const prevStatus = monitorStatus.get(monitor.id);
  const statusChanged = prevStatus && prevStatus.status !== status;

  if (statusChanged && !isFirstRun) {
    if (status === 0) {
      // Device went DOWN - schedule a retry before alerting
      if (!pendingDownAlerts.has(monitor.id)) {
        console.log(`${monitor.name} appears DOWN, scheduling retry in 15s...`);
        pendingDownAlerts.set(monitor.id, { firstFailTime: new Date(), retryScheduled: true });

        // Schedule retry check after 15 seconds
        setTimeout(async () => {
          const retryResult = await checkMonitor(monitor);

          // Save retry heartbeat
          stmt.run(monitor.id, retryResult.status, retryResult.pingTime, retryResult.message);

          if (retryResult.status === 0) {
            // Still down after retry - send alert and create incident
            console.log(`${monitor.name} confirmed DOWN after retry, sending alert`);
            await sendSlackAlert(monitor, 0, retryResult.message);

            // Create incident
            const incidentResult = db.prepare(`
              INSERT INTO incidents (monitor_id, device_name, device_type, floor, started_at)
              VALUES (?, ?, ?, ?, datetime('now'))
            `).run(monitor.id, monitor.name, monitor.device_type, monitor.floor);

            // Create notification
            createNotification('device_down', `${monitor.name} is offline`, retryResult.message, 'error', 'monitor', monitor.id);

            // Trigger webhooks
            triggerWebhooks('device_down', { monitor, message: retryResult.message });

            // Broadcast via WebSocket
            broadcastStatusUpdate(monitor, 'down', 'monitor');
            broadcastIncident({ id: incidentResult.lastInsertRowid, device_name: monitor.name, floor: monitor.floor }, 'created');

            monitorStatus.set(monitor.id, {
              status: 0,
              lastChange: new Date(),
              lastCheck: new Date()
            });
          } else {
            // Recovered during retry period - no alert needed
            console.log(`${monitor.name} recovered during retry period, no alert sent`);

            // Broadcast via WebSocket
            broadcastStatusUpdate(monitor, 'up', 'monitor');

            monitorStatus.set(monitor.id, {
              status: 1,
              lastChange: prevStatus?.lastChange || new Date(),
              lastCheck: new Date()
            });
          }

          pendingDownAlerts.delete(monitor.id);
        }, 15000);

        // Don't update status yet - wait for retry
        return { status, pingTime, message, statusChanged: false };
      }
    } else {
      // Device came back UP
      pendingDownAlerts.delete(monitor.id); // Cancel any pending retry
      await sendSlackAlert(monitor, status, message);

      // Broadcast via WebSocket
      broadcastStatusUpdate(monitor, 'up', 'monitor');

      // Close any open incidents for this monitor
      const openIncident = db.prepare('SELECT * FROM incidents WHERE monitor_id = ? AND ended_at IS NULL').get(monitor.id);
      if (openIncident) {
        const durationSeconds = Math.floor((Date.now() - new Date(openIncident.started_at).getTime()) / 1000);
        db.prepare(`
          UPDATE incidents SET ended_at = datetime('now'), duration_seconds = ?
          WHERE id = ?
        `).run(durationSeconds, openIncident.id);

        // Create notification
        createNotification('device_up', `${monitor.name} is back online`, `Downtime: ${Math.floor(durationSeconds / 60)} minutes`, 'success', 'monitor', monitor.id);

        // Trigger webhooks
        triggerWebhooks('device_up', { monitor, downtime: durationSeconds });

        // Broadcast incident resolved via WebSocket
        broadcastIncident({ id: openIncident.id, device_name: monitor.name, floor: monitor.floor, duration: durationSeconds }, 'resolved');
      }
    }
  }

  monitorStatus.set(monitor.id, {
    status,
    lastChange: statusChanged ? new Date() : (prevStatus?.lastChange || new Date()),
    lastCheck: new Date()
  });

  return { status, pingTime, message, statusChanged };
}

async function runAllChecks() {
  const monitors = db.prepare('SELECT * FROM monitors WHERE active = 1').all();
  console.log(`Running checks for ${monitors.length} monitors...`);

  for (const monitor of monitors) {
    try {
      await runMonitorCheck(monitor);
    } catch (error) {
      console.error(`Error checking ${monitor.name}:`, error.message);
    }
  }
}

// ==================== POLY LENS INTEGRATION ====================

async function getPolyLensToken() {
  if (polyLensToken && polyLensTokenExpiry && Date.now() < polyLensTokenExpiry) {
    return polyLensToken;
  }

  if (!POLY_LENS_CLIENT_ID || !POLY_LENS_CLIENT_SECRET) {
    return null;
  }

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', POLY_LENS_CLIENT_ID);
    params.append('client_secret', POLY_LENS_CLIENT_SECRET);

    const response = await fetch(POLY_LENS_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    if (!response.ok) throw new Error(`Auth failed: ${response.status}`);

    const data = await response.json();
    polyLensToken = data.access_token;
    polyLensTokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
    console.log('Poly Lens token refreshed');
    return polyLensToken;
  } catch (error) {
    console.error('Poly Lens auth error:', error.message);
    return null;
  }
}

// Prepared statements for Poly device tracking
const upsertPolyDevice = db.prepare(`
  INSERT INTO poly_devices (device_id, name, hardware_model, serial_number, software_version, ip_address, room, floor, connected, last_seen, updated_at)
  VALUES (@device_id, @name, @hardware_model, @serial_number, @software_version, @ip_address, @room, @floor, @connected, @last_seen, CURRENT_TIMESTAMP)
  ON CONFLICT(device_id) DO UPDATE SET
    name = @name,
    hardware_model = @hardware_model,
    serial_number = @serial_number,
    software_version = @software_version,
    ip_address = @ip_address,
    room = @room,
    floor = @floor,
    connected = @connected,
    last_seen = @last_seen,
    updated_at = CURRENT_TIMESTAMP
`);

const insertPolyHeartbeat = db.prepare(`
  INSERT INTO poly_heartbeats (poly_device_id, connected, ip_address)
  VALUES (@poly_device_id, @connected, @ip_address)
`);

const getPolyDeviceByDeviceId = db.prepare(`SELECT id FROM poly_devices WHERE device_id = ?`);

function recordPolyDeviceHeartbeat(device, floor) {
  try {
    // Upsert the device
    upsertPolyDevice.run({
      device_id: device.id,
      name: device.displayName || device.name,
      hardware_model: device.hardwareModel || null,
      serial_number: device.serialNumber || null,
      software_version: device.softwareVersion || null,
      ip_address: device.internalIp || null,
      room: device.room?.name || null,
      floor: floor,
      connected: device.connected ? 1 : 0,
      last_seen: device.lastDetected || null
    });

    // Get the device's database ID
    const dbDevice = getPolyDeviceByDeviceId.get(device.id);
    if (dbDevice) {
      // Record heartbeat
      insertPolyHeartbeat.run({
        poly_device_id: dbDevice.id,
        connected: device.connected ? 1 : 0,
        ip_address: device.internalIp || null
      });
    }
  } catch (error) {
    console.error('Error recording Poly device heartbeat:', error.message);
  }
}

// ==================== PRINTER SNMP MONITORING ====================

// Standard Printer MIB OIDs
const PRINTER_OIDS = {
  // Printer MIB (RFC 3805)
  description: '1.3.6.1.2.1.1.1.0',           // sysDescr
  name: '1.3.6.1.2.1.1.5.0',                  // sysName
  serialNumber: '1.3.6.1.2.1.43.5.1.1.17.1',  // prtGeneralSerialNumber
  pageCount: '1.3.6.1.2.1.43.10.2.1.4.1.1',   // prtMarkerLifeCount

  // Printer status
  printerStatus: '1.3.6.1.2.1.25.3.5.1.1.1',  // hrPrinterStatus
  deviceStatus: '1.3.6.1.2.1.25.3.2.1.5.1',   // hrDeviceStatus

  // Supplies (marker supplies table base)
  supplyDescription: '1.3.6.1.2.1.43.11.1.1.6.1',  // prtMarkerSuppliesDescription
  supplyMaxCapacity: '1.3.6.1.2.1.43.11.1.1.8.1',  // prtMarkerSuppliesMaxCapacity
  supplyLevel: '1.3.6.1.2.1.43.11.1.1.9.1',        // prtMarkerSuppliesLevel
  supplyType: '1.3.6.1.2.1.43.11.1.1.5.1',         // prtMarkerSuppliesType
  supplyColorant: '1.3.6.1.2.1.43.12.1.1.4.1',     // prtMarkerColorantValue

  // Paper trays (input table base)
  inputDescription: '1.3.6.1.2.1.43.8.2.1.18.1',   // prtInputDescription
  inputMaxCapacity: '1.3.6.1.2.1.43.8.2.1.9.1',    // prtInputMaxCapacity
  inputCurrentLevel: '1.3.6.1.2.1.43.8.2.1.10.1',  // prtInputCurrentLevel

  // Alerts/Errors
  alertDescription: '1.3.6.1.2.1.43.18.1.1.8',     // prtAlertDescription
  alertSeverity: '1.3.6.1.2.1.43.18.1.1.2',        // prtAlertSeverityLevel
};

// SNMP walk to get all values under an OID subtree
function snmpWalk(session, baseOid) {
  return new Promise((resolve, reject) => {
    const results = [];

    function feedCb(varbinds) {
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) {
          console.error('SNMP varbind error:', snmp.varbindError(vb));
        } else {
          results.push({
            oid: vb.oid,
            value: vb.value,
            type: vb.type
          });
        }
      }
    }

    function doneCb(error) {
      if (error) {
        reject(error);
      } else {
        resolve(results);
      }
    }

    session.subtree(baseOid, 20, feedCb, doneCb);
  });
}

// Get single SNMP value
function snmpGet(session, oids) {
  return new Promise((resolve, reject) => {
    session.get(oids, (error, varbinds) => {
      if (error) {
        reject(error);
      } else {
        const results = {};
        varbinds.forEach(vb => {
          if (!snmp.isVarbindError(vb)) {
            results[vb.oid] = vb.value;
          }
        });
        resolve(results);
      }
    });
  });
}

// Parse supply type to color name
function getSupplyColor(typeValue, description) {
  const desc = (description || '').toString().toLowerCase();
  const descUpper = (description || '').toString().toUpperCase();

  // Check for full color names
  if (desc.includes('black') || desc.includes('schwarz')) return 'black';
  if (desc.includes('cyan')) return 'cyan';
  if (desc.includes('magenta')) return 'magenta';
  if (desc.includes('yellow') || desc.includes('gelb')) return 'yellow';
  if (desc.includes('waste') || desc.includes('rest')) return 'waste';
  if (desc.includes('drum') || desc.includes('trommel')) return 'drum';
  if (desc.includes('fuser') || desc.includes('fixier')) return 'fuser';

  // Check for single-letter color codes (e.g., TK-5270K, TK-5270C)
  // Common patterns: ends with K (black), C (cyan), M (magenta), Y (yellow)
  if (/[^A-Z]K$/i.test(descUpper) || descUpper.endsWith('-K')) return 'black';
  if (/[^A-Z]C$/i.test(descUpper) || descUpper.endsWith('-C')) return 'cyan';
  if (/[^A-Z]M$/i.test(descUpper) || descUpper.endsWith('-M')) return 'magenta';
  if (/[^A-Z]Y$/i.test(descUpper) || descUpper.endsWith('-Y')) return 'yellow';

  return 'unknown';
}

// Calculate percentage from level and max capacity
function calculatePercentage(level, maxCapacity) {
  if (level === -1) return 100; // -1 means OK/unknown
  if (level === -2) return 0;   // -2 means unknown
  if (level === -3) return 50;  // -3 means some remaining
  if (maxCapacity <= 0) return level > 0 ? 50 : 0;
  return Math.round((level / maxCapacity) * 100);
}

// Prepared statement for printer status
const insertPrinterStatus = db.prepare(`
  INSERT INTO printer_status (monitor_id, toner_black, toner_cyan, toner_magenta, toner_yellow, toner_waste,
    paper_level, paper_tray1, paper_tray2, error_state, error_description, page_count, model, serial_number)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Fetch printer status via SNMP
async function fetchPrinterStatus(hostname, monitorId) {
  return new Promise((resolve) => {
    const session = snmp.createSession(hostname, 'public', {
      timeout: 5000,
      retries: 1,
      version: snmp.Version2c
    });

    const result = {
      monitorId,
      hostname,
      toner: { black: null, cyan: null, magenta: null, yellow: null, waste: null },
      paper: { level: null, tray1: null, tray2: null },
      error: { state: null, description: null },
      info: { pageCount: null, model: null, serialNumber: null }
    };

    const fetchData = async () => {
      try {
        // Get basic info
        let snmpResponsive = false;
        try {
          const basicOids = [PRINTER_OIDS.description, PRINTER_OIDS.serialNumber, PRINTER_OIDS.pageCount];
          const basicInfo = await snmpGet(session, basicOids);
          result.info.model = basicInfo[PRINTER_OIDS.description]?.toString() || null;
          result.info.serialNumber = basicInfo[PRINTER_OIDS.serialNumber]?.toString() || null;
          result.info.pageCount = basicInfo[PRINTER_OIDS.pageCount] || null;
          if (Object.keys(basicInfo).length > 0) snmpResponsive = true;
        } catch (e) {
          console.log(`SNMP basic info failed for ${hostname}: ${e.message}`);
        }

        // Get supplies (toner levels)
        try {
          const suppliesBase = '1.3.6.1.2.1.43.11.1.1';
          const supplies = await snmpWalk(session, suppliesBase);

          // Group by supply index
          // OID format: 1.3.6.1.2.1.43.11.1.1.{attr}.{deviceIdx}.{supplyIdx}
          // attr 6=description, 8=maxCapacity, 9=level
          const supplyData = {};
          supplies.forEach(item => {
            const parts = item.oid.split('.');
            const supplyIndex = parts[parts.length - 1];
            const attrType = parts[10]; // Attribute is at position 10 (0-indexed)

            if (!supplyData[supplyIndex]) supplyData[supplyIndex] = {};

            if (attrType === '6') supplyData[supplyIndex].description = item.value?.toString();
            if (attrType === '8') supplyData[supplyIndex].maxCapacity = item.value;
            if (attrType === '9') supplyData[supplyIndex].level = item.value;
          });

          // Map to toner colors
          Object.values(supplyData).forEach(supply => {
            const color = getSupplyColor(null, supply.description);
            const percentage = calculatePercentage(supply.level, supply.maxCapacity);

            if (color === 'black') result.toner.black = percentage;
            if (color === 'cyan') result.toner.cyan = percentage;
            if (color === 'magenta') result.toner.magenta = percentage;
            if (color === 'yellow') result.toner.yellow = percentage;
            if (color === 'waste') result.toner.waste = percentage;
          });
        } catch (e) {
          // Continue even if supplies fail
        }

        // Get paper tray levels
        try {
          const inputBase = '1.3.6.1.2.1.43.8.2.1';
          const inputs = await snmpWalk(session, inputBase);

          // OID format: 1.3.6.1.2.1.43.8.2.1.{attr}.{deviceIdx}.{trayIdx}
          // Base has indices 0-9, so attr is at index 10
          // attr 9=maxCapacity, 10=level, 18=description
          const trayData = {};
          inputs.forEach(item => {
            const parts = item.oid.split('.');
            const trayIndex = parts[parts.length - 1];
            const attrType = parts[10]; // Attribute is at position 10 (0-indexed)

            if (!trayData[trayIndex]) trayData[trayIndex] = {};

            if (attrType === '9') trayData[trayIndex].maxCapacity = item.value;
            if (attrType === '10') trayData[trayIndex].level = item.value;
            if (attrType === '18') trayData[trayIndex].description = item.value?.toString();
          });

          // Map to paper trays
          const trays = Object.values(trayData);
          if (trays[0]) result.paper.tray1 = calculatePercentage(trays[0].level, trays[0].maxCapacity);
          if (trays[1]) result.paper.tray2 = calculatePercentage(trays[1].level, trays[1].maxCapacity);

          // Calculate overall paper level
          const validTrays = [result.paper.tray1, result.paper.tray2].filter(t => t !== null);
          if (validTrays.length > 0) {
            result.paper.level = Math.round(validTrays.reduce((a, b) => a + b, 0) / validTrays.length);
          }
        } catch (e) {
          // Continue even if paper trays fail
        }

        // Get printer status/errors
        try {
          const statusOids = [PRINTER_OIDS.printerStatus, PRINTER_OIDS.deviceStatus];
          const statusInfo = await snmpGet(session, statusOids);

          const printerStatus = statusInfo[PRINTER_OIDS.printerStatus];
          const deviceStatus = statusInfo[PRINTER_OIDS.deviceStatus];

          // Interpret status codes
          const statusCodes = {
            1: 'other',
            2: 'unknown',
            3: 'idle',
            4: 'printing',
            5: 'warmup'
          };

          const deviceCodes = {
            1: 'unknown',
            2: 'running',
            3: 'warning',
            4: 'testing',
            5: 'down'
          };

          result.error.state = statusCodes[printerStatus] || deviceCodes[deviceStatus] || 'unknown';

          if (deviceStatus === 5 || deviceStatus === 3) {
            result.error.description = deviceStatus === 5 ? 'Printer is down' : 'Warning condition';
          }
        } catch (e) {
          // Continue even if status fails
        }

        // Get alerts
        try {
          const alertBase = '1.3.6.1.2.1.43.18.1.1';
          const alerts = await snmpWalk(session, alertBase);

          const alertDescriptions = alerts
            .filter(a => a.oid.includes('.8.'))
            .map(a => a.value?.toString())
            .filter(Boolean);

          if (alertDescriptions.length > 0) {
            result.error.description = alertDescriptions.join('; ');
          }
        } catch (e) {
          // Continue even if alerts fail
        }

        // Save to database only if we got some data
        const hasData = snmpResponsive || result.toner.black !== null || result.info.model !== null;
        if (hasData) {
          try {
            insertPrinterStatus.run(
              monitorId,
              result.toner.black,
              result.toner.cyan,
              result.toner.magenta,
              result.toner.yellow,
              result.toner.waste,
              result.paper.level,
              result.paper.tray1,
              result.paper.tray2,
              result.error.state,
              result.error.description,
              result.info.pageCount,
              result.info.model,
              result.info.serialNumber
            );
            console.log(`Saved printer status for ${hostname}`);
          } catch (e) {
            console.error('Error saving printer status:', e.message);
          }
        } else {
          console.log(`No SNMP response from printer ${hostname} - SNMP may be disabled`);
        }

        resolve(result);
      } catch (error) {
        console.error(`SNMP error for ${hostname}:`, error.message);
        resolve(result);
      } finally {
        session.close();
      }
    };

    fetchData();
  });
}

// Fetch status for all printers
async function fetchAllPrinterStatus() {
  const printers = db.prepare(`
    SELECT id, hostname FROM monitors WHERE device_type = 'printers' AND active = 1 AND hostname IS NOT NULL
  `).all();

  console.log(`Fetching SNMP data for ${printers.length} printers...`);

  for (const printer of printers) {
    try {
      await fetchPrinterStatus(printer.hostname, printer.id);
    } catch (e) {
      console.error(`Failed to fetch printer ${printer.hostname}:`, e.message);
    }
  }
}

// Schedule printer status fetch every 5 minutes
setInterval(fetchAllPrinterStatus, 5 * 60 * 1000);

// Initial fetch after startup
setTimeout(fetchAllPrinterStatus, 10000);

async function fetchPolyLensDevices() {
  const token = await getPolyLensToken();
  if (!token) return [];

  const allDevices = [];
  let hasNextPage = true;
  let nextToken = null;

  const query = `
    query($params: DeviceFindArgs) {
      deviceSearch(params: $params) {
        edges {
          node {
            id name displayName internalIp connected lastDetected
            hardwareFamily hardwareModel serialNumber softwareVersion
            room { name } site { name }
          }
        }
        pageInfo { totalCount hasNextPage nextToken }
      }
    }
  `;

  try {
    while (hasNextPage) {
      const response = await fetch(POLY_LENS_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query,
          variables: { params: { pageSize: 100, ...(nextToken && { nextToken }) } }
        })
      });

      if (!response.ok) throw new Error(`GraphQL failed: ${response.status}`);

      const data = await response.json();
      if (data.errors) break;

      const { edges, pageInfo } = data.data.deviceSearch;
      edges.forEach(edge => allDevices.push(edge.node));
      hasNextPage = pageInfo.hasNextPage;
      nextToken = pageInfo.nextToken;
    }

    polyLensDevices = allDevices;
    polyLensLastFetch = new Date();
    console.log(`Fetched ${allDevices.length} devices from Poly Lens`);

    // Record heartbeats for all devices
    allDevices.forEach(device => {
      // Determine floor based on room name or site
      const roomName = device.room?.name || '';
      let floor = 'Floor 1'; // Default floor

      // Try to extract floor from room name (e.g., "5th Floor Room" -> "Floor 5")
      const floorMatch = roomName.match(/(\d+)(?:st|nd|rd|th)?\s*floor/i);
      if (floorMatch) {
        floor = `Floor ${floorMatch[1]}`;
      }

      recordPolyDeviceHeartbeat(device, floor);
    });

    return allDevices;
  } catch (error) {
    console.error('Poly Lens fetch error:', error.message);
    return polyLensDevices;
  }
}

// ==================== AUTH ROUTES ====================

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password, totp_code } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  // Check if 2FA is enabled
  if (user.totp_enabled === 1) {
    if (!totp_code) {
      // Return that 2FA is required
      return res.json({
        success: false,
        requires_2fa: true,
        message: 'Two-factor authentication code required'
      });
    }

    // Verify the TOTP code
    if (!verifyTOTP(user.totp_secret, totp_code)) {
      return res.status(401).json({ success: false, error: 'Invalid 2FA code' });
    }
  }

  const token = createSession(user.id);

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    }
  });
});

// Logout
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    deleteSession(token);
  }
  res.json({ success: true });
});

// Get current user
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ==================== USER MANAGEMENT ROUTES ====================

// Get all users (admin only)
app.get('/api/users', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const users = db.prepare('SELECT id, username, role, created_at FROM users').all();
  res.json({ success: true, users });
});

// Create new user (admin only)
app.post('/api/users', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const { username, password, role } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
  }

  // Check if username exists
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ success: false, error: 'Username already exists' });
  }

  try {
    const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(
      username,
      password,
      role || 'user'
    );
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to create user' });
  }
});

// Update user (admin only)
app.put('/api/users/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const userId = parseInt(req.params.id);
  const { role, password } = req.body;

  // Prevent admin from demoting themselves
  if (userId === req.user.id && role === 'user') {
    return res.status(400).json({ success: false, error: 'Cannot demote yourself' });
  }

  try {
    if (password) {
      db.prepare('UPDATE users SET role = ?, password = ? WHERE id = ?').run(role, password, userId);
    } else {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

// Delete user (admin only)
app.delete('/api/users/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const userId = parseInt(req.params.id);

  // Prevent admin from deleting themselves
  if (userId === req.user.id) {
    return res.status(400).json({ success: false, error: 'Cannot delete yourself' });
  }

  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

// ==================== INCIDENTS ROUTES ====================

// Get all incidents
app.get('/api/incidents', authMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const incidents = db.prepare('SELECT * FROM incidents ORDER BY started_at DESC LIMIT ?').all(limit);
  res.json({ success: true, incidents });
});

// Create incident
app.post('/api/incidents', authMiddleware, (req, res) => {
  const { device_id, device_name, device_type, type, notes } = req.body;
  try {
    const result = db.prepare(`
      INSERT INTO incidents (device_id, device_name, device_type, type, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(device_id, device_name, device_type, type, notes);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to create incident' });
  }
});

// Resolve incident
app.put('/api/incidents/:id/resolve', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const incident = db.prepare('SELECT started_at FROM incidents WHERE id = ?').get(id);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incident not found' });
    }
    const duration = Math.round((Date.now() - new Date(incident.started_at).getTime()) / 60000);
    db.prepare('UPDATE incidents SET resolved_at = CURRENT_TIMESTAMP, duration_minutes = ? WHERE id = ?').run(duration, id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to resolve incident' });
  }
});

// ==================== ACTIVITY LOG ROUTES ====================

// Get activity log
app.get('/api/activity-log', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  const limit = parseInt(req.query.limit) || 100;
  const logs = db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json({ success: true, logs });
});

// Create activity log entry
app.post('/api/activity-log', authMiddleware, (req, res) => {
  const { action, details } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  try {
    db.prepare(`
      INSERT INTO activity_log (user_id, username, action, details, ip_address)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.user.id, req.user.username, action, details, ip);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to log activity' });
  }
});

// ==================== ZONES ROUTES ====================

// Get zones for a floor
app.get('/api/zones', (req, res) => {
  const floor = req.query.floor;
  let zones;
  if (floor) {
    zones = db.prepare('SELECT * FROM zones WHERE floor = ?').all(floor);
  } else {
    zones = db.prepare('SELECT * FROM zones').all();
  }
  res.json({ success: true, zones });
});

// Create zone
app.post('/api/zones', authMiddleware, (req, res) => {
  const { floor, name, x, y, width, height, color } = req.body;
  try {
    const result = db.prepare(`
      INSERT INTO zones (floor, name, x, y, width, height, color)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(floor, name, x, y, width, height, color || '#3B82F6');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to create zone' });
  }
});

// Update zone
app.put('/api/zones/:id', authMiddleware, (req, res) => {
  const { name, x, y, width, height, color } = req.body;
  try {
    db.prepare(`
      UPDATE zones SET name = ?, x = ?, y = ?, width = ?, height = ?, color = ?
      WHERE id = ?
    `).run(name, x, y, width, height, color, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to update zone' });
  }
});

// Delete zone
app.delete('/api/zones/:id', authMiddleware, (req, res) => {
  try {
    db.prepare('DELETE FROM zones WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to delete zone' });
  }
});

// ==================== API INTEGRATIONS ROUTES ====================

// Get all API integrations
app.get('/api/integrations', authMiddleware, (req, res) => {
  const integrations = db.prepare('SELECT id, name, type, client_id, active, created_at FROM api_integrations').all();
  res.json({ success: true, integrations });
});

// Get single API integration
app.get('/api/integrations/:id', authMiddleware, (req, res) => {
  const integration = db.prepare('SELECT * FROM api_integrations WHERE id = ?').get(req.params.id);
  if (!integration) {
    return res.status(404).json({ success: false, error: 'Integration not found' });
  }
  // Mask secret
  if (integration.client_secret) {
    integration.client_secret_masked = '********';
  }
  res.json({ success: true, integration });
});

// Add new API integration
app.post('/api/integrations', authMiddleware, (req, res) => {
  const { name, type, client_id, client_secret, webhook_url, config } = req.body;

  const result = db.prepare(`
    INSERT INTO api_integrations (name, type, client_id, client_secret, webhook_url, config)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, type, client_id, client_secret, webhook_url, config);

  res.json({ success: true, id: result.lastInsertRowid });
});

// Update API integration (admin only, or requires approval)
app.put('/api/integrations/:id', authMiddleware, (req, res) => {
  const { name, client_id, client_secret, webhook_url, config, active } = req.body;

  if (req.user.role !== 'admin') {
    // Create pending change for approval
    createPendingChange(req.user.id, 'update', 'api_integration', parseInt(req.params.id), req.body);
    return res.json({ success: true, pending: true, message: 'Change submitted for admin approval' });
  }

  db.prepare(`
    UPDATE api_integrations SET name = ?, client_id = ?, client_secret = ?, webhook_url = ?, config = ?, active = ?
    WHERE id = ?
  `).run(name, client_id, client_secret, webhook_url, config, active ?? 1, req.params.id);

  // Clear Poly Lens token if it's a poly_lens integration
  const integration = db.prepare('SELECT type FROM api_integrations WHERE id = ?').get(req.params.id);
  if (integration?.type === 'poly_lens') {
    polyLensToken = null;
    polyLensTokenExpiry = null;
  }

  res.json({ success: true });
});

// Delete API integration (admin only)
app.delete('/api/integrations/:id', authMiddleware, adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM api_integrations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== DEVICE TYPES ROUTES ====================

// Get all device types
app.get('/api/device-types', (req, res) => {
  const types = db.prepare('SELECT * FROM device_types').all();
  res.json({ success: true, types });
});

// Add custom device type
app.post('/api/device-types', authMiddleware, (req, res) => {
  const { name, icon, color } = req.body;

  try {
    const result = db.prepare(`
      INSERT INTO device_types (name, icon, color) VALUES (?, ?, ?)
    `).run(name, icon || '📟', color || '#6B7280');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ success: false, error: 'Device type already exists' });
  }
});

// ==================== PENDING CHANGES ROUTES ====================

// Get pending changes (admin only)
app.get('/api/pending-changes', authMiddleware, adminMiddleware, (req, res) => {
  const changes = getPendingChanges('pending');
  res.json({ success: true, changes });
});

// Get pending changes count
app.get('/api/pending-changes/count', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.json({ success: true, count: 0 });
  }
  const result = db.prepare("SELECT COUNT(*) as count FROM pending_changes WHERE status = 'pending'").get();
  res.json({ success: true, count: result.count });
});

// Approve pending change (admin only)
app.post('/api/pending-changes/:id/approve', authMiddleware, adminMiddleware, (req, res) => {
  const result = approvePendingChange(parseInt(req.params.id), req.user.id);
  res.json(result);
});

// Reject pending change (admin only)
app.post('/api/pending-changes/:id/reject', authMiddleware, adminMiddleware, (req, res) => {
  const result = rejectPendingChange(parseInt(req.params.id), req.user.id);
  res.json(result);
});

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
  const monitorCount = db.prepare('SELECT COUNT(*) as count FROM monitors WHERE active = 1').get().count;
  res.json({
    status: 'ok',
    monitors: monitorCount,
    polyLens: {
      configured: !!(POLY_LENS_CLIENT_ID && POLY_LENS_CLIENT_SECRET),
      deviceCount: polyLensDevices.length,
      lastFetch: polyLensLastFetch
    },
    uptime: process.uptime()
  });
});

// Get all monitors with current status
app.get('/api/monitors', (req, res) => {
  const monitors = db.prepare('SELECT * FROM monitors WHERE active = 1').all();

  const result = monitors.map(m => {
    const lastHeartbeat = db.prepare(`
      SELECT * FROM heartbeats WHERE monitor_id = ? ORDER BY time DESC LIMIT 1
    `).get(m.id);

    const state = monitorStatus.get(m.id);

    return {
      ...m,
      status: lastHeartbeat?.status === 1 ? 'up' : 'down',
      lastCheck: lastHeartbeat?.time,
      ping: lastHeartbeat?.ping,
      message: lastHeartbeat?.message,
      lastStatusChange: state?.lastChange
    };
  });

  res.json({ success: true, monitors: result });
});

// Get monitors grouped by floor
app.get('/api/monitors/by-floor', (req, res) => {
  const monitors = db.prepare('SELECT * FROM monitors WHERE active = 1').all();

  const floors = {
    '1st Floor': { accessPoints: [], printers: [], polyLens: [] },
    '2nd Floor': { accessPoints: [], printers: [], polyLens: [] },
    '3rd Floor': { accessPoints: [], printers: [], polyLens: [] },
    '5th Floor': { accessPoints: [], printers: [], polyLens: [] }
  };

  monitors.forEach(m => {
    const lastHeartbeat = db.prepare(`
      SELECT * FROM heartbeats WHERE monitor_id = ? ORDER BY time DESC LIMIT 1
    `).get(m.id);

    const device = {
      id: m.id,
      name: m.name,
      ip: m.hostname || m.url,
      status: lastHeartbeat?.status === 1 ? 'up' : 'down',
      lastCheck: lastHeartbeat?.time,
      ping: lastHeartbeat?.ping,
      pos_x: m.pos_x,
      pos_y: m.pos_y
    };

    const floor = m.floor;
    const deviceType = m.device_type || 'polyLens';

    if (floor && floors[floor]) {
      if (deviceType === 'accessPoints' || deviceType === 'ap') {
        floors[floor].accessPoints.push(device);
      } else if (deviceType === 'printers' || deviceType === 'printer') {
        floors[floor].printers.push(device);
      } else {
        floors[floor].polyLens.push(device);
      }
    }
  });

  res.json({ success: true, connected: true, floors });
});

// Get monitor history
app.get('/api/monitors/:id/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const heartbeats = db.prepare(`
    SELECT * FROM heartbeats WHERE monitor_id = ? ORDER BY time DESC LIMIT ?
  `).all(req.params.id, limit);

  res.json({ success: true, heartbeats });
});

// Get all heartbeats (for analytics export)
app.get('/api/heartbeats', authMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 1000;
  const hours = parseInt(req.query.hours) || 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const heartbeats = db.prepare(`
    SELECT h.*, m.name as monitor_name
    FROM heartbeats h
    LEFT JOIN monitors m ON h.monitor_id = m.id
    WHERE h.time >= ?
    ORDER BY h.time DESC
    LIMIT ?
  `).all(since, limit);

  res.json({ success: true, heartbeats });
});

// Get uptime stats
app.get('/api/monitors/:id/uptime', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as up_count
    FROM heartbeats
    WHERE monitor_id = ? AND time >= ?
  `).get(req.params.id, since);

  const uptime = stats.total > 0 ? (stats.up_count / stats.total) * 100 : 0;

  res.json({
    success: true,
    hours,
    total: stats.total,
    upCount: stats.up_count,
    uptime: uptime.toFixed(2)
  });
});

// Printer status endpoints
app.get('/api/printers/:id/status', (req, res) => {
  const status = db.prepare(`
    SELECT * FROM printer_status WHERE monitor_id = ? ORDER BY time DESC LIMIT 1
  `).get(req.params.id);

  if (!status) {
    return res.json({
      success: true,
      status: null,
      message: 'No printer status data available yet'
    });
  }

  res.json({
    success: true,
    status: {
      toner: {
        black: status.toner_black,
        cyan: status.toner_cyan,
        magenta: status.toner_magenta,
        yellow: status.toner_yellow,
        waste: status.toner_waste
      },
      paper: {
        level: status.paper_level,
        tray1: status.paper_tray1,
        tray2: status.paper_tray2
      },
      error: {
        state: status.error_state,
        description: status.error_description
      },
      info: {
        pageCount: status.page_count,
        model: status.model,
        serialNumber: status.serial_number
      },
      time: status.time
    }
  });
});

app.get('/api/printers/:id/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const history = db.prepare(`
    SELECT * FROM printer_status WHERE monitor_id = ? ORDER BY time DESC LIMIT ?
  `).all(req.params.id, limit);

  res.json({
    success: true,
    history: history.map(h => ({
      toner: {
        black: h.toner_black,
        cyan: h.toner_cyan,
        magenta: h.toner_magenta,
        yellow: h.toner_yellow,
        waste: h.toner_waste
      },
      paper: {
        level: h.paper_level,
        tray1: h.paper_tray1,
        tray2: h.paper_tray2
      },
      error: {
        state: h.error_state,
        description: h.error_description
      },
      pageCount: h.page_count,
      time: h.time
    }))
  });
});

// Manually refresh printer status
app.post('/api/printers/:id/refresh', authMiddleware, async (req, res) => {
  const monitor = db.prepare('SELECT hostname FROM monitors WHERE id = ?').get(req.params.id);

  if (!monitor || !monitor.hostname) {
    return res.status(404).json({ success: false, error: 'Printer not found' });
  }

  try {
    const status = await fetchPrinterStatus(monitor.hostname, parseInt(req.params.id));
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Poly Lens endpoints
app.get('/api/poly-lens/devices', async (req, res) => {
  if (req.query.refresh || !polyLensLastFetch || Date.now() - polyLensLastFetch > 60000) {
    await fetchPolyLensDevices();
  }

  res.json({
    success: true,
    deviceCount: polyLensDevices.length,
    lastFetch: polyLensLastFetch,
    devices: polyLensDevices.map(d => ({
      id: d.id,
      name: d.name,
      ip: d.internalIp,
      connected: d.connected,
      lastDetected: d.lastDetected,
      hardwareModel: d.hardwareModel,
      room: d.room?.name,
      floor: d.site?.name
    }))
  });
});

app.get('/api/poly-lens/by-floor', async (req, res) => {
  if (req.query.refresh || !polyLensLastFetch || Date.now() - polyLensLastFetch > 60000) {
    await fetchPolyLensDevices();
  }

  // Get maintenance status from database for all Poly devices
  const maintenanceDevices = db.prepare(`
    SELECT device_id, maintenance, maintenance_note, maintenance_until
    FROM poly_devices WHERE maintenance = 1
  `).all();
  const maintenanceMap = {};
  maintenanceDevices.forEach(d => { maintenanceMap[d.device_id] = d; });

  const floors = {
    '1st Floor': [],
    '2nd Floor': [],
    '3rd Floor': [],
    '5th Floor': []
  };

  polyLensDevices.forEach(device => {
    const floor = device.site?.name;
    const maintenanceInfo = maintenanceMap[device.id];
    if (floor && floors[floor]) {
      floors[floor].push({
        id: device.id,
        name: device.name,
        ip: device.internalIp,
        connected: device.connected,
        status: device.connected ? 'up' : 'down',
        lastDetected: device.lastDetected,
        hardwareModel: device.hardwareModel,
        room: device.room?.name,
        maintenance: maintenanceInfo ? 1 : 0,
        maintenance_note: maintenanceInfo?.maintenance_note,
        maintenance_until: maintenanceInfo?.maintenance_until
      });
    }
  });

  res.json({
    success: true,
    deviceCount: polyLensDevices.length,
    lastFetch: polyLensLastFetch,
    floors
  });
});

// Get Poly device from database by device_id (Poly Lens ID)
app.get('/api/poly-devices/:deviceId', (req, res) => {
  // Handle the maintenance list route first
  if (req.params.deviceId === 'maintenance') {
    const devices = db.prepare(`
      SELECT device_id, name, room, floor, maintenance_note, maintenance_until
      FROM poly_devices WHERE maintenance = 1
    `).all();
    return res.json({ success: true, devices });
  }

  const device = db.prepare(`
    SELECT * FROM poly_devices WHERE device_id = ?
  `).get(req.params.deviceId);

  if (!device) {
    return res.status(404).json({ success: false, error: 'Device not found' });
  }

  res.json({ success: true, device });
});

// Get Poly device history (heartbeats)
app.get('/api/poly-devices/:deviceId/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;

  // First get the database ID from the Poly Lens device_id
  const device = db.prepare('SELECT id FROM poly_devices WHERE device_id = ?').get(req.params.deviceId);

  if (!device) {
    return res.status(404).json({ success: false, error: 'Device not found' });
  }

  const heartbeats = db.prepare(`
    SELECT id, connected as status, ip_address as ip, time
    FROM poly_heartbeats
    WHERE poly_device_id = ?
    ORDER BY time DESC
    LIMIT ?
  `).all(device.id, limit);

  res.json({ success: true, heartbeats });
});

// Get Poly device uptime stats
app.get('/api/poly-devices/:deviceId/uptime', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // First get the database ID from the Poly Lens device_id
  const device = db.prepare('SELECT id FROM poly_devices WHERE device_id = ?').get(req.params.deviceId);

  if (!device) {
    return res.status(404).json({ success: false, error: 'Device not found' });
  }

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN connected = 1 THEN 1 ELSE 0 END) as up_count
    FROM poly_heartbeats
    WHERE poly_device_id = ? AND time >= ?
  `).get(device.id, since);

  const uptime = stats.total > 0 ? (stats.up_count / stats.total) * 100 : 0;

  res.json({
    success: true,
    hours,
    total: stats.total,
    upCount: stats.up_count,
    uptime: uptime.toFixed(2)
  });
});

// Get all Poly devices from database with their current status
app.get('/api/poly-devices', (req, res) => {
  const devices = db.prepare(`
    SELECT * FROM poly_devices ORDER BY room, name
  `).all();

  res.json({ success: true, devices });
});

// Toggle maintenance mode for a Poly device
app.patch('/api/poly-devices/:deviceId/maintenance', authMiddleware, (req, res) => {
  const { maintenance, note, until } = req.body;
  const device = db.prepare('SELECT * FROM poly_devices WHERE device_id = ?').get(req.params.deviceId);

  if (!device) {
    return res.status(404).json({ success: false, error: 'Poly device not found' });
  }

  db.prepare(`
    UPDATE poly_devices SET
      maintenance = ?,
      maintenance_note = ?,
      maintenance_until = ?
    WHERE device_id = ?
  `).run(
    maintenance ? 1 : 0,
    note || null,
    until || null,
    req.params.deviceId
  );

  const action = maintenance ? 'entered' : 'exited';
  console.log(`Poly device ${device.name} ${action} maintenance mode${note ? `: ${note}` : ''}`);

  res.json({ success: true, maintenance: maintenance ? 1 : 0 });
});

// Disable/enable a poly device
app.patch('/api/poly-devices/:deviceId/disable', authMiddleware, (req, res) => {
  const { disabled } = req.body;
  const device = db.prepare('SELECT * FROM poly_devices WHERE device_id = ?').get(req.params.deviceId);

  if (!device) {
    return res.status(404).json({ success: false, error: 'Poly device not found' });
  }

  db.prepare('UPDATE poly_devices SET disabled = ? WHERE device_id = ?')
    .run(disabled ? 1 : 0, req.params.deviceId);

  const action = disabled ? 'disabled' : 'enabled';
  console.log(`Poly device ${device.name} ${action}`);

  res.json({ success: true, disabled: disabled ? 1 : 0 });
});


// Add a new monitor (any authenticated user can add)
app.post('/api/monitors', authMiddleware, (req, res) => {
  const { name, type, hostname, url, floor, device_type } = req.body;

  const stmt = db.prepare(`
    INSERT INTO monitors (name, type, hostname, url, floor, device_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(name, type || 'ping', hostname, url, floor, device_type);

  res.json({ success: true, id: result.lastInsertRowid });
});

// Delete a monitor (admin only, or requires approval)
app.delete('/api/monitors/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    // Create pending change for approval
    const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
    createPendingChange(req.user.id, 'delete', 'monitor', parseInt(req.params.id), monitor);
    return res.json({ success: true, pending: true, message: 'Delete request submitted for admin approval' });
  }

  db.prepare('DELETE FROM heartbeats WHERE monitor_id = ?').run(req.params.id);
  db.prepare('DELETE FROM monitors WHERE id = ?').run(req.params.id);
  monitorStatus.delete(parseInt(req.params.id));

  res.json({ success: true });
});

// Get single monitor
app.get('/api/monitors/:id', (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) {
    return res.status(404).json({ success: false, error: 'Monitor not found' });
  }
  res.json({ success: true, monitor });
});

// Ping a host (quick action)
app.get('/api/monitors/ping/:host', authMiddleware, async (req, res) => {
  try {
    const host = decodeURIComponent(req.params.host);
    const result = await ping.promise.probe(host, { timeout: 5 });
    res.json({
      success: true,
      host: host,
      alive: result.alive,
      time: result.time
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Update a monitor (admin only, or requires approval)
app.put('/api/monitors/:id', authMiddleware, (req, res) => {
  const { name, type, hostname, url, floor, device_type, active, interval } = req.body;
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);

  if (!monitor) {
    return res.status(404).json({ success: false, error: 'Monitor not found' });
  }

  if (req.user.role !== 'admin') {
    // Create pending change for approval
    createPendingChange(req.user.id, 'update', 'monitor', parseInt(req.params.id), req.body);
    return res.json({ success: true, pending: true, message: 'Change submitted for admin approval' });
  }

  db.prepare(`
    UPDATE monitors SET
      name = ?, type = ?, hostname = ?, url = ?, floor = ?,
      device_type = ?, active = ?, interval = ?
    WHERE id = ?
  `).run(
    name ?? monitor.name,
    type ?? monitor.type,
    hostname ?? monitor.hostname,
    url ?? monitor.url,
    floor ?? monitor.floor,
    device_type ?? monitor.device_type,
    active ?? monitor.active,
    interval ?? monitor.interval,
    req.params.id
  );

  res.json({ success: true });
});

// Update monitor position (any authenticated user)
app.patch('/api/monitors/:id/position', authMiddleware, (req, res) => {
  const { pos_x, pos_y, tv_mode } = req.body;

  if (tv_mode) {
    db.prepare('UPDATE monitors SET tv_pos_x = ?, tv_pos_y = ? WHERE id = ?')
      .run(pos_x, pos_y, req.params.id);
  } else {
    db.prepare('UPDATE monitors SET pos_x = ?, pos_y = ? WHERE id = ?')
      .run(pos_x, pos_y, req.params.id);
  }

  res.json({ success: true });
});

// Update monitor 3D position (includes height)
app.patch('/api/monitors/:id/position-3d', authMiddleware, (req, res) => {
  const { pos_x, pos_y, pos_z } = req.body;

  db.prepare('UPDATE monitors SET pos_x = ?, pos_y = ?, pos_z = ? WHERE id = ?')
    .run(pos_x, pos_y, pos_z, req.params.id);

  logActivity(req, 'update_3d_position', 'monitor', req.params.id);
  res.json({ success: true });
});

// Update room 3D position (includes height)
app.patch('/api/room-positions/:roomId/position-3d', authMiddleware, (req, res) => {
  const { pos_x, pos_y, pos_z, floor } = req.body;
  const roomId = req.params.roomId;

  db.prepare(`
    INSERT INTO room_positions (room_id, floor, pos_x, pos_y, pos_z, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(room_id) DO UPDATE SET
      pos_x = excluded.pos_x,
      pos_y = excluded.pos_y,
      pos_z = excluded.pos_z,
      floor = excluded.floor,
      updated_at = CURRENT_TIMESTAMP
  `).run(roomId, floor, pos_x, pos_y, pos_z);

  logActivity(req, 'update_3d_position', 'room', roomId);
  res.json({ success: true });
});

// Toggle maintenance mode for a monitor
app.patch('/api/monitors/:id/maintenance', authMiddleware, (req, res) => {
  const { maintenance, note, until } = req.body;
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);

  if (!monitor) {
    return res.status(404).json({ success: false, error: 'Monitor not found' });
  }

  db.prepare(`
    UPDATE monitors SET
      maintenance = ?,
      maintenance_note = ?,
      maintenance_until = ?
    WHERE id = ?
  `).run(
    maintenance ? 1 : 0,
    note || null,
    until || null,
    req.params.id
  );

  const action = maintenance ? 'entered' : 'exited';
  console.log(`${monitor.name} ${action} maintenance mode${note ? `: ${note}` : ''}`);

  res.json({ success: true, maintenance: maintenance ? 1 : 0 });
});

// Get all devices in maintenance mode
app.get('/api/monitors/maintenance', (req, res) => {
  const monitors = db.prepare(`
    SELECT id, name, floor, device_type, maintenance_note, maintenance_until
    FROM monitors WHERE maintenance = 1
  `).all();

  res.json({ success: true, monitors });
});

// Toggle disabled status for a monitor (non-serviceable devices)
app.patch('/api/monitors/:id/disable', authMiddleware, (req, res) => {
  const { disabled } = req.body;
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);

  if (!monitor) {
    return res.status(404).json({ success: false, error: 'Monitor not found' });
  }

  db.prepare('UPDATE monitors SET disabled = ? WHERE id = ?')
    .run(disabled ? 1 : 0, req.params.id);

  console.log(`${monitor.name} ${disabled ? 'disabled' : 'enabled'} (non-serviceable)`);

  res.json({ success: true, disabled: disabled ? 1 : 0 });
});

// Get all disabled devices
app.get('/api/monitors/disabled', (req, res) => {
  const monitors = db.prepare(`
    SELECT id, name, floor, device_type
    FROM monitors WHERE disabled = 1
  `).all();

  res.json({ success: true, monitors });
});

// ==================== THRESHOLD ALERTS ====================

// Check printer thresholds and send alerts
async function checkPrinterThresholds() {
  const printers = db.prepare(`
    SELECT m.*, ps.toner_black, ps.toner_cyan, ps.toner_magenta, ps.toner_yellow,
           ps.paper_level, ps.paper_tray1, ps.paper_tray2
    FROM monitors m
    LEFT JOIN (
      SELECT monitor_id, toner_black, toner_cyan, toner_magenta, toner_yellow,
             paper_level, paper_tray1, paper_tray2
      FROM printer_status
      WHERE id IN (SELECT MAX(id) FROM printer_status GROUP BY monitor_id)
    ) ps ON m.id = ps.monitor_id
    WHERE m.device_type = 'printers' AND m.active = 1
  `).all();

  for (const printer of printers) {
    // Skip if in maintenance mode
    if (printer.maintenance === 1) continue;

    // Check toner levels (alert at 20%)
    const tonerColors = ['black', 'cyan', 'magenta', 'yellow'];
    for (const color of tonerColors) {
      const level = printer[`toner_${color}`];
      if (level !== null && level <= 20) {
        await sendThresholdAlert(printer, `toner_${color}`, level, 20);
      } else if (level !== null && level > 25) {
        resolveThresholdAlert(printer.id, `toner_${color}`);
      }
    }

    // Paper tray levels are shown in dashboard only (no Slack notifications)
    // Low paper indicators appear in the printer analytics sidebar
  }
}

// Send threshold alert (only if not already sent)
async function sendThresholdAlert(monitor, alertType, currentValue, threshold) {
  // Check if we already have an active alert for this
  const existingAlert = db.prepare(`
    SELECT * FROM threshold_alerts
    WHERE monitor_id = ? AND alert_type = ? AND resolved_at IS NULL
  `).get(monitor.id, alertType);

  if (existingAlert) {
    return; // Already alerted
  }

  // Record the alert
  db.prepare(`
    INSERT INTO threshold_alerts (monitor_id, alert_type, alert_value)
    VALUES (?, ?, ?)
  `).run(monitor.id, alertType, currentValue);

  // Send Slack alert
  const webhookUrl = getSetting('slack_webhook_url');
  const slackEnabled = getSetting('slack_enabled');
  const slackChannel = getSetting('slack_channel');

  if (!webhookUrl || slackEnabled !== '1') return;

  const alertTypeDisplay = alertType.replace('_', ' ').replace('toner ', 'Toner ').replace('paper ', 'Paper ');
  const emoji = currentValue <= 10 ? ':rotating_light:' : ':warning:';

  const payload = {
    channel: slackChannel,
    attachments: [{
      color: currentValue <= 10 ? '#EF4444' : '#F59E0B',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} *${monitor.name}* - Low ${alertTypeDisplay}`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `*Current Level:* ${currentValue}% | *Threshold:* ${threshold}% | *Floor:* ${monitor.floor || 'N/A'}`
            }
          ]
        }
      ]
    }]
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log(`Threshold alert sent: ${monitor.name} - ${alertType} at ${currentValue}%`);
  } catch (e) {
    console.error('Threshold alert error:', e.message);
  }
}

// Resolve threshold alert when level is back to normal
function resolveThresholdAlert(monitorId, alertType) {
  db.prepare(`
    UPDATE threshold_alerts
    SET resolved_at = CURRENT_TIMESTAMP
    WHERE monitor_id = ? AND alert_type = ? AND resolved_at IS NULL
  `).run(monitorId, alertType);
}

// Get active threshold alerts (not resolved and not dismissed)
app.get('/api/threshold-alerts', (req, res) => {
  const alerts = db.prepare(`
    SELECT ta.*, m.name as monitor_name, m.floor
    FROM threshold_alerts ta
    JOIN monitors m ON ta.monitor_id = m.id
    WHERE ta.resolved_at IS NULL AND ta.dismissed_at IS NULL
    ORDER BY ta.sent_at DESC
  `).all();

  res.json({ success: true, alerts });
});

// Dismiss a threshold alert
app.patch('/api/threshold-alerts/:id/dismiss', authMiddleware, (req, res) => {
  const alert = db.prepare('SELECT * FROM threshold_alerts WHERE id = ?').get(req.params.id);

  if (!alert) {
    return res.status(404).json({ success: false, error: 'Alert not found' });
  }

  db.prepare(`
    UPDATE threshold_alerts
    SET dismissed_at = datetime('now'), dismissed_by = ?
    WHERE id = ?
  `).run(req.user?.username || 'unknown', req.params.id);

  console.log(`Alert ${req.params.id} dismissed by ${req.user?.username || 'unknown'}`);
  res.json({ success: true });
});

// Dismiss all threshold alerts
app.post('/api/threshold-alerts/dismiss-all', authMiddleware, (req, res) => {
  const result = db.prepare(`
    UPDATE threshold_alerts
    SET dismissed_at = datetime('now'), dismissed_by = ?
    WHERE resolved_at IS NULL AND dismissed_at IS NULL
  `).run(req.user?.username || 'unknown');

  console.log(`${result.changes} alerts dismissed by ${req.user?.username || 'unknown'}`);
  res.json({ success: true, dismissed: result.changes });
});

// Schedule threshold checks every 5 minutes (after printer status fetch)
setInterval(checkPrinterThresholds, 5 * 60 * 1000);
setTimeout(checkPrinterThresholds, 30000); // Initial check after 30 seconds

// ==================== ROOM POSITIONS ====================

// Get all room positions
app.get('/api/room-positions', (req, res) => {
  const positions = db.prepare('SELECT * FROM room_positions').all();
  const posMap = {};
  positions.forEach(p => { posMap[p.room_id] = p; });
  res.json({ success: true, positions: posMap });
});

// Get room positions by floor
app.get('/api/room-positions/:floor', (req, res) => {
  const positions = db.prepare('SELECT * FROM room_positions WHERE floor = ?').all(req.params.floor);
  const posMap = {};
  positions.forEach(p => { posMap[p.room_id] = p; });
  res.json({ success: true, positions: posMap });
});

// Save room position (supports both regular and TV mode positions)
app.patch('/api/room-positions/:roomId', authMiddleware, (req, res) => {
  const { pos_x, pos_y, floor, tv_mode } = req.body;
  const roomId = req.params.roomId;

  if (tv_mode) {
    // Update TV mode positions only
    db.prepare(`
      INSERT INTO room_positions (room_id, floor, pos_x, pos_y, tv_pos_x, tv_pos_y, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(room_id) DO UPDATE SET
        tv_pos_x = excluded.tv_pos_x,
        tv_pos_y = excluded.tv_pos_y,
        floor = excluded.floor,
        updated_at = CURRENT_TIMESTAMP
    `).run(roomId, floor, pos_x, pos_y, pos_x, pos_y);
  } else {
    // Update regular positions only
    db.prepare(`
      INSERT INTO room_positions (room_id, floor, pos_x, pos_y, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(room_id) DO UPDATE SET
        pos_x = excluded.pos_x,
        pos_y = excluded.pos_y,
        floor = excluded.floor,
        updated_at = CURRENT_TIMESTAMP
    `).run(roomId, floor, pos_x, pos_y);
  }

  res.json({ success: true });
});

// Toggle monitor active status (admin only)
app.patch('/api/monitors/:id/toggle', authMiddleware, adminMiddleware, (req, res) => {
  const monitor = db.prepare('SELECT active FROM monitors WHERE id = ?').get(req.params.id);

  if (!monitor) {
    return res.status(404).json({ success: false, error: 'Monitor not found' });
  }

  const newActive = monitor.active === 1 ? 0 : 1;
  db.prepare('UPDATE monitors SET active = ? WHERE id = ?').run(newActive, req.params.id);

  res.json({ success: true, active: newActive });
});

// ==================== SETTINGS ENDPOINTS ====================

// Get all settings
app.get('/api/settings', (req, res) => {
  const settings = getAllSettings();
  // Mask sensitive values
  if (settings.slack_webhook_url) {
    settings.slack_webhook_url_masked = settings.slack_webhook_url.replace(/\/[^\/]+$/, '/****');
  }
  if (settings.poly_lens_client_secret) {
    settings.poly_lens_client_secret_masked = '********';
  }
  res.json({ success: true, settings });
});

// Update settings (supports both PUT and POST)
function updateSettings(req, res) {
  const allowedKeys = [
    'slack_webhook_url', 'slack_channel', 'slack_enabled', 'slack_username',
    'slack_notify_offline', 'slack_notify_online', 'slack_notify_maintenance',
    'slack_notify_slow', 'slack_slow_threshold',
    'slack_quiet_enabled', 'slack_quiet_start', 'slack_quiet_end',
    'slack_cooldown',
    'poly_lens_client_id', 'poly_lens_client_secret',
    'check_interval', 'ping_timeout'
  ];

  const updates = req.body;

  Object.entries(updates).forEach(([key, value]) => {
    if (allowedKeys.includes(key)) {
      setSetting(key, value);
    }
  });

  // Clear Poly Lens token if credentials changed
  if (updates.poly_lens_client_id || updates.poly_lens_client_secret) {
    polyLensToken = null;
    polyLensTokenExpiry = null;
  }

  res.json({ success: true });
}

app.put('/api/settings', updateSettings);
app.post('/api/settings', updateSettings);

// Test Slack notification
app.post('/api/settings/test-slack', async (req, res) => {
  const webhookUrl = getSetting('slack_webhook_url');
  const slackChannel = getSetting('slack_channel');

  if (!webhookUrl) {
    return res.status(400).json({ success: false, error: 'Slack webhook URL not configured' });
  }

  const payload = {
    channel: slackChannel,
    attachments: [{
      color: '#3B82F6',
      blocks: [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':bell: *Test Notification*\nThis is a test message from Office Monitor.'
        }
      }]
    }]
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      res.json({ success: true, message: 'Test notification sent' });
    } else {
      res.status(400).json({ success: false, error: `Slack API returned ${response.status}` });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== FLOOR PLAN ENDPOINTS ====================

// Get all floor plans
app.get('/api/floor-plans', (req, res) => {
  const plans = db.prepare('SELECT floor, image_type, updated_at FROM floor_plans').all();
  res.json({ success: true, plans });
});

// Get specific floor plan
app.get('/api/floor-plans/:floor', (req, res) => {
  const plan = db.prepare('SELECT * FROM floor_plans WHERE floor = ?').get(req.params.floor);

  if (!plan) {
    return res.status(404).json({ success: false, error: 'Floor plan not found' });
  }

  res.json({ success: true, plan });
});

// Upload/update floor plan
app.put('/api/floor-plans/:floor', (req, res) => {
  const { image_data, image_type } = req.body;
  const floor = req.params.floor;

  if (!image_data || !image_type) {
    return res.status(400).json({ success: false, error: 'image_data and image_type required' });
  }

  db.prepare(`
    INSERT INTO floor_plans (floor, image_data, image_type, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(floor) DO UPDATE SET
      image_data = excluded.image_data,
      image_type = excluded.image_type,
      updated_at = CURRENT_TIMESTAMP
  `).run(floor, image_data, image_type);

  res.json({ success: true });
});

// Delete floor plan
app.delete('/api/floor-plans/:floor', (req, res) => {
  db.prepare('DELETE FROM floor_plans WHERE floor = ?').run(req.params.floor);
  res.json({ success: true });
});

// ==================== STARTUP ====================

// Start monitoring loop
setInterval(runAllChecks, CHECK_INTERVAL);

// Initial data fetch
setTimeout(async () => {
  await runAllChecks();
  isFirstRun = false; // Allow alerts after first run
  console.log('Initial checks complete, alerts now enabled');
  if (POLY_LENS_CLIENT_ID) {
    await fetchPolyLensDevices();
  }
}, 2000);

// Refresh Poly Lens every 5 minutes
setInterval(fetchPolyLensDevices, 5 * 60 * 1000);

// ==================== ACTIVITY LOG ====================

// Log activity helper function
function logActivity(req, action, entityType = null, entityId = null, entityName = null, details = null) {
  try {
    const username = req.user?.username || 'system';
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    db.prepare(`
      INSERT INTO activity_log (username, action, entity_type, entity_id, entity_name, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(username, action, entityType, entityId, entityName, details ? JSON.stringify(details) : null, ip);
  } catch (e) {
    console.error('Failed to log activity:', e);
  }
}

// Get activity log
app.get('/api/activity-log', authMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const username = req.query.username;
  const action = req.query.action;

  let query = 'SELECT * FROM activity_log WHERE 1=1';
  const params = [];

  if (username) {
    query += ' AND username = ?';
    params.push(username);
  }
  if (action) {
    query += ' AND action LIKE ?';
    params.push(`%${action}%`);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const logs = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM activity_log').get().count;

  res.json({ success: true, logs, total, limit, offset });
});

// ==================== INCIDENTS ====================

// Get incidents
app.get('/api/incidents', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const status = req.query.status; // 'active', 'resolved', 'all'
  const floor = req.query.floor;

  let query = 'SELECT * FROM incidents WHERE 1=1';
  const params = [];

  if (status === 'active') {
    query += ' AND ended_at IS NULL';
  } else if (status === 'resolved') {
    query += ' AND ended_at IS NOT NULL';
  }

  if (floor) {
    query += ' AND floor = ?';
    params.push(floor);
  }

  query += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const incidents = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM incidents' + (status === 'active' ? ' WHERE ended_at IS NULL' : '')).get().count;

  res.json({ success: true, incidents, total, limit, offset });
});

// Acknowledge incident
app.patch('/api/incidents/:id/acknowledge', authMiddleware, (req, res) => {
  const { notes } = req.body;

  db.prepare(`
    UPDATE incidents SET
      acknowledged_by = ?,
      acknowledged_at = datetime('now'),
      resolution_notes = COALESCE(resolution_notes, '') || ?
    WHERE id = ?
  `).run(req.user?.username, notes ? '\n' + notes : '', req.params.id);

  logActivity(req, 'acknowledge_incident', 'incident', req.params.id, null, { notes });
  res.json({ success: true });
});

// Add resolution notes
app.patch('/api/incidents/:id/resolve', authMiddleware, (req, res) => {
  const { notes } = req.body;

  db.prepare(`
    UPDATE incidents SET resolution_notes = ? WHERE id = ?
  `).run(notes, req.params.id);

  logActivity(req, 'add_incident_notes', 'incident', req.params.id, null, { notes });
  res.json({ success: true });
});

// ==================== DEVICE TAGS ====================

// Get all tags
app.get('/api/tags', (req, res) => {
  const tags = db.prepare('SELECT * FROM device_tags ORDER BY priority DESC, name').all();
  res.json({ success: true, tags });
});

// Create tag
app.post('/api/tags', authMiddleware, (req, res) => {
  const { name, color, priority } = req.body;

  if (!name) {
    return res.status(400).json({ success: false, error: 'Name is required' });
  }

  try {
    const result = db.prepare('INSERT INTO device_tags (name, color, priority) VALUES (?, ?, ?)').run(name, color || '#3B82F6', priority || 0);
    logActivity(req, 'create_tag', 'tag', result.lastInsertRowid, name);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ success: false, error: 'Tag already exists' });
  }
});

// Update tag
app.put('/api/tags/:id', authMiddleware, (req, res) => {
  const { name, color, priority } = req.body;

  db.prepare('UPDATE device_tags SET name = ?, color = ?, priority = ? WHERE id = ?').run(name, color, priority, req.params.id);
  logActivity(req, 'update_tag', 'tag', req.params.id, name);
  res.json({ success: true });
});

// Delete tag
app.delete('/api/tags/:id', authMiddleware, (req, res) => {
  const tag = db.prepare('SELECT * FROM device_tags WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM device_tags WHERE id = ?').run(req.params.id);
  logActivity(req, 'delete_tag', 'tag', req.params.id, tag?.name);
  res.json({ success: true });
});

// Assign tags to monitor
app.post('/api/monitors/:id/tags', authMiddleware, (req, res) => {
  const { tagIds } = req.body;
  const monitorId = req.params.id;

  // Clear existing tags
  db.prepare('DELETE FROM monitor_tags WHERE monitor_id = ?').run(monitorId);

  // Add new tags
  const insert = db.prepare('INSERT INTO monitor_tags (monitor_id, tag_id) VALUES (?, ?)');
  tagIds?.forEach(tagId => insert.run(monitorId, tagId));

  logActivity(req, 'assign_tags', 'monitor', monitorId, null, { tagIds });
  res.json({ success: true });
});

// Get tags for a monitor
app.get('/api/monitors/:id/tags', (req, res) => {
  const tags = db.prepare(`
    SELECT t.* FROM device_tags t
    JOIN monitor_tags mt ON t.id = mt.tag_id
    WHERE mt.monitor_id = ?
  `).all(req.params.id);
  res.json({ success: true, tags });
});

// ==================== NOTIFICATION CENTER ====================

// Get user notifications (for notification center UI)
app.get('/api/user-notifications', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const unreadOnly = req.query.unread === 'true';

  let query = 'SELECT * FROM user_notifications WHERE dismissed_at IS NULL';
  if (unreadOnly) {
    query += ' AND read_at IS NULL';
  }
  query += ' ORDER BY created_at DESC LIMIT ?';

  const notifications = db.prepare(query).all(limit);
  const unreadCount = db.prepare('SELECT COUNT(*) as count FROM user_notifications WHERE read_at IS NULL AND dismissed_at IS NULL').get().count;

  res.json({ success: true, notifications, unreadCount });
});

// Mark notification as read
app.patch('/api/user-notifications/:id/read', (req, res) => {
  db.prepare('UPDATE user_notifications SET read_at = datetime("now") WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Mark all as read
app.post('/api/user-notifications/read-all', (req, res) => {
  db.prepare('UPDATE user_notifications SET read_at = datetime("now") WHERE read_at IS NULL').run();
  res.json({ success: true });
});

// Dismiss notification
app.delete('/api/user-notifications/:id', (req, res) => {
  db.prepare('UPDATE user_notifications SET dismissed_at = datetime("now") WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Create notification helper (for notification center UI)
function createNotification(type, title, message, severity = 'info', entityType = null, entityId = null) {
  try {
    db.prepare(`
      INSERT INTO user_notifications (type, title, message, severity, entity_type, entity_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(type, title, message, severity, entityType, entityId);
  } catch (e) {
    console.error('Failed to create notification:', e);
  }
}

// ==================== NETWORK DISCOVERY ====================

const { exec } = require('child_process');
const dns = require('dns').promises;

// Ping a single IP address
app.get('/api/network/ping', authMiddleware, async (req, res) => {
  const { ip, timeout = 1000 } = req.query;

  if (!ip) {
    return res.status(400).json({ success: false, error: 'IP address required' });
  }

  // Validate IP format
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) {
    return res.status(400).json({ success: false, error: 'Invalid IP address format' });
  }

  try {
    const startTime = Date.now();
    const isOnline = await pingIP(ip, parseInt(timeout));
    const responseTime = Date.now() - startTime;

    let hostname = '';
    if (isOnline) {
      try {
        const hostnames = await dns.reverse(ip);
        hostname = hostnames[0] || '';
      } catch (e) {
        // DNS reverse lookup failed, that's fine
      }
    }

    res.json({
      success: true,
      ip,
      online: isOnline,
      responseTime: isOnline ? responseTime : null,
      hostname
    });
  } catch (error) {
    res.json({ success: true, ip, online: false, responseTime: null, hostname: '' });
  }
});

// Ping helper function using system ping
function pingIP(ip, timeout = 1000) {
  return new Promise((resolve) => {
    const timeoutSec = Math.max(1, Math.ceil(timeout / 1000));
    const platform = process.platform;

    let cmd;
    if (platform === 'win32') {
      cmd = `ping -n 1 -w ${timeout} ${ip}`;
    } else if (platform === 'darwin') {
      cmd = `ping -c 1 -W ${timeoutSec} ${ip}`;
    } else {
      cmd = `ping -c 1 -W ${timeoutSec} ${ip}`;
    }

    exec(cmd, { timeout: timeout + 1000 }, (error, stdout) => {
      if (error) {
        resolve(false);
      } else {
        // Check for successful ping indicators
        const success = stdout.includes('1 packets transmitted, 1') ||
                       stdout.includes('1 received') ||
                       stdout.includes('Reply from') ||
                       stdout.includes('bytes from');
        resolve(success);
      }
    });
  });
}

// Scan a range of IPs (batch endpoint for efficiency)
app.post('/api/network/scan', authMiddleware, async (req, res) => {
  const { ips, timeout = 1000 } = req.body;

  if (!ips || !Array.isArray(ips)) {
    return res.status(400).json({ success: false, error: 'IPs array required' });
  }

  if (ips.length > 50) {
    return res.status(400).json({ success: false, error: 'Maximum 50 IPs per batch' });
  }

  const results = await Promise.all(
    ips.map(async (ip) => {
      const startTime = Date.now();
      const isOnline = await pingIP(ip, parseInt(timeout));
      const responseTime = Date.now() - startTime;

      let hostname = '';
      if (isOnline) {
        try {
          const hostnames = await dns.reverse(ip);
          hostname = hostnames[0] || '';
        } catch (e) {
          // DNS reverse lookup failed
        }
      }

      return {
        ip,
        online: isOnline,
        responseTime: isOnline ? responseTime : null,
        hostname
      };
    })
  );

  res.json({ success: true, results });
});

// ==================== WEBHOOKS ====================

// Get webhooks
app.get('/api/webhooks', authMiddleware, (req, res) => {
  const webhooks = db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
  res.json({ success: true, webhooks });
});

// Create webhook
app.post('/api/webhooks', authMiddleware, (req, res) => {
  const { name, url, type, events, headers, enabled } = req.body;

  if (!name || !url) {
    return res.status(400).json({ success: false, error: 'Name and URL are required' });
  }

  const result = db.prepare(`
    INSERT INTO webhooks (name, url, type, events, headers, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, url, type || 'generic', events || 'all', headers ? JSON.stringify(headers) : null, enabled !== false ? 1 : 0);

  logActivity(req, 'create_webhook', 'webhook', result.lastInsertRowid, name);
  res.json({ success: true, id: result.lastInsertRowid });
});

// Update webhook
app.put('/api/webhooks/:id', authMiddleware, (req, res) => {
  const { name, url, type, events, headers, enabled } = req.body;

  db.prepare(`
    UPDATE webhooks SET name = ?, url = ?, type = ?, events = ?, headers = ?, enabled = ?
    WHERE id = ?
  `).run(name, url, type, events, headers ? JSON.stringify(headers) : null, enabled ? 1 : 0, req.params.id);

  logActivity(req, 'update_webhook', 'webhook', req.params.id, name);
  res.json({ success: true });
});

// Delete webhook
app.delete('/api/webhooks/:id', authMiddleware, (req, res) => {
  const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
  logActivity(req, 'delete_webhook', 'webhook', req.params.id, webhook?.name);
  res.json({ success: true });
});

// Test webhook
app.post('/api/webhooks/:id/test', authMiddleware, async (req, res) => {
  const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);

  if (!webhook) {
    return res.status(404).json({ success: false, error: 'Webhook not found' });
  }

  try {
    const headers = webhook.headers ? JSON.parse(webhook.headers) : {};
    headers['Content-Type'] = 'application/json';

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event: 'test',
        message: 'Test webhook from Office Monitor',
        timestamp: new Date().toISOString()
      })
    });

    db.prepare('UPDATE webhooks SET last_triggered = datetime("now"), last_status = ? WHERE id = ?').run(response.status, req.params.id);
    res.json({ success: response.ok, status: response.status });
  } catch (e) {
    db.prepare('UPDATE webhooks SET last_triggered = datetime("now"), last_status = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: false, error: e.message });
  }
});

// Trigger webhooks helper
async function triggerWebhooks(event, data) {
  const webhooks = db.prepare('SELECT * FROM webhooks WHERE enabled = 1').all();

  for (const webhook of webhooks) {
    if (webhook.events !== 'all' && !webhook.events.includes(event)) continue;

    try {
      const headers = webhook.headers ? JSON.parse(webhook.headers) : {};
      headers['Content-Type'] = 'application/json';

      let body;
      if (webhook.type === 'slack') {
        body = JSON.stringify({ text: `[${event}] ${data.message || JSON.stringify(data)}` });
      } else if (webhook.type === 'teams') {
        body = JSON.stringify({ text: `[${event}] ${data.message || JSON.stringify(data)}` });
      } else {
        body = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
      }

      const response = await fetch(webhook.url, { method: 'POST', headers, body });
      db.prepare('UPDATE webhooks SET last_triggered = datetime("now"), last_status = ? WHERE id = ?').run(response.status, webhook.id);
    } catch (e) {
      console.error(`Webhook ${webhook.name} failed:`, e.message);
      db.prepare('UPDATE webhooks SET last_triggered = datetime("now"), last_status = 0 WHERE id = ?').run(webhook.id);
    }
  }
}

// ==================== SCHEDULED REPORTS ====================

// Get scheduled reports
app.get('/api/scheduled-reports', authMiddleware, (req, res) => {
  const reports = db.prepare('SELECT * FROM scheduled_reports ORDER BY created_at DESC').all();
  res.json({ success: true, reports });
});

// Create scheduled report
app.post('/api/scheduled-reports', authMiddleware, (req, res) => {
  const { name, schedule, report_type, recipients, slack_channel, include_floors, include_device_types, enabled } = req.body;

  const result = db.prepare(`
    INSERT INTO scheduled_reports (name, schedule, report_type, recipients, slack_channel, include_floors, include_device_types, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, schedule, report_type || 'summary', recipients, slack_channel, include_floors, include_device_types, enabled !== false ? 1 : 0);

  logActivity(req, 'create_report', 'scheduled_report', result.lastInsertRowid, name);
  res.json({ success: true, id: result.lastInsertRowid });
});

// Update scheduled report
app.put('/api/scheduled-reports/:id', authMiddleware, (req, res) => {
  const { name, schedule, report_type, recipients, slack_channel, include_floors, include_device_types, enabled } = req.body;

  db.prepare(`
    UPDATE scheduled_reports SET name = ?, schedule = ?, report_type = ?, recipients = ?, slack_channel = ?, include_floors = ?, include_device_types = ?, enabled = ?
    WHERE id = ?
  `).run(name, schedule, report_type, recipients, slack_channel, include_floors, include_device_types, enabled ? 1 : 0, req.params.id);

  logActivity(req, 'update_report', 'scheduled_report', req.params.id, name);
  res.json({ success: true });
});

// Delete scheduled report
app.delete('/api/scheduled-reports/:id', authMiddleware, (req, res) => {
  const report = db.prepare('SELECT * FROM scheduled_reports WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM scheduled_reports WHERE id = ?').run(req.params.id);
  logActivity(req, 'delete_report', 'scheduled_report', req.params.id, report?.name);
  res.json({ success: true });
});

// Generate report now
app.post('/api/scheduled-reports/:id/run', authMiddleware, async (req, res) => {
  const report = db.prepare('SELECT * FROM scheduled_reports WHERE id = ?').get(req.params.id);

  if (!report) {
    return res.status(404).json({ success: false, error: 'Report not found' });
  }

  const reportData = generateReportData(report);

  if (report.slack_channel) {
    await sendReportToSlack(reportData, report.slack_channel);
  }

  db.prepare('UPDATE scheduled_reports SET last_sent = datetime("now") WHERE id = ?').run(req.params.id);
  logActivity(req, 'run_report', 'scheduled_report', req.params.id, report.name);

  res.json({ success: true, report: reportData });
});

// Generate report data helper
function generateReportData(reportConfig) {
  const monitors = db.prepare('SELECT * FROM monitors WHERE active = 1').all();
  const polyDevices = db.prepare('SELECT * FROM poly_devices').all();

  // Calculate stats
  const now = new Date();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const recentIncidents = db.prepare(`
    SELECT * FROM incidents WHERE started_at > ? ORDER BY started_at DESC
  `).all(dayAgo.toISOString());

  const uptimeStats = {};
  monitors.forEach(m => {
    const heartbeats = db.prepare(`
      SELECT status FROM heartbeats WHERE monitor_id = ? AND time > ? ORDER BY time DESC
    `).all(m.id, dayAgo.toISOString());

    if (heartbeats.length > 0) {
      const upCount = heartbeats.filter(h => h.status === 1).length;
      uptimeStats[m.id] = ((upCount / heartbeats.length) * 100).toFixed(2);
    }
  });

  const totalDevices = monitors.length + polyDevices.length;
  const onlineMonitors = monitors.filter(m => {
    const lastHb = db.prepare('SELECT status FROM heartbeats WHERE monitor_id = ? ORDER BY time DESC LIMIT 1').get(m.id);
    return lastHb?.status === 1;
  }).length;
  const onlinePoly = polyDevices.filter(p => p.connected).length;

  return {
    generatedAt: now.toISOString(),
    period: '24 hours',
    summary: {
      totalDevices,
      online: onlineMonitors + onlinePoly,
      offline: totalDevices - onlineMonitors - onlinePoly,
      incidents: recentIncidents.length
    },
    incidents: recentIncidents.slice(0, 10),
    uptimeStats,
    floors: [...new Set(monitors.map(m => m.floor))].map(floor => ({
      name: floor,
      devices: monitors.filter(m => m.floor === floor).length,
      online: monitors.filter(m => m.floor === floor && uptimeStats[m.id] > 0).length
    }))
  };
}

// Send report to Slack helper
async function sendReportToSlack(reportData, channel) {
  const webhookUrl = db.prepare(`SELECT value FROM settings WHERE key = 'slack_webhook_url'`).get()?.value;
  if (!webhookUrl) return;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📊 Office Monitor Daily Report', emoji: true }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Total Devices:* ${reportData.summary.totalDevices}` },
        { type: 'mrkdwn', text: `*Online:* ${reportData.summary.online}` },
        { type: 'mrkdwn', text: `*Offline:* ${reportData.summary.offline}` },
        { type: 'mrkdwn', text: `*Incidents (24h):* ${reportData.summary.incidents}` }
      ]
    }
  ];

  if (reportData.incidents.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Recent Incidents:*\n' + reportData.incidents.slice(0, 5).map(i => `• ${i.device_name} (${i.floor || 'Unknown'})`).join('\n') }
    });
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, blocks })
    });
  } catch (e) {
    console.error('Failed to send report to Slack:', e);
  }
}

// Run scheduled reports (check every hour)
setInterval(() => {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();

  const reports = db.prepare('SELECT * FROM scheduled_reports WHERE enabled = 1').all();

  reports.forEach(report => {
    let shouldRun = false;

    if (report.schedule === 'daily' && hour === 8) {
      shouldRun = true;
    } else if (report.schedule === 'weekly' && dayOfWeek === 1 && hour === 8) {
      shouldRun = true;
    } else if (report.schedule === 'hourly') {
      shouldRun = true;
    }

    if (shouldRun) {
      const reportData = generateReportData(report);
      if (report.slack_channel) {
        sendReportToSlack(reportData, report.slack_channel);
      }
      db.prepare('UPDATE scheduled_reports SET last_sent = datetime("now") WHERE id = ?').run(report.id);
    }
  });
}, 60 * 60 * 1000); // Every hour

// ==================== CUSTOM ALERT RULES ====================

// Get alert rules
app.get('/api/alert-rules', authMiddleware, (req, res) => {
  const rules = db.prepare(`
    SELECT ar.*, m.name as monitor_name, t.name as tag_name
    FROM alert_rules ar
    LEFT JOIN monitors m ON ar.monitor_id = m.id
    LEFT JOIN device_tags t ON ar.tag_id = t.id
    ORDER BY ar.created_at DESC
  `).all();
  res.json({ success: true, rules });
});

// Create alert rule
app.post('/api/alert-rules', authMiddleware, (req, res) => {
  const { monitor_id, tag_id, rule_type, condition, threshold, retry_count, notify_slack, notify_webhook, enabled } = req.body;

  const result = db.prepare(`
    INSERT INTO alert_rules (monitor_id, tag_id, rule_type, condition, threshold, retry_count, notify_slack, notify_webhook, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(monitor_id || null, tag_id || null, rule_type, condition, threshold, retry_count || 3, notify_slack !== false ? 1 : 0, notify_webhook, enabled !== false ? 1 : 0);

  logActivity(req, 'create_alert_rule', 'alert_rule', result.lastInsertRowid);
  res.json({ success: true, id: result.lastInsertRowid });
});

// Update alert rule
app.put('/api/alert-rules/:id', authMiddleware, (req, res) => {
  const { monitor_id, tag_id, rule_type, condition, threshold, retry_count, notify_slack, notify_webhook, enabled } = req.body;

  db.prepare(`
    UPDATE alert_rules SET monitor_id = ?, tag_id = ?, rule_type = ?, condition = ?, threshold = ?, retry_count = ?, notify_slack = ?, notify_webhook = ?, enabled = ?
    WHERE id = ?
  `).run(monitor_id || null, tag_id || null, rule_type, condition, threshold, retry_count, notify_slack ? 1 : 0, notify_webhook, enabled ? 1 : 0, req.params.id);

  logActivity(req, 'update_alert_rule', 'alert_rule', req.params.id);
  res.json({ success: true });
});

// Delete alert rule
app.delete('/api/alert-rules/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM alert_rules WHERE id = ?').run(req.params.id);
  logActivity(req, 'delete_alert_rule', 'alert_rule', req.params.id);
  res.json({ success: true });
});

// ==================== API HEALTH MONITORS ====================

// Get API monitors
app.get('/api/api-monitors', authMiddleware, (req, res) => {
  const monitors = db.prepare('SELECT * FROM api_monitors ORDER BY created_at DESC').all();
  res.json({ success: true, monitors });
});

// Create API monitor
app.post('/api/api-monitors', authMiddleware, (req, res) => {
  const { name, url, method, headers, body, expected_status, timeout, interval, enabled } = req.body;

  const result = db.prepare(`
    INSERT INTO api_monitors (name, url, method, headers, body, expected_status, timeout, interval, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, url, method || 'GET', headers ? JSON.stringify(headers) : null, body, expected_status || 200, timeout || 10000, interval || 60000, enabled !== false ? 1 : 0);

  logActivity(req, 'create_api_monitor', 'api_monitor', result.lastInsertRowid, name);
  res.json({ success: true, id: result.lastInsertRowid });
});

// Update API monitor
app.put('/api/api-monitors/:id', authMiddleware, (req, res) => {
  const { name, url, method, headers, body, expected_status, timeout, interval, enabled } = req.body;

  db.prepare(`
    UPDATE api_monitors SET name = ?, url = ?, method = ?, headers = ?, body = ?, expected_status = ?, timeout = ?, interval = ?, enabled = ?
    WHERE id = ?
  `).run(name, url, method, headers ? JSON.stringify(headers) : null, body, expected_status, timeout, interval, enabled ? 1 : 0, req.params.id);

  logActivity(req, 'update_api_monitor', 'api_monitor', req.params.id, name);
  res.json({ success: true });
});

// Delete API monitor
app.delete('/api/api-monitors/:id', authMiddleware, (req, res) => {
  const monitor = db.prepare('SELECT * FROM api_monitors WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM api_monitors WHERE id = ?').run(req.params.id);
  logActivity(req, 'delete_api_monitor', 'api_monitor', req.params.id, monitor?.name);
  res.json({ success: true });
});

// Check API monitor now
app.post('/api/api-monitors/:id/check', authMiddleware, async (req, res) => {
  const monitor = db.prepare('SELECT * FROM api_monitors WHERE id = ?').get(req.params.id);

  if (!monitor) {
    return res.status(404).json({ success: false, error: 'Monitor not found' });
  }

  const result = await checkApiMonitor(monitor);
  res.json({ success: true, result });
});

// Check API monitor helper
async function checkApiMonitor(monitor) {
  const startTime = Date.now();

  try {
    const headers = monitor.headers ? JSON.parse(monitor.headers) : {};
    const options = {
      method: monitor.method,
      headers,
      signal: AbortSignal.timeout(monitor.timeout)
    };

    if (monitor.body && ['POST', 'PUT', 'PATCH'].includes(monitor.method)) {
      options.body = monitor.body;
    }

    const response = await fetch(monitor.url, options);
    const responseTime = Date.now() - startTime;
    const status = response.status === monitor.expected_status ? 'up' : 'down';

    db.prepare(`
      UPDATE api_monitors SET last_check = datetime('now'), last_status = ?, last_response_time = ?
      WHERE id = ?
    `).run(status, responseTime, monitor.id);

    return { status, responseTime, httpStatus: response.status };
  } catch (e) {
    const responseTime = Date.now() - startTime;

    db.prepare(`
      UPDATE api_monitors SET last_check = datetime('now'), last_status = 'down', last_response_time = ?
      WHERE id = ?
    `).run(responseTime, monitor.id);

    return { status: 'down', responseTime, error: e.message };
  }
}

// Run API monitor checks periodically
setInterval(async () => {
  const monitors = db.prepare('SELECT * FROM api_monitors WHERE enabled = 1').all();

  for (const monitor of monitors) {
    await checkApiMonitor(monitor);
  }
}, 60000); // Every minute

// ==================== BACKUP & RESTORE ====================

// Export database backup
app.get('/api/backup', authMiddleware, (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin only' });
  }

  const backup = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    monitors: db.prepare('SELECT * FROM monitors').all(),
    device_types: db.prepare('SELECT * FROM device_types').all(),
    floor_plans: db.prepare('SELECT floor, image_type FROM floor_plans').all(), // Exclude image data for size
    room_positions: db.prepare('SELECT * FROM room_positions').all(),
    device_tags: db.prepare('SELECT * FROM device_tags').all(),
    monitor_tags: db.prepare('SELECT * FROM monitor_tags').all(),
    webhooks: db.prepare('SELECT id, name, url, type, events, enabled FROM webhooks').all(),
    scheduled_reports: db.prepare('SELECT * FROM scheduled_reports').all(),
    alert_rules: db.prepare('SELECT * FROM alert_rules').all(),
    api_monitors: db.prepare('SELECT * FROM api_monitors').all(),
    settings: db.prepare('SELECT key, value FROM settings WHERE key NOT LIKE "%secret%" AND key NOT LIKE "%password%"').all()
  };

  logActivity(req, 'export_backup', 'system');

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=office-monitor-backup-${new Date().toISOString().split('T')[0]}.json`);
  res.json(backup);
});

// Import database backup
app.post('/api/restore', authMiddleware, (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin only' });
  }

  const { backup, options } = req.body;

  if (!backup || !backup.version) {
    return res.status(400).json({ success: false, error: 'Invalid backup file' });
  }

  try {
    const results = { imported: {}, skipped: {} };

    // Import monitors
    if (backup.monitors && options?.monitors !== false) {
      const insert = db.prepare(`INSERT OR REPLACE INTO monitors (id, name, hostname, type, floor, device_type, interval, active, pos_x, pos_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      backup.monitors.forEach(m => {
        insert.run(m.id, m.name, m.hostname, m.type, m.floor, m.device_type, m.interval, m.active, m.pos_x, m.pos_y);
      });
      results.imported.monitors = backup.monitors.length;
    }

    // Import tags
    if (backup.device_tags && options?.tags !== false) {
      const insert = db.prepare('INSERT OR REPLACE INTO device_tags (id, name, color, priority) VALUES (?, ?, ?, ?)');
      backup.device_tags.forEach(t => insert.run(t.id, t.name, t.color, t.priority));
      results.imported.tags = backup.device_tags.length;
    }

    logActivity(req, 'restore_backup', 'system', null, null, results);
    res.json({ success: true, results });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== EXPORT DATA ====================

// Export monitors to CSV
app.get('/api/export/monitors', authMiddleware, (req, res) => {
  const monitors = db.prepare(`
    SELECT m.*,
           (SELECT status FROM heartbeats WHERE monitor_id = m.id ORDER BY time DESC LIMIT 1) as current_status,
           (SELECT ping FROM heartbeats WHERE monitor_id = m.id ORDER BY time DESC LIMIT 1) as last_ping
    FROM monitors m
    ORDER BY m.floor, m.name
  `).all();

  const csv = [
    'ID,Name,Hostname,Type,Floor,Device Type,Status,Last Ping (ms),Active',
    ...monitors.map(m => `${m.id},"${m.name}","${m.hostname}",${m.type},"${m.floor}",${m.device_type},${m.current_status === 1 ? 'Online' : 'Offline'},${m.last_ping || ''},${m.active}`)
  ].join('\n');

  logActivity(req, 'export_monitors', 'export');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=monitors-${new Date().toISOString().split('T')[0]}.csv`);
  res.send(csv);
});

// Export incidents to CSV
app.get('/api/export/incidents', authMiddleware, (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const incidents = db.prepare(`
    SELECT * FROM incidents WHERE started_at > ? ORDER BY started_at DESC
  `).all(since);

  const csv = [
    'ID,Device Name,Device Type,Floor,Started At,Ended At,Duration (min),Acknowledged By,Resolution Notes',
    ...incidents.map(i => `${i.id},"${i.device_name}",${i.device_type || ''},"${i.floor || ''}","${i.started_at}","${i.ended_at || ''}",${i.duration_seconds ? Math.round(i.duration_seconds / 60) : ''},"${i.acknowledged_by || ''}","${(i.resolution_notes || '').replace(/"/g, '""')}"`)
  ].join('\n');

  logActivity(req, 'export_incidents', 'export');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=incidents-${new Date().toISOString().split('T')[0]}.csv`);
  res.send(csv);
});

// Export uptime report
app.get('/api/export/uptime', authMiddleware, (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const monitors = db.prepare('SELECT * FROM monitors WHERE active = 1').all();

  const uptimeData = monitors.map(m => {
    const heartbeats = db.prepare(`
      SELECT status FROM heartbeats WHERE monitor_id = ? AND time > ?
    `).all(m.id, since);

    const total = heartbeats.length;
    const up = heartbeats.filter(h => h.status === 1).length;
    const uptime = total > 0 ? ((up / total) * 100).toFixed(2) : 'N/A';

    return { ...m, uptime, totalChecks: total, upChecks: up };
  });

  const csv = [
    `Uptime Report - Last ${days} Days`,
    'ID,Name,Floor,Device Type,Uptime %,Total Checks,Up Checks',
    ...uptimeData.map(m => `${m.id},"${m.name}","${m.floor}",${m.device_type},${m.uptime},${m.totalChecks},${m.upChecks}`)
  ].join('\n');

  logActivity(req, 'export_uptime', 'export');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=uptime-report-${new Date().toISOString().split('T')[0]}.csv`);
  res.send(csv);
});

// ==================== BULK IMPORT ====================

// Bulk import devices from CSV
app.post('/api/monitors/bulk-import', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const { devices } = req.body;
  if (!Array.isArray(devices) || devices.length === 0) {
    return res.status(400).json({ success: false, error: 'No devices provided' });
  }

  const insertStmt = db.prepare(`
    INSERT INTO monitors (name, type, hostname, url, floor, device_type, active, interval, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let imported = 0;
  let failed = 0;
  const errors = [];

  devices.forEach((device, idx) => {
    try {
      if (!device.name || (!device.hostname && !device.url)) {
        throw new Error('Name and hostname/url required');
      }
      insertStmt.run(
        device.name,
        device.type || 'ping',
        device.hostname || null,
        device.url || null,
        device.floor || null,
        device.device_type || 'accessPoints',
        device.active !== false ? 1 : 0,
        device.interval || 30,
        device.notes || null
      );
      imported++;
    } catch (e) {
      failed++;
      errors.push({ row: idx + 1, name: device.name, error: e.message });
    }
  });

  logActivity(req, 'bulk_import', 'monitors', null, null, `Imported ${imported} devices, ${failed} failed`);

  res.json({ success: true, imported, failed, errors });
});

// ==================== DEVICE TEMPLATES ====================

// Get all device templates
app.get('/api/device-templates', (req, res) => {
  const templates = db.prepare('SELECT * FROM device_templates ORDER BY name').all();
  res.json({ success: true, templates });
});

// Create device template
app.post('/api/device-templates', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const { name, type, device_type, default_interval, icon, color, snmp_enabled, snmp_community } = req.body;

  const result = db.prepare(`
    INSERT INTO device_templates (name, type, device_type, default_interval, icon, color, snmp_enabled, snmp_community)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, type || 'ping', device_type, default_interval || 30, icon, color, snmp_enabled ? 1 : 0, snmp_community || 'public');

  res.json({ success: true, id: result.lastInsertRowid });
});

// Delete device template
app.delete('/api/device-templates/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  db.prepare('DELETE FROM device_templates WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== SAVED FILTERS ====================

// Get saved filters
app.get('/api/saved-filters', authMiddleware, (req, res) => {
  const filters = db.prepare(`
    SELECT * FROM saved_filters
    WHERE user_id = ? OR is_global = 1
    ORDER BY is_global DESC, name
  `).all(req.user.id);
  res.json({ success: true, filters });
});

// Create saved filter
app.post('/api/saved-filters', authMiddleware, (req, res) => {
  const { name, filter_config, is_global } = req.body;

  // Only admins can create global filters
  const global = is_global && req.user.role === 'admin' ? 1 : 0;

  const result = db.prepare(`
    INSERT INTO saved_filters (user_id, name, filter_config, is_global)
    VALUES (?, ?, ?, ?)
  `).run(req.user.id, name, JSON.stringify(filter_config), global);

  res.json({ success: true, id: result.lastInsertRowid });
});

// Delete saved filter
app.delete('/api/saved-filters/:id', authMiddleware, (req, res) => {
  const filter = db.prepare('SELECT * FROM saved_filters WHERE id = ?').get(req.params.id);

  if (!filter) {
    return res.status(404).json({ success: false, error: 'Filter not found' });
  }

  // Can only delete own filters or global filters if admin
  if (filter.user_id !== req.user.id && !(filter.is_global && req.user.role === 'admin')) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  db.prepare('DELETE FROM saved_filters WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== FLOOR ZONES ====================

// Get floor zones
app.get('/api/floor-zones', (req, res) => {
  const floor = req.query.floor;
  let zones;
  if (floor) {
    zones = db.prepare('SELECT * FROM floor_zones WHERE floor = ?').all(floor);
  } else {
    zones = db.prepare('SELECT * FROM floor_zones').all();
  }
  res.json({ success: true, zones });
});

// Create floor zone
app.post('/api/floor-zones', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const { floor, name, color, opacity, points, type } = req.body;

  const result = db.prepare(`
    INSERT INTO floor_zones (floor, name, color, opacity, points, type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(floor, name, color || '#3B82F6', opacity || 0.2, JSON.stringify(points), type || 'room');

  logActivity(req, 'create', 'floor_zone', result.lastInsertRowid, name);
  res.json({ success: true, id: result.lastInsertRowid });
});

// Update floor zone
app.put('/api/floor-zones/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const { name, color, opacity, points, type } = req.body;

  db.prepare(`
    UPDATE floor_zones SET name = ?, color = ?, opacity = ?, points = ?, type = ?
    WHERE id = ?
  `).run(name, color, opacity, JSON.stringify(points), type || 'room', req.params.id);

  res.json({ success: true });
});

// Delete floor zone
app.delete('/api/floor-zones/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  db.prepare('DELETE FROM floor_zones WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== DEVICE NOTES ====================

// Update device notes
app.patch('/api/monitors/:id/notes', authMiddleware, (req, res) => {
  const { notes } = req.body;

  db.prepare('UPDATE monitors SET notes = ? WHERE id = ?').run(notes, req.params.id);
  logActivity(req, 'update_notes', 'monitor', req.params.id);

  res.json({ success: true });
});

// General update endpoint for monitor fields (floor, serial_number, etc.)
app.patch('/api/monitors/:id', authMiddleware, (req, res) => {
  const { floor, serial_number } = req.body;
  const updates = [];
  const values = [];

  if (floor !== undefined) {
    updates.push('floor = ?');
    values.push(floor);
  }
  if (serial_number !== undefined) {
    updates.push('serial_number = ?');
    values.push(serial_number);
  }

  if (updates.length === 0) {
    return res.status(400).json({ success: false, message: 'No fields to update' });
  }

  values.push(req.params.id);
  db.prepare(`UPDATE monitors SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  logActivity(req, 'update_monitor', 'monitor', req.params.id);

  res.json({ success: true });
});

// ==================== HEALTH SCORES ====================

// Calculate and update health scores for all monitors
function calculateHealthScores() {
  const monitors = db.prepare('SELECT id, name FROM monitors WHERE active = 1').all();
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  monitors.forEach(monitor => {
    // Get heartbeats from last 24 hours
    const heartbeats = db.prepare(`
      SELECT status, time FROM heartbeats
      WHERE monitor_id = ? AND time > datetime(?, 'unixepoch')
      ORDER BY time DESC
    `).all(monitor.id, Math.floor(dayAgo / 1000));

    if (heartbeats.length === 0) {
      return; // No data, keep current score
    }

    // Calculate uptime percentage
    const upCount = heartbeats.filter(h => h.status === 1).length;
    const uptimePercent = (upCount / heartbeats.length) * 100;

    // Calculate score (0-100)
    // 100% uptime = 100 score
    // Each 1% downtime reduces score by 5 points (so 80% uptime = 0 score)
    let score = Math.max(0, Math.min(100, Math.round(uptimePercent * 1.25 - 25)));

    // Bonus for consistent uptime (no recent incidents)
    const recentIncidents = db.prepare(`
      SELECT COUNT(*) as count FROM incidents
      WHERE monitor_id = ? AND started_at > datetime('now', '-7 days')
    `).get(monitor.id).count;

    if (recentIncidents === 0 && uptimePercent > 99) {
      score = Math.min(100, score + 10);
    }

    db.prepare("UPDATE monitors SET health_score = ?, last_health_update = datetime('now') WHERE id = ?")
      .run(score, monitor.id);
  });
}

// Get health scores
app.get('/api/health-scores', (req, res) => {
  const scores = db.prepare(`
    SELECT id, name, floor, device_type, health_score, last_health_update
    FROM monitors WHERE active = 1
    ORDER BY health_score ASC
  `).all();
  res.json({ success: true, scores });
});

// Recalculate health scores
app.post('/api/health-scores/recalculate', authMiddleware, (req, res) => {
  calculateHealthScores();
  res.json({ success: true, message: 'Health scores recalculated' });
});

// Run health score calculation every hour
setInterval(calculateHealthScores, 60 * 60 * 1000);

// ==================== UPTIME HISTORY ====================

// Get uptime history for a monitor
app.get('/api/monitors/:id/uptime-history', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const monitorId = req.params.id;

  // Get hourly uptime data
  const history = db.prepare(`
    SELECT
      strftime('%Y-%m-%d %H:00', time) as hour,
      COUNT(*) as total,
      SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as up,
      AVG(ping) as avg_ping
    FROM heartbeats
    WHERE monitor_id = ? AND time > datetime('now', '-' || ? || ' hours')
    GROUP BY strftime('%Y-%m-%d %H:00', time)
    ORDER BY hour DESC
  `).all(monitorId, hours);

  res.json({ success: true, history });
});

// ==================== AUTO-DISCOVERY ====================

// Scan network for devices
app.post('/api/auto-discover', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const { subnet, startIp, endIp } = req.body;

  // Default to common office subnet
  const baseSubnet = subnet || '192.168.1';
  const start = startIp || 1;
  const end = Math.min(endIp || 254, 254);

  const discovered = [];
  const existingIps = new Set(
    db.prepare('SELECT hostname FROM monitors WHERE hostname IS NOT NULL').all().map(m => m.hostname)
  );

  // Scan IPs in parallel (batches of 20)
  const batchSize = 20;
  for (let i = start; i <= end; i += batchSize) {
    const batch = [];
    for (let j = i; j < Math.min(i + batchSize, end + 1); j++) {
      const ip = `${baseSubnet}.${j}`;
      if (!existingIps.has(ip)) {
        batch.push(
          ping.promise.probe(ip, { timeout: 2 })
            .then(result => {
              if (result.alive) {
                return { ip, alive: true, time: result.time };
              }
              return null;
            })
            .catch(() => null)
        );
      }
    }

    const results = await Promise.all(batch);
    results.filter(r => r !== null).forEach(r => discovered.push(r));
  }

  logActivity(req, 'auto_discover', 'network', null, null, `Scanned ${baseSubnet}.${start}-${end}, found ${discovered.length} devices`);

  res.json({
    success: true,
    discovered,
    scanned: end - start + 1,
    existing: existingIps.size
  });
});

// Add discovered devices
app.post('/api/auto-discover/add', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const { devices } = req.body;

  const insertStmt = db.prepare(`
    INSERT INTO monitors (name, type, hostname, floor, device_type, active, interval)
    VALUES (?, 'ping', ?, ?, 'accessPoints', 1, 30)
  `);

  let added = 0;
  devices.forEach(device => {
    try {
      insertStmt.run(device.name || `Device ${device.ip}`, device.ip, device.floor || '1st Floor');
      added++;
    } catch (e) {
      // Skip duplicates
    }
  });

  logActivity(req, 'add_discovered', 'monitors', null, null, `Added ${added} discovered devices`);
  res.json({ success: true, added });
});

// ==================== BULK ACTIONS ====================

// Bulk update monitors
app.post('/api/monitors/bulk-action', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const { action, ids, data } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'No devices selected' });
  }

  let affected = 0;
  const placeholders = ids.map(() => '?').join(',');

  switch (action) {
    case 'delete':
      const deleteResult = db.prepare(`DELETE FROM monitors WHERE id IN (${placeholders})`).run(...ids);
      affected = deleteResult.changes;
      break;

    case 'activate':
      const activateResult = db.prepare(`UPDATE monitors SET active = 1 WHERE id IN (${placeholders})`).run(...ids);
      affected = activateResult.changes;
      break;

    case 'deactivate':
      const deactivateResult = db.prepare(`UPDATE monitors SET active = 0 WHERE id IN (${placeholders})`).run(...ids);
      affected = deactivateResult.changes;
      break;

    case 'maintenance_on':
      const maintOnResult = db.prepare(`UPDATE monitors SET maintenance = 1, maintenance_note = ? WHERE id IN (${placeholders})`).run(data?.note || 'Bulk maintenance', ...ids);
      affected = maintOnResult.changes;
      break;

    case 'maintenance_off':
      const maintOffResult = db.prepare(`UPDATE monitors SET maintenance = 0, maintenance_note = NULL, maintenance_until = NULL WHERE id IN (${placeholders})`).run(...ids);
      affected = maintOffResult.changes;
      break;

    case 'move_floor':
      if (!data?.floor) {
        return res.status(400).json({ success: false, error: 'Floor not specified' });
      }
      const moveResult = db.prepare(`UPDATE monitors SET floor = ? WHERE id IN (${placeholders})`).run(data.floor, ...ids);
      affected = moveResult.changes;
      break;

    case 'set_interval':
      if (!data?.interval) {
        return res.status(400).json({ success: false, error: 'Interval not specified' });
      }
      const intervalResult = db.prepare(`UPDATE monitors SET interval = ? WHERE id IN (${placeholders})`).run(data.interval, ...ids);
      affected = intervalResult.changes;
      break;

    default:
      return res.status(400).json({ success: false, error: 'Unknown action' });
  }

  logActivity(req, `bulk_${action}`, 'monitors', null, null, `${affected} devices affected`);
  res.json({ success: true, affected });
});

// Serve manifest.json for PWA
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

// ==================== 2FA ENDPOINTS ====================

// Generate 2FA secret for a user
app.post('/api/2fa/setup', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Generate a random secret (base32 encoded)
    const secret = generateTOTPSecret();

    // Store the secret (not yet verified)
    db.prepare('UPDATE users SET totp_secret = ?, totp_verified = 0 WHERE id = ?').run(secret, userId);

    // Generate QR code URL for authenticator apps
    const otpAuthUrl = `otpauth://totp/OfficeMonitor:${user.username}?secret=${secret}&issuer=OfficeMonitor`;

    res.json({
      success: true,
      secret,
      qrCodeUrl: otpAuthUrl,
      message: 'Scan the QR code with your authenticator app, then verify with a code'
    });
  } catch (error) {
    console.error('2FA setup error:', error);
    res.status(500).json({ success: false, error: 'Failed to setup 2FA' });
  }
});

// Verify and enable 2FA
app.post('/api/2fa/verify', authMiddleware, (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!user || !user.totp_secret) {
      return res.status(400).json({ success: false, error: '2FA not set up' });
    }

    // Verify the code
    if (verifyTOTP(user.totp_secret, code)) {
      db.prepare('UPDATE users SET totp_enabled = 1, totp_verified = 1 WHERE id = ?').run(userId);
      logActivity(req, 'enable_2fa', 'user', userId, user.username);
      res.json({ success: true, message: '2FA enabled successfully' });
    } else {
      res.status(400).json({ success: false, error: 'Invalid verification code' });
    }
  } catch (error) {
    console.error('2FA verify error:', error);
    res.status(500).json({ success: false, error: 'Failed to verify 2FA' });
  }
});

// Disable 2FA
app.post('/api/2fa/disable', authMiddleware, (req, res) => {
  try {
    const { code, password } = req.body;
    const userId = req.user.id;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Verify password
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ success: false, error: 'Invalid password' });
    }

    // Verify TOTP code if 2FA is enabled
    if (user.totp_enabled && !verifyTOTP(user.totp_secret, code)) {
      return res.status(400).json({ success: false, error: 'Invalid 2FA code' });
    }

    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_verified = 0 WHERE id = ?').run(userId);
    logActivity(req, 'disable_2fa', 'user', userId, user.username);
    res.json({ success: true, message: '2FA disabled successfully' });
  } catch (error) {
    console.error('2FA disable error:', error);
    res.status(500).json({ success: false, error: 'Failed to disable 2FA' });
  }
});

// Check 2FA status
app.get('/api/2fa/status', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(req.user.id);
    res.json({ success: true, enabled: user?.totp_enabled === 1 });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get 2FA status' });
  }
});

// TOTP Helper functions
function generateTOTPSecret() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let secret = '';
  for (let i = 0; i < 32; i++) {
    secret += chars[Math.floor(Math.random() * chars.length)];
  }
  return secret;
}

function verifyTOTP(secret, code) {
  // Simple TOTP verification (30-second window)
  const time = Math.floor(Date.now() / 30000);

  // Check current and adjacent time windows
  for (let i = -1; i <= 1; i++) {
    const expectedCode = generateTOTPCode(secret, time + i);
    if (expectedCode === code) {
      return true;
    }
  }
  return false;
}

function generateTOTPCode(secret, time) {
  // Base32 decode
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.toUpperCase()) {
    const val = base32Chars.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }

  // Create HMAC-SHA1
  const crypto = require('crypto');
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigInt64BE(BigInt(time));

  const hmac = crypto.createHmac('sha1', Buffer.from(bytes));
  hmac.update(timeBuffer);
  const hash = hmac.digest();

  // Dynamic truncation
  const offset = hash[hash.length - 1] & 0x0f;
  const code = ((hash[offset] & 0x7f) << 24) |
               ((hash[offset + 1] & 0xff) << 16) |
               ((hash[offset + 2] & 0xff) << 8) |
               (hash[offset + 3] & 0xff);

  return String(code % 1000000).padStart(6, '0');
}

// ==================== REPORTS API ====================

// Get uptime report data
app.get('/api/reports/uptime', authMiddleware, (req, res) => {
  try {
    const { period = '7d', floor = 'all', type = 'all' } = req.query;

    // Calculate time range
    let hoursBack = 24 * 7; // default 7 days
    if (period === '24h') hoursBack = 24;
    else if (period === '30d') hoursBack = 24 * 30;
    else if (period === '90d') hoursBack = 24 * 90;

    const startTime = new Date(Date.now() - hoursBack * 3600000).toISOString();

    // Get monitors
    let monitors = db.prepare('SELECT * FROM monitors WHERE active = 1').all();
    if (floor !== 'all') monitors = monitors.filter(m => m.floor === floor);
    if (type !== 'all') monitors = monitors.filter(m => m.device_type === type);

    // Calculate uptime for each device
    const devices = monitors.map(m => {
      const heartbeats = db.prepare(`
        SELECT status, ping FROM heartbeats
        WHERE monitor_id = ? AND time > ?
        ORDER BY time DESC
      `).all(m.id, startTime);

      const total = heartbeats.length || 1;
      const upCount = heartbeats.filter(h => h.status === 1).length;
      const uptime = (upCount / total) * 100;

      const pings = heartbeats.filter(h => h.ping).map(h => h.ping);
      const avgPing = pings.length ? pings.reduce((a, b) => a + b, 0) / pings.length : null;

      const incidents = db.prepare(`
        SELECT COUNT(*) as count FROM incidents
        WHERE monitor_id = ? AND created_at > ?
      `).get(m.id, startTime)?.count || 0;

      return {
        id: m.id,
        name: m.name,
        floor: m.floor,
        type: m.device_type,
        uptime: parseFloat(uptime.toFixed(2)),
        avgPing: avgPing ? Math.round(avgPing) : null,
        incidents
      };
    });

    // Calculate summary
    const avgUptime = devices.length ?
      devices.reduce((a, d) => a + d.uptime, 0) / devices.length : 0;
    const totalIncidents = devices.reduce((a, d) => a + d.incidents, 0);
    const avgResponse = devices.filter(d => d.avgPing).length ?
      devices.filter(d => d.avgPing).reduce((a, d) => a + d.avgPing, 0) /
      devices.filter(d => d.avgPing).length : null;

    // Generate timeline data
    const days = Math.min(hoursBack / 24, 90);
    const timeline = [];
    for (let i = 0; i < days; i++) {
      const dayStart = new Date(Date.now() - (i + 1) * 86400000).toISOString();
      const dayEnd = new Date(Date.now() - i * 86400000).toISOString();

      const dayHeartbeats = db.prepare(`
        SELECT status FROM heartbeats
        WHERE time > ? AND time <= ?
      `).all(dayStart, dayEnd);

      const dayTotal = dayHeartbeats.length || 1;
      const dayUp = dayHeartbeats.filter(h => h.status === 1).length;
      const dayUptime = (dayUp / dayTotal) * 100;

      timeline.unshift({
        date: dayEnd,
        uptime: parseFloat(dayUptime.toFixed(2)),
        status: dayUptime >= 99 ? 'up' : dayUptime >= 90 ? 'partial' : 'down'
      });
    }

    // Get recent incidents
    const incidents = db.prepare(`
      SELECT i.*, m.name as device_name
      FROM incidents i
      LEFT JOIN monitors m ON i.monitor_id = m.id
      WHERE i.created_at > ?
      ORDER BY i.created_at DESC
      LIMIT 20
    `).all(startTime).map(inc => ({
      device: inc.device_name || 'Unknown',
      type: inc.incident_type === 'down' ? 'down' : 'up',
      startTime: inc.created_at,
      duration: inc.resolved_at ?
        Math.round((new Date(inc.resolved_at) - new Date(inc.created_at)) / 1000) : null
    }));

    res.json({
      success: true,
      summary: {
        avgUptime: parseFloat(avgUptime.toFixed(2)),
        totalIncidents,
        avgResponse
      },
      devices,
      timeline,
      incidents
    });

  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

// Get response time history for a device
app.get('/api/reports/response-time/:id', authMiddleware, (req, res) => {
  try {
    const { period = '24h' } = req.query;
    const monitorId = req.params.id;

    let hoursBack = 24;
    if (period === '7d') hoursBack = 24 * 7;
    else if (period === '30d') hoursBack = 24 * 30;

    const startTime = new Date(Date.now() - hoursBack * 3600000).toISOString();

    const heartbeats = db.prepare(`
      SELECT ping, time FROM heartbeats
      WHERE monitor_id = ? AND time > ? AND ping IS NOT NULL
      ORDER BY time ASC
    `).all(monitorId, startTime);

    res.json({
      success: true,
      data: heartbeats.map(h => ({
        time: h.time,
        ping: h.ping
      }))
    });
  } catch (error) {
    console.error('Response time history error:', error);
    res.status(500).json({ success: false, error: 'Failed to get response time history' });
  }
});

// ==================== WEBSOCKET SERVER ====================

// Create HTTP server and WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Track connected clients
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`WebSocket client connected. Total: ${wsClients.size}`);

  // Send initial connection acknowledgment
  ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`WebSocket client disconnected. Total: ${wsClients.size}`);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    wsClients.delete(ws);
  });
});

// Broadcast message to all connected clients
function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Broadcast device status update
function broadcastStatusUpdate(device, status, source = 'monitor') {
  broadcast('status_update', {
    deviceId: device.id,
    deviceName: device.name,
    floor: device.floor,
    status: status,
    source: source,
    ping: device.ping || null
  });
}

// Broadcast new notification
function broadcastNotification(notification) {
  broadcast('notification', notification);
}

// Broadcast incident update
function broadcastIncident(incident, action) {
  broadcast('incident', { ...incident, action });
}

// Broadcast threshold alert
function broadcastAlert(alert) {
  broadcast('alert', alert);
}

// Send heartbeat every 30 seconds to keep connections alive
setInterval(() => {
  broadcast('heartbeat', { time: new Date().toISOString() });
}, 30000);

// Start server
server.listen(PORT, () => {
  const monitorCount = db.prepare('SELECT COUNT(*) as count FROM monitors').get().count;
  console.log(`\n🖥️  Office Monitor running on port ${PORT}`);
  console.log(`📊 Monitors: ${monitorCount}`);
  console.log(`⏱️  Check interval: ${CHECK_INTERVAL / 1000}s`);
  console.log(`🔔 Slack: ${SLACK_WEBHOOK_URL ? 'Configured' : 'Not configured'}`);
  console.log(`📹 Poly Lens: ${POLY_LENS_CLIENT_ID ? 'Configured' : 'Not configured'}`);
  console.log(`🔌 WebSocket: Enabled\n`);
});
