#!/bin/bash
# Office Monitor - Tablet Setup Script
# Run this on the server to prepare for tablet deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║         Office Monitor - Tablet Setup                     ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Get the project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

# Get server IP
echo -e "${CYAN}Detecting network configuration...${NC}"
if command -v ipconfig &> /dev/null; then
    # macOS
    SERVER_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "Unable to detect")
elif command -v hostname &> /dev/null; then
    # Linux
    SERVER_IP=$(hostname -I | awk '{print $1}')
else
    SERVER_IP="Unable to detect"
fi

echo ""
echo -e "${GREEN}Server Configuration${NC}"
echo "===================="
echo -e "Server IP:     ${CYAN}$SERVER_IP${NC}"
echo -e "Dashboard URL: ${CYAN}http://$SERVER_IP:3002/dashboard.html${NC}"
echo -e "TV Mode URL:   ${CYAN}http://$SERVER_IP:3002/dashboard.html?tvmode=true${NC}"
echo ""

# Ask if user wants to use tablet-optimized manifest
echo -e "${YELLOW}Do you want to use the tablet-optimized manifest.json? (y/n)${NC}"
read -r USE_TABLET_MANIFEST

if [[ "$USE_TABLET_MANIFEST" =~ ^[Yy]$ ]]; then
    cp "$SCRIPT_DIR/manifest.json" "$PROJECT_ROOT/manifest.json"
    echo -e "${GREEN}✓ Tablet manifest installed${NC}"
fi

# Create icons directory if it doesn't exist
if [ ! -d "$PROJECT_ROOT/icons" ]; then
    mkdir -p "$PROJECT_ROOT/icons"
    echo -e "${YELLOW}Note: icons/ directory created. Add app icons for better PWA experience.${NC}"
    echo "  Required sizes: 72, 96, 128, 144, 152, 192, 384, 512 pixels"
fi

# Check if server is running
echo ""
echo -e "${CYAN}Checking server status...${NC}"
if curl -s "http://localhost:3002/api/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Server is running${NC}"
else
    echo -e "${YELLOW}Server is not running. Start it with:${NC}"
    echo "  cd $PROJECT_ROOT && node server.js"
fi

# Generate QR code for easy tablet setup (if qrencode is available)
if command -v qrencode &> /dev/null; then
    echo ""
    echo -e "${GREEN}Scan this QR code on your tablet:${NC}"
    qrencode -t ANSIUTF8 "http://$SERVER_IP:3002/dashboard.html"
elif command -v npx &> /dev/null; then
    echo ""
    echo -e "${YELLOW}Tip: Install qrcode-terminal for QR code generation:${NC}"
    echo "  npm install -g qrcode-terminal"
    echo "  qrcode-terminal 'http://$SERVER_IP:3002/dashboard.html'"
fi

# Print tablet setup instructions
echo ""
echo -e "${GREEN}Tablet Installation Steps${NC}"
echo "========================="
echo ""
echo -e "${CYAN}iPad (Safari):${NC}"
echo "  1. Open Safari and go to: http://$SERVER_IP:3002"
echo "  2. Tap the Share button (square with arrow)"
echo "  3. Tap 'Add to Home Screen'"
echo "  4. Tap 'Add'"
echo ""
echo -e "${CYAN}Android (Chrome):${NC}"
echo "  1. Open Chrome and go to: http://$SERVER_IP:3002"
echo "  2. Tap the menu (three dots)"
echo "  3. Tap 'Add to Home screen' or 'Install app'"
echo "  4. Confirm installation"
echo ""
echo -e "${CYAN}For wall-mounted displays:${NC}"
echo "  - Use TV Mode URL for auto-cycling: http://$SERVER_IP:3002/dashboard.html?tvmode=true"
echo "  - Enable Guided Access (iPad) or Kiosk Mode (Android)"
echo "  - Disable screen timeout"
echo ""
echo -e "${GREEN}Setup complete!${NC}"
