#!/bin/bash
# Office Monitor Database Restore Script
# Restores database from a backup file

set -e

# Configuration
BACKUP_DIR="./backups"
DATA_DIR="./data"
DB_NAME="monitor.db"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Show usage if no argument provided
if [ -z "$1" ]; then
    echo "Usage: $0 <backup-file>"
    echo ""
    echo "Available backups:"
    if [ -d "$BACKUP_DIR" ]; then
        ls -lht "$BACKUP_DIR"/monitor-*.db 2>/dev/null | awk '{print "  " $9 " (" $5 ", " $6 " " $7 " " $8 ")"}'
    else
        echo "  No backups found"
    fi
    echo ""
    echo "Example: $0 ./backups/monitor-2026-02-26_10-30-00.db"
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}Error: Backup file not found: $BACKUP_FILE${NC}"
    exit 1
fi

# Warning
echo -e "${YELLOW}⚠️  WARNING: This will replace the current database!${NC}"
echo ""
echo "  Current database: $DATA_DIR/$DB_NAME"
echo "  Restore from:     $BACKUP_FILE"
echo ""
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
fi

# Stop the container if running
echo -e "${YELLOW}Stopping office-monitor container...${NC}"
docker stop office-monitor 2>/dev/null || true

# Create a backup of current database before restoring
if [ -f "$DATA_DIR/$DB_NAME" ]; then
    TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
    PRE_RESTORE_BACKUP="$BACKUP_DIR/pre-restore-$TIMESTAMP.db"
    echo -e "${YELLOW}Creating pre-restore backup...${NC}"
    mkdir -p "$BACKUP_DIR"
    cp "$DATA_DIR/$DB_NAME" "$PRE_RESTORE_BACKUP"
    echo -e "${GREEN}✓ Pre-restore backup saved to $PRE_RESTORE_BACKUP${NC}"
fi

# Restore the database
echo -e "${YELLOW}Restoring database...${NC}"
mkdir -p "$DATA_DIR"
cp "$BACKUP_FILE" "$DATA_DIR/$DB_NAME"

# Verify restore
if [ -f "$DATA_DIR/$DB_NAME" ]; then
    echo -e "${GREEN}✓ Database restored successfully${NC}"
else
    echo -e "${RED}Error: Restore failed${NC}"
    exit 1
fi

# Start the container
echo -e "${YELLOW}Starting office-monitor container...${NC}"
docker start office-monitor 2>/dev/null || docker compose up -d

echo ""
echo -e "${GREEN}Restore complete!${NC}"
