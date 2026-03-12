# CLAUDE.md - Office Infrastructure Monitor

## About This Project

Office IT monitoring dashboard for tracking network devices, printers, and Zoom Rooms across multiple floors. Single-file architecture (dashboard.html + server.js) running in Docker.

**Stack:** Node.js/Express, SQLite, vanilla JS, WebSocket for real-time updates

**Run:** `docker restart office-monitor` (port 3002)

## Owner

**Angel** - IT/Endpoint Engineer

Device management, endpoint configuration, MDM systems, and IT infrastructure.

## Working Preferences

- Prefers working solutions over incomplete rewrites (V2 was scrapped)
- Likes parallel agents for efficiency
- Always create save points before major changes
- Test in Chrome after changes to verify nothing broke
- Focus on improvements/cleanup, not feature additions
- Be direct, skip unnecessary explanations

## Project History

**Key challenges solved:**
- Icon positioning breaking when sidebar collapsed → migrated from absolute pixels to percentage-based positioning
- Built AI agent prompt for automated dashboard health monitoring
- V2 React rewrite was scrapped (not good enough) → staying with V1

## Project State

- **V1 is production** - the only version, V2 was deleted
- 59 monitored devices (Access Points, Printers, Zoom Rooms)
- 4 floors: 1st, 2nd, 3rd, 5th
- Integrations: Poly Lens, Zoom Rooms API, Slack webhooks

## Key Files

| File | Purpose |
|------|---------|
| `dashboard.html` | Main UI (14K lines, single-file app) |
| `server.js` | Backend API (8K lines) |
| `monitor.db` | SQLite database (367MB) |
| `settings.html` | Admin settings page |

## Code Conventions

- CSS uses design system variables in `:root` (lines 23-92 of dashboard.html)
- Server uses `logger.info/warn/error` not raw `console.log`
- Section markers: `// ==================== SECTION NAME ====================`

## Recent Work (March 2026)

- Removed duplicate routes (/api/incidents, /api/activity-log)
- Consolidated logging to use logger utility
- CSS color consolidation to variables
- UI polish: activity tooltips, device dividers, footer cleanup
- Archived old health reports to docs/archive/

## Rollback

If something breaks:
```bash
git checkout c42c559  # Pre-cleanup save point
```

## Testing Checklist

After changes, verify in Chrome (localhost:3002):
1. Dashboard loads, floor plan displays
2. Floor navigation works
3. WebSocket connects (check "Live" indicator)
4. No console errors
5. Settings page accessible
