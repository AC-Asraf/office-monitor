#!/bin/bash
# Office Monitor - GCP Deployment Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Office Monitor - GCP Deployment${NC}"
echo "=================================="

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI is not installed${NC}"
    echo "Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
    echo -e "${YELLOW}Please authenticate with Google Cloud:${NC}"
    gcloud auth login
fi

# Get current project or prompt for one
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo -e "${YELLOW}No project set. Please enter your GCP project ID:${NC}"
    read -r PROJECT_ID
    gcloud config set project "$PROJECT_ID"
fi

echo -e "${GREEN}Using project: $PROJECT_ID${NC}"

# Prompt for deployment type
echo ""
echo "Select deployment type:"
echo "1) App Engine (recommended for simplicity)"
echo "2) Cloud Run (recommended for containers)"
read -r -p "Enter choice (1 or 2): " DEPLOY_TYPE

# Get the project root directory (two levels up from this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

if [ "$DEPLOY_TYPE" == "1" ]; then
    echo -e "${GREEN}Deploying to App Engine...${NC}"

    # Copy app.yaml to project root
    cp "$SCRIPT_DIR/app.yaml" ./app.yaml

    # Deploy to App Engine
    gcloud app deploy app.yaml --quiet

    # Clean up
    rm ./app.yaml

    # Get the URL
    APP_URL=$(gcloud app browse --no-launch-browser 2>&1)
    echo -e "${GREEN}Deployment complete!${NC}"
    echo -e "Your app is running at: ${GREEN}$APP_URL${NC}"

elif [ "$DEPLOY_TYPE" == "2" ]; then
    echo -e "${GREEN}Deploying to Cloud Run...${NC}"

    # Prompt for region
    echo ""
    echo "Select a region (or press Enter for us-central1):"
    read -r REGION
    REGION=${REGION:-us-central1}

    # Build the container
    echo -e "${YELLOW}Building container image...${NC}"
    gcloud builds submit --tag "gcr.io/$PROJECT_ID/office-monitor" \
        --gcs-log-dir="gs://${PROJECT_ID}_cloudbuild/logs" \
        -f "$SCRIPT_DIR/Dockerfile" .

    # Deploy to Cloud Run
    echo -e "${YELLOW}Deploying to Cloud Run...${NC}"
    gcloud run deploy office-monitor \
        --image "gcr.io/$PROJECT_ID/office-monitor" \
        --platform managed \
        --region "$REGION" \
        --allow-unauthenticated \
        --port 8080 \
        --memory 512Mi \
        --cpu 1 \
        --min-instances 0 \
        --max-instances 3

    # Get the URL
    SERVICE_URL=$(gcloud run services describe office-monitor --platform managed --region "$REGION" --format 'value(status.url)')
    echo -e "${GREEN}Deployment complete!${NC}"
    echo -e "Your app is running at: ${GREEN}$SERVICE_URL${NC}"

else
    echo -e "${RED}Invalid choice. Please run the script again.${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "1. Visit the URL above to access your dashboard"
echo "2. Add your monitors and devices"
echo "3. Configure alerts and notifications"
echo ""
echo -e "${YELLOW}Note: For persistent data storage, consider using Cloud SQL or Cloud Storage${NC}"
