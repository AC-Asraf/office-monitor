#!/bin/bash
# Office Monitor - GCP Deployment
# Run this script from inside the deploy/gcp/app directory

set -e

echo "Office Monitor - GCP Deployment"
echo "================================"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI is not installed"
    echo "Install from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Get current project
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "No GCP project set. Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "Project: $PROJECT_ID"
echo ""

echo "Select deployment type:"
echo "1) App Engine"
echo "2) Cloud Run"
read -r -p "Choice (1 or 2): " choice

if [ "$choice" == "1" ]; then
    echo "Deploying to App Engine..."
    gcloud app deploy app.yaml --quiet
    echo ""
    echo "Done! Run 'gcloud app browse' to open your app"

elif [ "$choice" == "2" ]; then
    read -r -p "Region (default: us-central1): " REGION
    REGION=${REGION:-us-central1}

    echo "Building container..."
    gcloud builds submit --tag "gcr.io/$PROJECT_ID/office-monitor" .

    echo "Deploying to Cloud Run..."
    gcloud run deploy office-monitor \
        --image "gcr.io/$PROJECT_ID/office-monitor" \
        --platform managed \
        --region "$REGION" \
        --allow-unauthenticated \
        --port 8080

    echo ""
    echo "Done!"
else
    echo "Invalid choice"
    exit 1
fi
