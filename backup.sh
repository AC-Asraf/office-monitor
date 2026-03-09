#!/bin/bash
# Office Monitor Database Backup Script
# Creates timestamped backups of the SQLite database

set -e

# Configuration
BACKUP_DIR="./backups"
DATA_DIR="./data"
DB_NAME="monitor.db"
MAX_BACKUPS=7  # Keep last 7 backups

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Generate timestamp
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="$BACKUP_DIR/monitor-$TIMESTAMP.db"

# Check if database exists
if [ ! -f "$DATA_DIR/$DB_NAME" ]; then
    echo -e "${RED}Error: Database not found at $DATA_DIR/$DB_NAME${NC}"
    echo "Make sure the application has been run at least once."
    exit 1
fi

# Get database size
DB_SIZE=$(du -h "$DATA_DIR/$DB_NAME" | cut -f1)

echo -e "${YELLOW}Starting backup...${NC}"
echo "  Source: $DATA_DIR/$DB_NAME ($DB_SIZE)"
echo "  Target: $BACKUP_FILE"

# Create backup using SQLite's backup command for consistency
# This ensures a clean backup even if the database is in use
if command -v sqlite3 &> /dev/null; then
    sqlite3 "$DATA_DIR/$DB_NAME" ".backup '$BACKUP_FILE'"
else
    # Fallback to simple copy if sqlite3 is not available
    cp "$DATA_DIR/$DB_NAME" "$BACKUP_FILE"
fi

# Verify backup was created
if [ -f "$BACKUP_FILE" ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✓ Backup created successfully ($BACKUP_SIZE)${NC}"
else
    echo -e "${RED}Error: Backup failed${NC}"
    exit 1
fi

# Cleanup old backups (keep only MAX_BACKUPS most recent)
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/monitor-*.db 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
    echo -e "${YELLOW}Cleaning up old backups (keeping last $MAX_BACKUPS)...${NC}"
    ls -1t "$BACKUP_DIR"/monitor-*.db | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -f
    echo -e "${GREEN}✓ Old backups removed${NC}"
fi

# List current backups
echo ""
echo "Current backups:"
ls -lh "$BACKUP_DIR"/monitor-*.db 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'

echo ""
echo -e "${GREEN}Backup complete!${NC}"
