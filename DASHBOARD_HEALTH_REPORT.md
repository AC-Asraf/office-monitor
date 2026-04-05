# Dashboard Health Report - Office Monitor
**Date:** 2026-04-04
**Time:** 12:03:11 PM
**Dashboard URL:** http://localhost:3002/dashboard.html
**Test Duration:** 20s per category

---

## Executive Summary

**Overall Health Score:** NEEDS ATTENTION
**Pass Rate:** 0.0%
**Tests Passed:** 0
**Tests Failed:** 17
**Total Tests:** 17

---

## Test Results by Category

### ❌ Server Health (0% pass rate)

| Test | Status | Details | Duration |
|------|--------|---------|----------|
| Health Check #1 | ✗ FAIL | Request timeout | 1033786ms |

### ❌ API Endpoints (0% pass rate)

| Test | Status | Details | Duration |
|------|--------|---------|----------|
| Get All Monitors #1 | ✗ FAIL | Request timeout | 30001ms |
| Get Monitors By Floor #1 | ✗ FAIL | Request timeout | 1007577ms |
| Get Poly Lens Devices #1 | ✗ FAIL | Request timeout | 47763ms |
| Get Poly Lens By Floor #1 | ✗ FAIL | Request timeout | 30003ms |
| Get Floor Plans #1 | ✗ FAIL | Request timeout | 1910294ms |
| Get Floor Zones #1 | ✗ FAIL | Request timeout | 637745ms |
| Get Room Positions #1 | ✗ FAIL | Request timeout | 30003ms |
| Get Settings #1 | ✗ FAIL | Request timeout | 1073578ms |
| Get Health Scores #1 | ✗ FAIL | Request timeout | 611590ms |

### ❌ Database (0% pass rate)

| Test | Status | Details | Duration |
|------|--------|---------|----------|
| Operations #1 | ✗ FAIL | Request timeout | 30003ms |

### ❌ Monitoring (0% pass rate)

| Test | Status | Details | Duration |
|------|--------|---------|----------|
| Check #1 | ✗ FAIL | Request timeout | 0ms |

### ❌ Printers (0% pass rate)

| Test | Status | Details | Duration |
|------|--------|---------|----------|
| Test #1 | ✗ FAIL | Request timeout | 30001ms |

### ❌ Dashboard (0% pass rate)

| Test | Status | Details | Duration |
|------|--------|---------|----------|
| Feature Test #1 | ✗ FAIL | Request timeout | 0ms |

### ❌ Analytics (0% pass rate)

| Test | Status | Details | Duration |
|------|--------|---------|----------|
| Test #1 | ✗ FAIL | Request timeout | 0ms |

### ❌ Poly Lens (0% pass rate)

| Test | Status | Details | Duration |
|------|--------|---------|----------|
| Test #1 | ✗ FAIL | Request timeout | 1001621ms |

### ❌ 3D View (0% pass rate)

| Test | Status | Details | Duration |
|------|--------|---------|----------|
| Test #1 | ✗ FAIL | Request timeout | 0ms |

---

## Failed Tests Summary

- **Server Health / Health Check #1**: Request timeout
- **API Endpoints / Get All Monitors #1**: Request timeout
- **API Endpoints / Get Monitors By Floor #1**: Request timeout
- **API Endpoints / Get Poly Lens Devices #1**: Request timeout
- **API Endpoints / Get Poly Lens By Floor #1**: Request timeout
- **API Endpoints / Get Floor Plans #1**: Request timeout
- **API Endpoints / Get Floor Zones #1**: Request timeout
- **API Endpoints / Get Room Positions #1**: Request timeout
- **API Endpoints / Get Settings #1**: Request timeout
- **API Endpoints / Get Health Scores #1**: Request timeout
- **Database / Operations #1**: Request timeout
- **Monitoring / Check #1**: Request timeout
- **Printers / Test #1**: Request timeout
- **Dashboard / Feature Test #1**: Request timeout
- **Analytics / Test #1**: Request timeout
- **Poly Lens / Test #1**: Request timeout
- **3D View / Test #1**: Request timeout

---

## Recommendations

1. **URGENT**: Multiple test failures detected
2. Check if server is running: `curl http://localhost:3002/api/health`
3. Review server logs: `pm2 logs office-monitor`
4. Restart server if necessary: `pm2 restart office-monitor`

---

**Report Generated:** 2026-04-04T09:03:11.078Z
**Test Categories:** 9
**Total Test Duration:** ~3.0 minutes
