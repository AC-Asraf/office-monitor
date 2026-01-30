# Office Monitor - GCP Deployment

Deploy the Office Infrastructure Monitor to Google Cloud Platform.

## Prerequisites

1. **Google Cloud Account** - [Create one here](https://cloud.google.com)
2. **gcloud CLI** - [Install instructions](https://cloud.google.com/sdk/docs/install)
3. **GCP Project** - Create a project in the GCP Console

## Quick Deploy

```bash
# Make the script executable
chmod +x deploy/gcp/deploy.sh

# Run the deployment
./deploy/gcp/deploy.sh
```

The script will guide you through the deployment process.

## Deployment Options

### Option 1: App Engine (Recommended for Simplicity)

App Engine is a fully managed platform that automatically handles scaling.

**Pros:**
- Zero infrastructure management
- Automatic scaling
- Built-in health checks
- Simple deployment

**Cons:**
- Less control over environment
- Cold starts on scale-down

**Manual deployment:**
```bash
# From project root
cp deploy/gcp/app.yaml ./
gcloud app deploy
rm app.yaml
```

### Option 2: Cloud Run (Recommended for Containers)

Cloud Run runs containers with automatic scaling to zero.

**Pros:**
- Container-based (portable)
- Scale to zero (cost-effective)
- Full control over runtime
- Fast cold starts

**Cons:**
- Requires container registry
- Slightly more complex setup

**Manual deployment:**
```bash
# Build and push container
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/office-monitor -f deploy/gcp/Dockerfile .

# Deploy to Cloud Run
gcloud run deploy office-monitor \
  --image gcr.io/YOUR_PROJECT_ID/office-monitor \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

## Configuration

### Environment Variables

Set these in your deployment configuration:

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Environment mode |
| `PORT` | `8080` | Server port |

### Persistent Storage

The default SQLite database is stored in-memory and will be lost on restart. For production, consider:

1. **Cloud SQL (PostgreSQL/MySQL)**
   - Managed database service
   - Automatic backups
   - High availability

2. **Cloud Storage + SQLite**
   - Mount Cloud Storage as volume
   - Persist SQLite file

3. **Firestore**
   - NoSQL document database
   - Real-time sync
   - Automatic scaling

## Monitoring & Logging

- **Cloud Logging**: Logs are automatically collected
- **Cloud Monitoring**: Set up dashboards and alerts
- **Error Reporting**: Automatic error tracking

View logs:
```bash
# App Engine
gcloud app logs tail

# Cloud Run
gcloud run logs read office-monitor --region=us-central1
```

## Costs

**Estimated monthly costs (light usage):**
- App Engine F2 instance: ~$30-50/month
- Cloud Run (with scale to zero): ~$5-20/month

**Free tier includes:**
- App Engine: 28 instance-hours/day
- Cloud Run: 2 million requests/month

## Troubleshooting

### App won't start
```bash
# Check logs
gcloud app logs tail -s default
```

### Container build fails
```bash
# Build locally first
docker build -f deploy/gcp/Dockerfile -t office-monitor .
docker run -p 8080:8080 office-monitor
```

### Health check fails
- Ensure `/api/health` endpoint returns 200
- Check that the app starts within 300 seconds

## Security Recommendations

1. **Enable HTTPS only** (already configured in app.yaml)
2. **Set up Cloud Armor** for DDoS protection
3. **Use Cloud IAM** for access control
4. **Enable Cloud Audit Logs**

## Updates

To deploy updates:
```bash
# App Engine
gcloud app deploy

# Cloud Run
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/office-monitor -f deploy/gcp/Dockerfile .
gcloud run deploy office-monitor --image gcr.io/YOUR_PROJECT_ID/office-monitor
```
