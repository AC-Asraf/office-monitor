# CLAUDE.md - Office Infrastructure Monitor

## About This Project

Office IT monitoring dashboard for tracking network devices, printers, and Zoom Rooms across multiple floors. Single-file architecture running in Docker.

**Stack:** Node.js/Express, SQLite, vanilla JS, WebSocket

**Run:** `docker restart office-monitor` (port 3002)

## Key Files

| File | Purpose |
|------|---------|
| `dashboard.html` | Main UI (single-file app) |
| `server.js` | Backend API |
| `monitor.db` | SQLite database |
| `settings.html` | Admin settings page |

## Code Conventions

- CSS uses design system variables in `:root`
- Server uses `logger.info/warn/error` not raw `console.log`
- Section markers: `// ==================== SECTION NAME ====================`

## Development

After changes, verify:
1. Dashboard loads, floor plan displays
2. Floor navigation works
3. WebSocket connects (check "Live" indicator)
4. No console errors
