# Office Monitor - Tablet Installation Guide

Install the Office Infrastructure Monitor as a native-like app on your tablet for wall-mounted displays or portable monitoring.

## Features for Tablet

- **Fullscreen display** - No browser chrome, looks like a native app
- **Landscape orientation** - Optimized for horizontal tablet mounting
- **Touch gestures** - Pinch to zoom, swipe between floors
- **Offline support** - Basic functionality without internet
- **Push notifications** - Get alerts even when app is backgrounded
- **TV Mode** - Auto-cycling display perfect for wall mounting

---

## Installation Instructions

### iPad (iOS/iPadOS)

#### Method 1: Add to Home Screen (Recommended)

1. **Open Safari** (must use Safari, not Chrome or Firefox)
2. **Navigate to your Office Monitor URL**
   ```
   http://YOUR_SERVER_IP:3002/dashboard.html
   ```
3. **Tap the Share button** (square with arrow pointing up)
4. **Scroll down and tap "Add to Home Screen"**
5. **Name the app** "Office Monitor" (or your preference)
6. **Tap "Add"**

The app icon will appear on your home screen and launch in fullscreen mode.

#### Method 2: Guided Access (Kiosk Mode)

For wall-mounted tablets that should only show the dashboard:

1. **Settings > Accessibility > Guided Access**
2. **Turn ON Guided Access**
3. **Set a passcode**
4. **Open Office Monitor app**
5. **Triple-click the side/home button**
6. **Tap "Start"**

The tablet is now locked to the Office Monitor app.

#### iPad Settings for Wall Display

```
Settings to configure:
- Display & Brightness > Auto-Lock: Never
- Display & Brightness > Brightness: Auto or 70-80%
- Accessibility > Guided Access: ON
- Notifications: Allow Office Monitor
- Battery > Low Power Mode: OFF
```

---

### Android Tablet

#### Method 1: Install PWA (Chrome)

1. **Open Chrome browser**
2. **Navigate to your Office Monitor URL**
   ```
   http://YOUR_SERVER_IP:3002/dashboard.html
   ```
3. **Tap the menu (three dots)**
4. **Select "Add to Home screen"** or **"Install app"**
5. **Confirm the installation**

The app icon will appear in your app drawer and home screen.

#### Method 2: Samsung Internet

1. **Open Samsung Internet**
2. **Navigate to your Office Monitor URL**
3. **Tap the menu icon**
4. **Select "Add page to" > "Home screen"**

#### Method 3: Kiosk Mode (Android Enterprise)

For dedicated wall-mounted displays:

```bash
# Using ADB (requires computer)
adb shell dpm set-device-owner com.android.chrome/org.chromium.chrome.browser.ChromeDeviceAdminReceiver

# Then in Chrome, go to:
chrome://flags/#enable-web-app-kiosk-mode
```

#### Android Settings for Wall Display

```
Settings to configure:
- Display > Screen timeout: Never (or maximum)
- Display > Brightness: Manual, 70-80%
- Battery > Battery optimization: Don't optimize for Chrome/PWA
- Apps > Office Monitor > Notifications: Allow
- Security > Screen lock: None (for kiosk use)
```

---

## Server Setup for Tablet

### Local Network Deployment

For tablets on the same network as the server:

1. **Find your server's IP address**
   ```bash
   # macOS
   ipconfig getifaddr en0

   # Linux
   hostname -I

   # Windows
   ipconfig
   ```

2. **Start the server**
   ```bash
   cd office-monitor
   node server.js
   ```

3. **Access from tablet**
   ```
   http://YOUR_SERVER_IP:3002
   ```

### Dedicated Tablet Server

To run the server directly on an Android tablet:

1. **Install Termux** from F-Droid
2. **Install Node.js**
   ```bash
   pkg install nodejs
   ```
3. **Copy the project files** to the tablet
4. **Run the server**
   ```bash
   cd office-monitor
   node server.js
   ```
5. **Access via localhost**
   ```
   http://localhost:3002
   ```

---

## TV Mode for Wall Mounting

### Auto-Launch TV Mode

Add `?tvmode=true` to the URL to auto-launch in TV mode:
```
http://YOUR_SERVER_IP:3002/dashboard.html?tvmode=true
```

### TV Mode Features

- Auto-cycles through floors every 30 seconds
- Larger fonts for visibility
- Hides admin controls
- Shows current time prominently
- Click anywhere or X button to exit

---

## Recommended Hardware

### Wall-Mounted Tablets

| Device | Screen Size | Best For |
|--------|-------------|----------|
| iPad Pro 12.9" | 12.9" | Large conference rooms |
| iPad 10.2" | 10.2" | Standard wall mount |
| Samsung Galaxy Tab S8+ | 12.4" | Android option |
| Amazon Fire HD 10 | 10.1" | Budget option |

### Mounting Solutions

- **Tablet wall mounts** - VESA compatible or adhesive
- **Charging mounts** - Keep tablet powered 24/7
- **Enclosures** - Protect from tampering

### Power Considerations

- Use a powered mount or nearby outlet
- Enable USB power delivery for continuous operation
- Consider a UPS for critical displays

---

## Troubleshooting

### App won't install as PWA

- **iPad**: Must use Safari browser
- **Android**: Try clearing Chrome cache, then reinstall
- **Check**: Server must use HTTPS for some PWA features

### Notifications not working

1. Check notification permissions in device settings
2. Ensure the server is accessible
3. Test with a ping from another device

### Screen turns off

- Disable auto-lock/screen timeout
- Use a "keep screen on" app if needed
- Check power/charging connection

### Touch not responding in fullscreen

- Exit and re-enter the app
- Check for system gesture conflicts
- Restart the tablet

### Connection lost frequently

- Check WiFi signal strength
- Use 5GHz WiFi if available
- Consider a wired connection (USB-C to Ethernet)

---

## Network Requirements

| Feature | Requirement |
|---------|-------------|
| Basic display | HTTP access to server |
| PWA install | HTTPS recommended |
| Push notifications | HTTPS required |
| WebSocket updates | Port 3002 open |

### Firewall Rules

Allow these connections from the tablet:
```
TCP 3002 (or your configured port) - WebSocket + HTTP
```

---

## Files Included

```
deploy/tablet/
├── manifest.json       # Enhanced PWA manifest for tablets
├── README.md          # This installation guide
└── setup-tablet.sh    # Optional: Auto-configure script
```

### Updating the Manifest

To use the tablet-optimized manifest:
```bash
cp deploy/tablet/manifest.json ./manifest.json
```

Key differences from default manifest:
- `display: fullscreen` (instead of standalone)
- `orientation: landscape`
- TV Mode shortcut included
