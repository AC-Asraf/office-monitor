require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const ping = require('ping');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const snmp = require('net-snmp');

// Create HTTPS agent that ignores self-signed certificates
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
`);

// Run migrations for new columns (safe to run multiple times)
const migrations = [
  `ALTER TABLE monitors ADD COLUMN pos_x REAL DEFAULT NULL`,
  `ALTER TABLE monitors ADD COLUMN pos_y REAL DEFAULT NULL`,
  `ALTER TABLE monitors ADD COLUMN maintenance INTEGER DEFAULT 0`,
  `ALTER TABLE monitors ADD COLUMN maintenance_note TEXT DEFAULT NULL`,
  `ALTER TABLE monitors ADD COLUMN maintenance_until DATETIME DEFAULT NULL`,
  // Poly devices maintenance columns
  `ALTER TABLE poly_devices ADD COLUMN maintenance INTEGER DEFAULT 0`,
  `ALTER TABLE poly_devices ADD COLUMN maintenance_note TEXT DEFAULT NULL`,
  `ALTER TABLE poly_devices ADD COLUMN maintenance_until DATETIME DEFAULT NULL`,
  // Threshold alerts dismissed column
  `ALTER TABLE threshold_alerts ADD COLUMN dismissed_at DATETIME DEFAULT NULL`,
  `ALTER TABLE threshold_alerts ADD COLUMN dismissed_by TEXT DEFAULT NULL`,
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
            // Still down after retry - send alert
            console.log(`${monitor.name} confirmed DOWN after retry, sending alert`);
            await sendSlackAlert(monitor, 0, retryResult.message);
            monitorStatus.set(monitor.id, {
              status: 0,
              lastChange: new Date(),
              lastCheck: new Date()
            });
          } else {
            // Recovered during retry period - no alert needed
            console.log(`${monitor.name} recovered during retry period, no alert sent`);
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
  const { username, password } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
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
  const { pos_x, pos_y } = req.body;

  db.prepare('UPDATE monitors SET pos_x = ?, pos_y = ? WHERE id = ?')
    .run(pos_x, pos_y, req.params.id);

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

// Save room position
app.patch('/api/room-positions/:roomId', authMiddleware, (req, res) => {
  const { pos_x, pos_y, floor } = req.body;
  const roomId = req.params.roomId;

  db.prepare(`
    INSERT INTO room_positions (room_id, floor, pos_x, pos_y, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(room_id) DO UPDATE SET
      pos_x = excluded.pos_x,
      pos_y = excluded.pos_y,
      floor = excluded.floor,
      updated_at = CURRENT_TIMESTAMP
  `).run(roomId, floor, pos_x, pos_y);

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

// Update settings
app.put('/api/settings', (req, res) => {
  const allowedKeys = [
    'slack_webhook_url', 'slack_channel', 'slack_enabled',
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
});

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

// Start server
app.listen(PORT, () => {
  const monitorCount = db.prepare('SELECT COUNT(*) as count FROM monitors').get().count;
  console.log(`\n🖥️  Office Monitor running on port ${PORT}`);
  console.log(`📊 Monitors: ${monitorCount}`);
  console.log(`⏱️  Check interval: ${CHECK_INTERVAL / 1000}s`);
  console.log(`🔔 Slack: ${SLACK_WEBHOOK_URL ? 'Configured' : 'Not configured'}`);
  console.log(`📹 Poly Lens: ${POLY_LENS_CLIENT_ID ? 'Configured' : 'Not configured'}\n`);
});
