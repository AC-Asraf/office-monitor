#!/bin/bash
# Office Monitor - Tablet Version
# Run this script to start the server for tablet access

set -e

echo "Office Monitor - Tablet Server"
echo "=============================="

# Get server IP
if [[ "$OSTYPE" == "darwin"* ]]; then
    IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    IP=$(hostname -I | awk '{print $1}')
else
    IP="localhost"
fi

PORT=${PORT:-3002}

echo ""
echo "Starting server..."
echo ""
echo "Access the dashboard from your tablet:"
echo "  http://$IP:$PORT/dashboard.html"
echo ""
echo "For TV Mode (auto-cycling):"
echo "  http://$IP:$PORT/dashboard.html?tvmode=true"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Start server
node server.js
