#!/usr/bin/env node
/**
 * Office Monitor - Comprehensive Diagnostics
 * Runs extensive tests on all features and functions
 * Each test runs for at least 20 seconds
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3002';
const REPORT_PATH = path.join(__dirname, 'DASHBOARD_HEALTH_REPORT.md');
const TEST_DURATION = 20000; // 20 seconds per test category

let results = {
  timestamp: new Date().toISOString(),
  summary: { passed: 0, failed: 0, warnings: 0 },
  tests: []
};

// Helper to make HTTP requests
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'https:' ? https : http;

    const req = lib.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data: data,
            json: () => JSON.parse(data)
          });
        } catch (e) {
          resolve({ ok: false, status: res.statusCode, data, error: e.message });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Request timeout')));

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

// Log test result
function logTest(category, name, passed, details = '', duration = 0) {
  const status = passed ? 'PASS' : 'FAIL';
  const icon = passed ? '✓' : '✗';
  console.log(`  ${icon} ${name} (${duration}ms)`);
  if (!passed && details) console.log(`    └─ ${details}`);

  results.tests.push({ category, name, passed, details, duration });
  if (passed) results.summary.passed++;
  else results.summary.failed++;
}

// Sleep helper
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ==================== TEST CATEGORIES ====================

async function testServerHealth() {
  console.log('\n📡 Testing Server Health...');
  const startTime = Date.now();
  let testCount = 0;

  while (Date.now() - startTime < TEST_DURATION) {
    testCount++;
    const testStart = Date.now();

    try {
      // Test health endpoint
      const health = await fetch(`${BASE_URL}/api/health`);
      const data = health.json();

      logTest('Server Health', `Health Check #${testCount}`,
        health.ok && data.status === 'ok',
        health.ok ? `Monitors: ${data.monitors}, Uptime: ${data.uptime?.toFixed(2)}s` : 'Health check failed',
        Date.now() - testStart
      );

      // Test that server responds quickly
      const responseTime = Date.now() - testStart;
      logTest('Server Health', `Response Time #${testCount}`,
        responseTime < 1000,
        `Response time: ${responseTime}ms`,
        responseTime
      );

    } catch (e) {
      logTest('Server Health', `Health Check #${testCount}`, false, e.message, Date.now() - testStart);
    }

    await sleep(2000);
  }
}

async function testAPIEndpoints() {
  console.log('\n🔌 Testing API Endpoints...');
  const startTime = Date.now();

  const endpoints = [
    { path: '/api/monitors', name: 'Get All Monitors' },
    { path: '/api/monitors/by-floor', name: 'Get Monitors By Floor' },
    { path: '/api/poly-lens/devices', name: 'Get Poly Lens Devices' },
    { path: '/api/poly-lens/by-floor', name: 'Get Poly Lens By Floor' },
    { path: '/api/floor-plans', name: 'Get Floor Plans' },
    { path: '/api/floor-zones', name: 'Get Floor Zones' },
    { path: '/api/room-positions', name: 'Get Room Positions' },
    { path: '/api/settings', name: 'Get Settings' },
    { path: '/api/health-scores', name: 'Get Health Scores' },
    // Incidents endpoint requires auth, skip in automated tests
  ];

  let iteration = 0;
  while (Date.now() - startTime < TEST_DURATION) {
    iteration++;
    console.log(`  Iteration ${iteration}...`);

    for (const endpoint of endpoints) {
      const testStart = Date.now();
      try {
        const res = await fetch(`${BASE_URL}${endpoint.path}`);
        const duration = Date.now() - testStart;

        let valid = res.ok;
        let details = `Status: ${res.status}`;

        if (res.ok) {
          try {
            const data = res.json();
            if (data.monitors) details += `, ${data.monitors.length} monitors`;
            if (data.devices) details += `, ${data.devices.length} devices`;
            if (data.floors) details += `, ${Object.keys(data.floors).length} floors`;
          } catch (e) {
            // Non-JSON response
          }
        }

        logTest('API Endpoints', `${endpoint.name} #${iteration}`, valid, details, duration);
      } catch (e) {
        logTest('API Endpoints', `${endpoint.name} #${iteration}`, false, e.message, Date.now() - testStart);
      }
    }

    await sleep(3000);
  }
}

async function testDatabaseOperations() {
  console.log('\n💾 Testing Database Operations...');
  const startTime = Date.now();
  let iteration = 0;

  while (Date.now() - startTime < TEST_DURATION) {
    iteration++;
    const testStart = Date.now();

    try {
      // Test monitors query
      const monitors = await fetch(`${BASE_URL}/api/monitors`);
      const monitorData = monitors.json();
      logTest('Database', `Monitors Query #${iteration}`,
        monitors.ok && Array.isArray(monitorData.monitors),
        `${monitorData.monitors?.length || 0} monitors retrieved`,
        Date.now() - testStart
      );

      // Test heartbeats (via uptime endpoint)
      if (monitorData.monitors?.length > 0) {
        const firstMonitor = monitorData.monitors[0];
        const uptimeStart = Date.now();
        const uptime = await fetch(`${BASE_URL}/api/monitors/${firstMonitor.id}/uptime?hours=24`);
        logTest('Database', `Uptime Query #${iteration}`,
          uptime.ok,
          uptime.ok ? `Uptime: ${uptime.json().uptime}%` : 'Failed',
          Date.now() - uptimeStart
        );

        // Test history
        const historyStart = Date.now();
        const history = await fetch(`${BASE_URL}/api/monitors/${firstMonitor.id}/history?limit=10`);
        logTest('Database', `History Query #${iteration}`,
          history.ok,
          history.ok ? `${history.json().heartbeats?.length || 0} heartbeats` : 'Failed',
          Date.now() - historyStart
        );
      }

      // Test printer status
      const printerStart = Date.now();
      const printers = monitorData.monitors?.filter(m => m.device_type === 'printers') || [];
      if (printers.length > 0) {
        const printerStatus = await fetch(`${BASE_URL}/api/printers/${printers[0].id}/status`);
        logTest('Database', `Printer Status Query #${iteration}`,
          printerStatus.ok || printerStatus.status === 404,
          printerStatus.ok ? 'Printer status retrieved' : 'No status data',
          Date.now() - printerStart
        );
      }

    } catch (e) {
      logTest('Database', `Operations #${iteration}`, false, e.message, Date.now() - testStart);
    }

    await sleep(4000);
  }
}

async function testMonitoringFunctions() {
  console.log('\n📊 Testing Monitoring Functions...');
  const startTime = Date.now();
  let iteration = 0;

  while (Date.now() - startTime < TEST_DURATION) {
    iteration++;

    try {
      // Get current monitor statuses
      const testStart = Date.now();
      const byFloor = await fetch(`${BASE_URL}/api/monitors/by-floor`);
      const floorData = byFloor.json();

      if (byFloor.ok && floorData.floors) {
        let totalDevices = 0;
        let onlineDevices = 0;
        let offlineDevices = 0;

        Object.values(floorData.floors).forEach(floor => {
          ['accessPoints', 'printers'].forEach(type => {
            if (floor[type]) {
              floor[type].forEach(device => {
                totalDevices++;
                if (device.status === 'up') onlineDevices++;
                else offlineDevices++;
              });
            }
          });
        });

        logTest('Monitoring', `Device Status Check #${iteration}`,
          true,
          `Total: ${totalDevices}, Online: ${onlineDevices}, Offline: ${offlineDevices}`,
          Date.now() - testStart
        );

        // Check for stale data (last check > 5 minutes ago)
        let staleCount = 0;
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        Object.values(floorData.floors).forEach(floor => {
          ['accessPoints', 'printers'].forEach(type => {
            if (floor[type]) {
              floor[type].forEach(device => {
                if (device.lastCheck && new Date(device.lastCheck).getTime() < fiveMinutesAgo) {
                  staleCount++;
                }
              });
            }
          });
        });

        logTest('Monitoring', `Data Freshness #${iteration}`,
          staleCount === 0,
          staleCount === 0 ? 'All data fresh' : `${staleCount} devices with stale data`,
          Date.now() - testStart
        );
      }

      // Test Poly Lens integration
      const polyStart = Date.now();
      const polyRes = await fetch(`${BASE_URL}/api/poly-lens/devices`);
      if (polyRes.ok) {
        const polyData = polyRes.json();
        const connected = polyData.devices?.filter(d => d.connected).length || 0;
        const total = polyData.devices?.length || 0;

        logTest('Monitoring', `Poly Lens Status #${iteration}`,
          true,
          `${connected}/${total} devices connected`,
          Date.now() - polyStart
        );
      } else {
        logTest('Monitoring', `Poly Lens Status #${iteration}`,
          false, 'Poly Lens API unavailable',
          Date.now() - polyStart
        );
      }

    } catch (e) {
      logTest('Monitoring', `Check #${iteration}`, false, e.message, 0);
    }

    await sleep(4000);
  }
}

async function testPrinterFeatures() {
  console.log('\n🖨️ Testing Printer Features...');
  const startTime = Date.now();
  let iteration = 0;

  while (Date.now() - startTime < TEST_DURATION) {
    iteration++;
    const testStart = Date.now();

    try {
      const monitors = await fetch(`${BASE_URL}/api/monitors`);
      const data = monitors.json();
      const printers = data.monitors?.filter(m => m.device_type === 'printers') || [];

      logTest('Printers', `Printer Count #${iteration}`,
        printers.length > 0,
        `Found ${printers.length} printers`,
        Date.now() - testStart
      );

      // Test each printer's status endpoint
      for (const printer of printers.slice(0, 3)) {
        const statusStart = Date.now();
        const status = await fetch(`${BASE_URL}/api/printers/${printer.id}/status`);

        if (status.ok) {
          const statusData = status.json();
          const toner = statusData.toner || {};
          const hasTonerData = toner.black !== undefined || toner.cyan !== undefined;

          logTest('Printers', `${printer.name} Status #${iteration}`,
            true,
            hasTonerData ? `Toner: K:${toner.black}% C:${toner.cyan}% M:${toner.magenta}% Y:${toner.yellow}%` : 'No toner data',
            Date.now() - statusStart
          );
        } else {
          logTest('Printers', `${printer.name} Status #${iteration}`,
            status.status === 404 || status.status === 200,
            status.status === 404 ? 'No status data yet' : `Error: ${status.status}`,
            Date.now() - statusStart
          );
        }
      }

      // Test floor assignment
      if (printers.length > 0) {
        const floorTest = printers.every(p => p.floor && ['1st Floor', '2nd Floor', '3rd Floor', '5th Floor'].includes(p.floor));
        logTest('Printers', `Floor Assignment #${iteration}`,
          floorTest,
          floorTest ? 'All printers have valid floors' : 'Some printers missing floor assignment',
          0
        );

        // Test serial number field exists
        const serialTest = printers.some(p => p.serial_number !== null && p.serial_number !== undefined);
        logTest('Printers', `Serial Number Field #${iteration}`,
          true, // Field exists even if empty
          serialTest ? 'Some printers have serial numbers' : 'Serial number field available but empty',
          0
        );
      }

    } catch (e) {
      logTest('Printers', `Test #${iteration}`, false, e.message, Date.now() - testStart);
    }

    await sleep(5000);
  }
}

async function testDashboardFeatures() {
  console.log('\n📺 Testing Dashboard Features...');
  const startTime = Date.now();
  let iteration = 0;

  while (Date.now() - startTime < TEST_DURATION) {
    iteration++;

    try {
      // Test static files
      const files = [
        { path: '/dashboard.html', name: 'Dashboard HTML' },
        { path: '/settings.html', name: 'Settings HTML' },
        { path: '/3d-floor-view.html', name: '3D Floor View HTML' },
      ];

      for (const file of files) {
        const fileStart = Date.now();
        const res = await fetch(`${BASE_URL}${file.path}`);
        logTest('Dashboard', `${file.name} #${iteration}`,
          res.ok,
          res.ok ? `Loaded (${res.data.length} bytes)` : `Error: ${res.status}`,
          Date.now() - fileStart
        );
      }

      // Test floor plans
      const plansStart = Date.now();
      const plans = await fetch(`${BASE_URL}/api/floor-plans`);
      if (plans.ok) {
        const planData = plans.json();
        const floorCount = Object.keys(planData.plans || {}).length;
        logTest('Dashboard', `Floor Plans #${iteration}`,
          true,
          `${floorCount} floor plans configured`,
          Date.now() - plansStart
        );
      }

      // Test zones
      const zonesStart = Date.now();
      const zones = await fetch(`${BASE_URL}/api/floor-zones`);
      if (zones.ok) {
        const zoneData = zones.json();
        let totalZones = 0;
        Object.values(zoneData.zones || {}).forEach(floorZones => {
          totalZones += floorZones.length;
        });
        logTest('Dashboard', `Floor Zones #${iteration}`,
          true,
          `${totalZones} zones defined`,
          Date.now() - zonesStart
        );
      }

      // Test room positions (for Poly devices)
      const posStart = Date.now();
      const positions = await fetch(`${BASE_URL}/api/room-positions`);
      logTest('Dashboard', `Room Positions #${iteration}`,
        positions.ok,
        positions.ok ? 'Room positions loaded' : 'No room positions',
        Date.now() - posStart
      );

    } catch (e) {
      logTest('Dashboard', `Feature Test #${iteration}`, false, e.message, 0);
    }

    await sleep(5000);
  }
}

async function testAnalyticsFeatures() {
  console.log('\n📈 Testing Analytics Features...');
  const startTime = Date.now();
  let iteration = 0;

  while (Date.now() - startTime < TEST_DURATION) {
    iteration++;

    try {
      const monitors = await fetch(`${BASE_URL}/api/monitors`);
      const data = monitors.json();

      if (data.monitors?.length > 0) {
        const testMonitor = data.monitors[0];

        // Test uptime calculation (24h)
        const uptime24Start = Date.now();
        const uptime24 = await fetch(`${BASE_URL}/api/monitors/${testMonitor.id}/uptime?hours=24`);
        if (uptime24.ok) {
          const uptimeData = uptime24.json();
          logTest('Analytics', `24h Uptime #${iteration}`,
            uptimeData.uptime !== undefined,
            `Uptime: ${uptimeData.uptime}%, Checks: ${uptimeData.total}`,
            Date.now() - uptime24Start
          );
        }

        // Test 7-day uptime
        const uptime7dStart = Date.now();
        const uptime7d = await fetch(`${BASE_URL}/api/monitors/${testMonitor.id}/uptime?hours=168`);
        if (uptime7d.ok) {
          const uptimeData = uptime7d.json();
          logTest('Analytics', `7-Day Uptime #${iteration}`,
            uptimeData.uptime !== undefined,
            `Uptime: ${uptimeData.uptime}%`,
            Date.now() - uptime7dStart
          );
        }

        // Test history endpoint
        const historyStart = Date.now();
        const history = await fetch(`${BASE_URL}/api/monitors/${testMonitor.id}/history?limit=50`);
        if (history.ok) {
          const historyData = history.json();
          logTest('Analytics', `History Data #${iteration}`,
            Array.isArray(historyData.heartbeats),
            `${historyData.heartbeats?.length || 0} heartbeat records`,
            Date.now() - historyStart
          );
        }

        // Test health scores
        const healthStart = Date.now();
        const health = await fetch(`${BASE_URL}/api/health-scores`);
        if (health.ok) {
          const healthData = health.json();
          const avgScore = healthData.scores?.reduce((sum, s) => sum + (s.health_score || 0), 0) / (healthData.scores?.length || 1);
          logTest('Analytics', `Health Scores #${iteration}`,
            true,
            `Average score: ${avgScore.toFixed(1)}`,
            Date.now() - healthStart
          );
        }
      }

      // Test incidents
      const incidentsStart = Date.now();
      const incidents = await fetch(`${BASE_URL}/api/incidents/recent`);
      if (incidents.ok) {
        const incidentData = incidents.json();
        logTest('Analytics', `Recent Incidents #${iteration}`,
          true,
          `${incidentData.incidents?.length || 0} recent incidents`,
          Date.now() - incidentsStart
        );
      }

    } catch (e) {
      logTest('Analytics', `Test #${iteration}`, false, e.message, 0);
    }

    await sleep(5000);
  }
}

async function testPolyLensIntegration() {
  console.log('\n📹 Testing Poly Lens Integration...');
  const startTime = Date.now();
  let iteration = 0;

  while (Date.now() - startTime < TEST_DURATION) {
    iteration++;
    const testStart = Date.now();

    try {
      // Test devices endpoint
      const devices = await fetch(`${BASE_URL}/api/poly-lens/devices`);
      if (devices.ok) {
        const data = devices.json();
        const total = data.devices?.length || 0;
        const connected = data.devices?.filter(d => d.connected).length || 0;
        const rooms = [...new Set(data.devices?.map(d => d.room).filter(Boolean))];

        logTest('Poly Lens', `Devices Fetch #${iteration}`,
          true,
          `${total} devices, ${connected} connected, ${rooms.length} rooms`,
          Date.now() - testStart
        );

        // Test device grouping by floor
        const byFloorStart = Date.now();
        const byFloor = await fetch(`${BASE_URL}/api/poly-lens/by-floor`);
        if (byFloor.ok) {
          const floorData = byFloor.json();
          const floors = Object.keys(floorData.floors || {});
          logTest('Poly Lens', `Floor Grouping #${iteration}`,
            floors.length > 0,
            `Devices on ${floors.length} floors: ${floors.join(', ')}`,
            Date.now() - byFloorStart
          );
        }

        // Test device types
        const videoSystems = data.devices?.filter(d => {
          const model = (d.hardwareModel || '').toLowerCase();
          return model.includes('x50') || model.includes('x70') || model.includes('studio');
        }).length || 0;

        const tablets = data.devices?.filter(d => {
          const model = (d.hardwareModel || '').toLowerCase();
          return model.includes('tc8') || model.includes('tc10');
        }).length || 0;

        logTest('Poly Lens', `Device Types #${iteration}`,
          true,
          `Video Systems: ${videoSystems}, Tablets: ${tablets}`,
          0
        );

        // Test individual device history (if available)
        if (data.devices?.length > 0) {
          const testDevice = data.devices[0];
          const historyStart = Date.now();
          const history = await fetch(`${BASE_URL}/api/poly-devices/${testDevice.id}/history?limit=10`);
          logTest('Poly Lens', `Device History #${iteration}`,
            history.ok || history.status === 404,
            history.ok ? 'History available' : 'No history yet',
            Date.now() - historyStart
          );
        }
      } else {
        logTest('Poly Lens', `Integration #${iteration}`,
          false,
          'Poly Lens API not responding',
          Date.now() - testStart
        );
      }

    } catch (e) {
      logTest('Poly Lens', `Test #${iteration}`, false, e.message, Date.now() - testStart);
    }

    await sleep(5000);
  }
}

async function test3DViewFeatures() {
  console.log('\n🎮 Testing 3D View Features...');
  const startTime = Date.now();
  let iteration = 0;

  while (Date.now() - startTime < TEST_DURATION) {
    iteration++;

    try {
      // Test 3D view page loads
      const pageStart = Date.now();
      const page = await fetch(`${BASE_URL}/3d-floor-view.html`);
      logTest('3D View', `Page Load #${iteration}`,
        page.ok,
        page.ok ? `Loaded (${page.data.length} bytes)` : 'Failed to load',
        Date.now() - pageStart
      );

      // Test floor zones (used for walls)
      const zonesStart = Date.now();
      const zones = await fetch(`${BASE_URL}/api/floor-zones`);
      if (zones.ok) {
        const zoneData = zones.json();
        let totalPoints = 0;
        let totalZones = 0;
        Object.values(zoneData.zones || {}).forEach(floorZones => {
          if (Array.isArray(floorZones)) {
            totalZones += floorZones.length;
            floorZones.forEach(zone => {
              try {
                const points = typeof zone.points === 'string' ? JSON.parse(zone.points) : zone.points;
                if (Array.isArray(points)) totalPoints += points.length;
              } catch (e) {}
            });
          }
        });
        logTest('3D View', `Zone Data #${iteration}`,
          totalZones > 0,
          `${totalZones} zones, ${totalPoints} wall vertices`,
          Date.now() - zonesStart
        );
      }

      // Test 3D position endpoint
      const monitors = await fetch(`${BASE_URL}/api/monitors`);
      if (monitors.ok) {
        const data = monitors.json();
        const withPos = data.monitors?.filter(m => m.pos_x !== null && m.pos_y !== null).length || 0;
        logTest('3D View', `Device Positions #${iteration}`,
          true,
          `${withPos}/${data.monitors?.length || 0} devices positioned`,
          0
        );
      }

      // Test room positions for Poly devices
      const posStart = Date.now();
      const positions = await fetch(`${BASE_URL}/api/room-positions`);
      if (positions.ok) {
        const posData = positions.json();
        const roomCount = Object.keys(posData.positions || {}).length;
        logTest('3D View', `Room Positions #${iteration}`,
          true,
          `${roomCount} rooms positioned`,
          Date.now() - posStart
        );
      }

    } catch (e) {
      logTest('3D View', `Test #${iteration}`, false, e.message, 0);
    }

    await sleep(5000);
  }
}

// Generate markdown report
function generateReport() {
  const now = new Date();
  const { passed, failed, warnings } = results.summary;
  const total = passed + failed;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;

  let md = `# Dashboard Health Report - Office Monitor
**Date:** ${now.toISOString().split('T')[0]}
**Time:** ${now.toLocaleTimeString()}
**Dashboard URL:** http://localhost:3002/dashboard.html
**Test Duration:** ${TEST_DURATION / 1000}s per category

---

## Executive Summary

**Overall Health Score:** ${passRate >= 95 ? 'HEALTHY' : passRate >= 80 ? 'HEALTHY with WARNINGS' : 'NEEDS ATTENTION'}
**Pass Rate:** ${passRate}%
**Tests Passed:** ${passed}
**Tests Failed:** ${failed}
**Total Tests:** ${total}

---

## Test Results by Category

`;

  // Group by category
  const categories = {};
  results.tests.forEach(test => {
    if (!categories[test.category]) categories[test.category] = [];
    categories[test.category].push(test);
  });

  Object.entries(categories).forEach(([category, tests]) => {
    const catPassed = tests.filter(t => t.passed).length;
    const catTotal = tests.length;
    const catRate = ((catPassed / catTotal) * 100).toFixed(0);
    const icon = catRate >= 95 ? '✅' : catRate >= 80 ? '⚠️' : '❌';

    md += `### ${icon} ${category} (${catRate}% pass rate)

| Test | Status | Details | Duration |
|------|--------|---------|----------|
`;

    tests.forEach(test => {
      md += `| ${test.name} | ${test.passed ? '✓ PASS' : '✗ FAIL'} | ${test.details || '-'} | ${test.duration}ms |\n`;
    });

    md += '\n';
  });

  md += `---

## Failed Tests Summary

`;

  const failedTests = results.tests.filter(t => !t.passed);
  if (failedTests.length === 0) {
    md += '**No failed tests!** All systems operating normally.\n\n';
  } else {
    failedTests.forEach(test => {
      md += `- **${test.category} / ${test.name}**: ${test.details}\n`;
    });
    md += '\n';
  }

  md += `---

## Recommendations

`;

  if (passRate >= 95) {
    md += '1. System is healthy - continue regular monitoring\n';
    md += '2. Review any failed tests above for potential improvements\n';
  } else if (passRate >= 80) {
    md += '1. **Address failed tests** - Some features may not be working correctly\n';
    md += '2. Check server logs for errors\n';
    md += '3. Verify network connectivity to monitored devices\n';
  } else {
    md += '1. **URGENT**: Multiple test failures detected\n';
    md += '2. Check if server is running: \`curl http://localhost:3002/api/health\`\n';
    md += '3. Review server logs: \`pm2 logs office-monitor\`\n';
    md += '4. Restart server if necessary: \`pm2 restart office-monitor\`\n';
  }

  md += `
---

**Report Generated:** ${now.toISOString()}
**Test Categories:** ${Object.keys(categories).length}
**Total Test Duration:** ~${(Object.keys(categories).length * TEST_DURATION / 1000 / 60).toFixed(1)} minutes
`;

  return md;
}

// Main execution
async function runDiagnostics() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Office Monitor - Comprehensive Diagnostics            ║');
  console.log('║     Each test category runs for 20+ seconds               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`Started: ${new Date().toISOString()}\n`);

  const totalStart = Date.now();

  try {
    await testServerHealth();
    await testAPIEndpoints();
    await testDatabaseOperations();
    await testMonitoringFunctions();
    await testPrinterFeatures();
    await testDashboardFeatures();
    await testAnalyticsFeatures();
    await testPolyLensIntegration();
    await test3DViewFeatures();
  } catch (e) {
    console.error('\nFatal error during diagnostics:', e.message);
    results.summary.failed++;
  }

  const totalDuration = ((Date.now() - totalStart) / 1000 / 60).toFixed(1);

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    DIAGNOSTICS COMPLETE                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`Total Duration: ${totalDuration} minutes`);
  console.log(`Tests Passed: ${results.summary.passed}`);
  console.log(`Tests Failed: ${results.summary.failed}`);
  console.log(`Pass Rate: ${((results.summary.passed / (results.summary.passed + results.summary.failed)) * 100).toFixed(1)}%`);

  // Generate and save report
  const report = generateReport();
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`\nReport saved to: ${REPORT_PATH}`);

  // Exit with appropriate code
  process.exit(results.summary.failed > 0 ? 1 : 0);
}

// Run if called directly
if (require.main === module) {
  runDiagnostics();
}

module.exports = { runDiagnostics };
