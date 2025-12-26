# PhotoShare - Azure Deployment Guide

## Overview
PhotoShare is a scalable, cloud-native photo sharing application built on Microsoft Azure. This guide walks you through deploying all components.

## Architecture Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Azure Front Door / CDN                       │
│                    (Global Load Balancing & Caching)                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
        ┌───────────▼───────────┐     ┌────────────▼────────────┐
        │   Static Web App      │     │    Azure Functions      │
        │   (Frontend Hosting)  │     │    (REST API Backend)   │
        └───────────────────────┘     └────────────┬────────────┘
                                                   │
                    ┌──────────────────────────────┼──────────────────┐
                    │                              │                  │
        ┌───────────▼───────────┐    ┌─────────────▼─────┐  ┌────────▼────────┐
        │   Azure Blob Storage  │    │   Azure Cosmos DB │  │ Cognitive       │
        │   (Photo Storage)     │    │   (Database)      │  │ Services        │
        └───────────────────────┘    └───────────────────┘  │ (AI Analysis)   │
                                                            └─────────────────┘
```

## Prerequisites

1. Azure Account (Free tier is sufficient)
2. Azure CLI installed
3. Node.js 18+ installed
4. Azure Functions Core Tools v4

## Step 1: Create Azure Resources

### Login to Azure
```bash
az login
az account set --subscription "Your Subscription Name"
```

### Create Resource Group
```bash
az group create --name photoshare-rg --location uksouth
```

### Create Storage Account (for photos)
```bash
az storage account create \
  --name photosharestorage \
  --resource-group photoshare-rg \
  --location uksouth \
  --sku Standard_LRS \
  --kind StorageV2 \
  --access-tier Hot

# Create blob container
az storage container create \
  --name photos \
  --account-name photosharestorage \
  --public-access blob
```

### Create Cosmos DB Account
```bash
az cosmosdb create \
  --name photoshare-cosmos \
  --resource-group photoshare-rg \
  --locations regionName=uksouth \
  --default-consistency-level Session \
  --enable-free-tier true

# Create database
az cosmosdb sql database create \
  --account-name photoshare-cosmos \
  --resource-group photoshare-rg \
  --name photoshare

# Create containers
az cosmosdb sql container create \
  --account-name photoshare-cosmos \
  --resource-group photoshare-rg \
  --database-name photoshare \
  --name photos \
  --partition-key-path /id

az cosmosdb sql container create \
  --account-name photoshare-cosmos \
  --resource-group photoshare-rg \
  --database-name photoshare \
  --name users \
  --partition-key-path /id

az cosmosdb sql container create \
  --account-name photoshare-cosmos \
  --resource-group photoshare-rg \
  --database-name photoshare \
  --name comments \
  --partition-key-path /id

az cosmosdb sql container create \
  --account-name photoshare-cosmos \
  --resource-group photoshare-rg \
  --database-name photoshare \
  --name ratings \
  --partition-key-path /id

az cosmosdb sql container create \
  --account-name photoshare-cosmos \
  --resource-group photoshare-rg \
  --database-name photoshare \
  --name likes \
  --partition-key-path /id
```

### Create Cognitive Services (Computer Vision)
```bash
az cognitiveservices account create \
  --name photoshare-vision \
  --resource-group photoshare-rg \
  --kind ComputerVision \
  --sku F0 \
  --location uksouth \
  --yes
```

### Create Function App
```bash
# Create storage for function app
az storage account create \
  --name photosharefuncstorage \
  --resource-group photoshare-rg \
  --location uksouth \
  --sku Standard_LRS

# Create function app
az functionapp create \
  --name photoshare-api \
  --resource-group photoshare-rg \
  --storage-account photosharefuncstorage \
  --consumption-plan-location uksouth \
  --runtime node \
  --runtime-version 18 \
  --functions-version 4
```

### Create Static Web App (Frontend)
```bash
az staticwebapp create \
  --name photoshare-frontend \
  --resource-group photoshare-rg \
  --source https://github.com/YOUR_USERNAME/photo-app \
  --location "westeurope" \
  --branch main \
  --app-location "/frontend" \
  --output-location "/" \
  --login-with-github
```

## Step 2: Get Connection Strings

```bash
# Get Cosmos DB connection string
az cosmosdb keys list \
  --name photoshare-cosmos \
  --resource-group photoshare-rg \
  --type connection-strings

# Get Blob Storage connection string
az storage account show-connection-string \
  --name photosharestorage \
  --resource-group photoshare-rg

# Get Computer Vision key and endpoint
az cognitiveservices account keys list \
  --name photoshare-vision \
  --resource-group photoshare-rg

az cognitiveservices account show \
  --name photoshare-vision \
  --resource-group photoshare-rg \
  --query properties.endpoint
```

## Step 3: Configure Function App Settings

```bash
az functionapp config appsettings set \
  --name photoshare-api \
  --resource-group photoshare-rg \
  --settings \
    COSMOS_CONNECTION_STRING="YOUR_COSMOS_CONNECTION_STRING" \
    COSMOS_DATABASE_NAME="photoshare" \
    BLOB_CONNECTION_STRING="YOUR_BLOB_CONNECTION_STRING" \
    BLOB_CONTAINER_NAME="photos" \
    COMPUTER_VISION_KEY="YOUR_COMPUTER_VISION_KEY" \
    COMPUTER_VISION_ENDPOINT="YOUR_COMPUTER_VISION_ENDPOINT" \
    JWT_SECRET="your-super-secret-jwt-key-minimum-32-characters"
```

## Step 4: Deploy Functions

```bash
cd photo-app
npm install
func azure functionapp publish photoshare-api
```

## Step 5: Configure CORS

```bash
az functionapp cors add \
  --name photoshare-api \
  --resource-group photoshare-rg \
  --allowed-origins "https://photoshare-frontend.azurestaticapps.net" "*"
```

## Step 6: Update Frontend Configuration

Update `frontend/js/config.js` with your deployed API URL:

```javascript
const CONFIG = {
    API_BASE_URL: 'https://photoshare-api.azurewebsites.net/api',
    // ... other config
};
```

## Step 7: Deploy Frontend

If using Azure Static Web Apps with GitHub:
1. Push changes to your GitHub repository
2. The deployment will happen automatically

For manual deployment:
```bash
az staticwebapp upload \
  --name photoshare-frontend \
  --resource-group photoshare-rg \
  --app-location "./frontend" \
  --output-location "./"
```

## Optional: Setup Azure CDN

```bash
# Create CDN Profile
az cdn profile create \
  --name photoshare-cdn \
  --resource-group photoshare-rg \
  --sku Standard_Microsoft

# Create CDN Endpoint for blob storage
az cdn endpoint create \
  --name photoshare-images \
  --profile-name photoshare-cdn \
  --resource-group photoshare-rg \
  --origin photosharestorage.blob.core.windows.net \
  --origin-host-header photosharestorage.blob.core.windows.net
```

## Optional: Setup Application Insights

```bash
az monitor app-insights component create \
  --app photoshare-insights \
  --location uksouth \
  --resource-group photoshare-rg

# Get instrumentation key and configure function app
INSTRUMENTATION_KEY=$(az monitor app-insights component show \
  --app photoshare-insights \
  --resource-group photoshare-rg \
  --query instrumentationKey -o tsv)

az functionapp config appsettings set \
  --name photoshare-api \
  --resource-group photoshare-rg \
  --settings APPINSIGHTS_INSTRUMENTATIONKEY=$INSTRUMENTATION_KEY
```

## Scalability Features

### Auto-scaling (Built-in)
- Azure Functions automatically scale based on demand
- Cosmos DB throughput can be configured (start with 400 RU/s free tier)
- Blob Storage handles unlimited concurrent requests

### Caching Strategy
1. **CDN Caching**: Images cached at edge locations globally
2. **Browser Caching**: Cache headers set for 1 year on images
3. **API Response Caching**: Can add Azure API Management for API caching

### Database Partitioning
- Cosmos DB partitioned by document ID for optimal distribution
- Each container is independently scalable

## Cost Estimation (Free Tier)

| Service | Free Tier Limit |
|---------|-----------------|
| Azure Functions | 1M executions/month |
| Cosmos DB | 1000 RU/s, 25 GB storage |
| Blob Storage | 5 GB, 20K operations |
| Computer Vision | 5000 calls/month |
| Static Web Apps | 100 GB bandwidth |

## Monitoring & Troubleshooting

### View Function Logs
```bash
az webapp log tail --name photoshare-api --resource-group photoshare-rg
```

### Check Cosmos DB Metrics
```bash
az monitor metrics list \
  --resource /subscriptions/{sub}/resourceGroups/photoshare-rg/providers/Microsoft.DocumentDB/databaseAccounts/photoshare-cosmos \
  --metric TotalRequests
```

## Security Best Practices

1. **Never commit secrets to source control**
2. **Use Azure Key Vault for production secrets**
3. **Enable HTTPS only**
4. **Configure proper CORS origins**
5. **Implement rate limiting**
6. **Regular security audits**

## Support

For issues or questions, check:
- Azure Functions documentation
- Azure Cosmos DB documentation
- Azure Blob Storage documentation
