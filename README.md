# Office Infrastructure Monitor

A comprehensive monitoring dashboard for office infrastructure including network devices (Access Points, Printers) and Zoom Rooms (via Poly Lens API).

## Features

- **Real-time Monitoring**: Monitor network devices with configurable ping intervals
- **Floor Plan Visualization**: Interactive floor plans with device positioning
- **Poly Lens Integration**: Monitor Zoom Room devices via Poly Lens API
- **Slack Notifications**: Receive alerts when devices go offline (with retry logic to prevent false alerts)
- **Analytics Dashboard**: View uptime statistics, history, and trends for all devices
- **User Management**: Role-based access control (admin/user)
- **Drag & Drop Positioning**: Position devices on floor plans with edit mode

## Prerequisites

- Node.js 18+
- npm or yarn
- (Optional) Slack workspace for notifications
- (Optional) Poly Lens account for Zoom Room monitoring

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/office-monitor.git
   cd office-monitor
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your configuration:
   - Set your Slack webhook URL and channel
   - Set your Poly Lens API credentials (if using Zoom Room monitoring)
   - **Important**: Change the default admin username and password!

4. **Start the server**
   ```bash
   npm start
   ```

5. **Access the dashboard**

   Open the `dashboard.html` file in your browser, or serve it via a web server.

   The API runs on `http://localhost:3002` by default.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3002` |
| `SLACK_WEBHOOK_URL` | Slack webhook for notifications | - |
| `SLACK_CHANNEL` | Slack channel name | - |
| `POLY_LENS_CLIENT_ID` | Poly Lens API client ID | - |
| `POLY_LENS_CLIENT_SECRET` | Poly Lens API client secret | - |
| `CHECK_INTERVAL` | Monitoring interval (ms) | `30000` |
| `PING_TIMEOUT` | Ping timeout (ms) | `5000` |
| `DEFAULT_ADMIN_USERNAME` | Initial admin username | `admin` |
| `DEFAULT_ADMIN_PASSWORD` | Initial admin password | `admin123` |

### Slack Notifications

1. Create a Slack App at https://api.slack.com/apps
2. Enable Incoming Webhooks
3. Create a webhook for your channel
4. Add the webhook URL to your `.env` file

### Poly Lens Integration

1. Sign up for Poly Lens at https://lens.poly.com
2. Create an API application in the developer portal
3. Add your client ID and secret to the `.env` file

## Adding Monitors

### Via Dashboard

1. Log in with admin credentials
2. Open the settings panel (gear icon)
3. Add monitors with:
   - Name
   - Type (ping/http)
   - Hostname or URL
   - Floor assignment
   - Device type (Access Point, Printer, etc.)

### Via API

```bash
curl -X POST http://localhost:3002/api/monitors \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "AP-Floor1",
    "type": "ping",
    "hostname": "192.168.1.100",
    "floor": "1st Floor",
    "device_type": "accessPoint"
  }'
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login and get token
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Monitors
- `GET /api/monitors` - List all monitors
- `POST /api/monitors` - Add monitor
- `PUT /api/monitors/:id` - Update monitor
- `DELETE /api/monitors/:id` - Delete monitor
- `GET /api/monitors/:id/history` - Get heartbeat history
- `GET /api/monitors/:id/uptime` - Get uptime statistics

### Poly Lens
- `GET /api/poly-lens/devices` - List Poly Lens devices
- `GET /api/poly-lens/by-floor` - Devices grouped by floor
- `GET /api/poly-devices/:id/history` - Device history
- `GET /api/poly-devices/:id/uptime` - Device uptime

### Floor Plans
- `GET /api/floor-plans` - List floor plans
- `PUT /api/floor-plans/:floor` - Upload floor plan image

## Running with PM2 (Production)

```bash
# Install PM2
npm install -g pm2

# Start the application
pm2 start server.js --name office-monitor

# View logs
pm2 logs office-monitor

# Restart
pm2 restart office-monitor

# Stop
pm2 stop office-monitor
```

## Database

The application uses SQLite for data storage. The database file (`monitor.db`) is created automatically on first run and contains:

- Monitors configuration
- Heartbeat history
- User accounts
- Floor plans
- Device positions
- Poly Lens device tracking

## Troubleshooting

### Devices showing as offline incorrectly
- Check network connectivity to the device
- Verify the hostname/IP is correct
- Increase `PING_TIMEOUT` if devices are slow to respond

### Slack notifications not working
- Verify your webhook URL is correct
- Check the Slack channel exists
- Look at server logs for error messages

### Poly Lens not fetching devices
- Verify API credentials are correct
- Check if your Poly Lens subscription includes API access
- Look at server logs for authentication errors

## License

MIT License - see LICENSE file for details

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

For issues and feature requests, please use the GitHub Issues page.
