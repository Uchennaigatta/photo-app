# Deploy Azure resources using PowerShell
# Run this script from the photo-app directory

param(
    [string]$ResourceGroup = "photoshare-rg",
    [string]$Location = "uksouth",
    [string]$AppName = "photoshare"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PhotoShare Azure Deployment Script   " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check if logged in
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "Please login to Azure..." -ForegroundColor Yellow
    az login
}

Write-Host "`nUsing subscription: $($account.name)" -ForegroundColor Green

# Create Resource Group
Write-Host "`n[1/8] Creating Resource Group..." -ForegroundColor Yellow
az group create --name $ResourceGroup --location $Location --output none
Write-Host "✓ Resource Group created" -ForegroundColor Green

# Create Storage Account for photos
Write-Host "`n[2/8] Creating Storage Account for photos..." -ForegroundColor Yellow
$storageAccountName = "$($AppName)storage$(Get-Random -Maximum 9999)"
az storage account create `
    --name $storageAccountName `
    --resource-group $ResourceGroup `
    --location $Location `
    --sku Standard_LRS `
    --kind StorageV2 `
    --access-tier Hot `
    --output none

# Create blob container
az storage container create `
    --name photos `
    --account-name $storageAccountName `
    --public-access blob `
    --output none
Write-Host "✓ Storage Account created: $storageAccountName" -ForegroundColor Green

# Create Cosmos DB
Write-Host "`n[3/8] Creating Cosmos DB Account (this may take a few minutes)..." -ForegroundColor Yellow
$cosmosAccountName = "$($AppName)-cosmos-$(Get-Random -Maximum 9999)"
az cosmosdb create `
    --name $cosmosAccountName `
    --resource-group $ResourceGroup `
    --locations regionName=$Location `
    --default-consistency-level Session `
    --enable-free-tier true `
    --output none

# Create database and containers
az cosmosdb sql database create `
    --account-name $cosmosAccountName `
    --resource-group $ResourceGroup `
    --name photoshare `
    --output none

$containers = @("photos", "users", "comments", "ratings", "likes")
foreach ($container in $containers) {
    az cosmosdb sql container create `
        --account-name $cosmosAccountName `
        --resource-group $ResourceGroup `
        --database-name photoshare `
        --name $container `
        --partition-key-path /id `
        --output none
}
Write-Host "✓ Cosmos DB created: $cosmosAccountName" -ForegroundColor Green

# Create Cognitive Services
Write-Host "`n[4/8] Creating Computer Vision Service..." -ForegroundColor Yellow
$visionName = "$($AppName)-vision"
az cognitiveservices account create `
    --name $visionName `
    --resource-group $ResourceGroup `
    --kind ComputerVision `
    --sku F0 `
    --location $Location `
    --yes `
    --output none
Write-Host "✓ Computer Vision created: $visionName" -ForegroundColor Green

# Create Function App storage
Write-Host "`n[5/8] Creating Function App Storage..." -ForegroundColor Yellow
$funcStorageName = "$($AppName)func$(Get-Random -Maximum 9999)"
az storage account create `
    --name $funcStorageName `
    --resource-group $ResourceGroup `
    --location $Location `
    --sku Standard_LRS `
    --output none
Write-Host "✓ Function Storage created: $funcStorageName" -ForegroundColor Green

# Create Function App
Write-Host "`n[6/8] Creating Function App..." -ForegroundColor Yellow
$functionAppName = "$($AppName)-api-$(Get-Random -Maximum 9999)"
az functionapp create `
    --name $functionAppName `
    --resource-group $ResourceGroup `
    --storage-account $funcStorageName `
    --consumption-plan-location $Location `
    --runtime node `
    --runtime-version 18 `
    --functions-version 4 `
    --output none
Write-Host "✓ Function App created: $functionAppName" -ForegroundColor Green

# Get connection strings
Write-Host "`n[7/8] Retrieving connection strings..." -ForegroundColor Yellow

$cosmosKeys = az cosmosdb keys list `
    --name $cosmosAccountName `
    --resource-group $ResourceGroup `
    --type connection-strings | ConvertFrom-Json
$cosmosConnectionString = $cosmosKeys.connectionStrings[0].connectionString

$storageConnectionString = az storage account show-connection-string `
    --name $storageAccountName `
    --resource-group $ResourceGroup `
    --query connectionString -o tsv

$visionKeys = az cognitiveservices account keys list `
    --name $visionName `
    --resource-group $ResourceGroup | ConvertFrom-Json
$visionKey = $visionKeys.key1

$visionEndpoint = az cognitiveservices account show `
    --name $visionName `
    --resource-group $ResourceGroup `
    --query properties.endpoint -o tsv

# Generate JWT secret
$jwtSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})

Write-Host "✓ Connection strings retrieved" -ForegroundColor Green

# Configure Function App settings
Write-Host "`n[8/8] Configuring Function App settings..." -ForegroundColor Yellow
az functionapp config appsettings set `
    --name $functionAppName `
    --resource-group $ResourceGroup `
    --settings `
        COSMOS_CONNECTION_STRING="$cosmosConnectionString" `
        COSMOS_DATABASE_NAME="photoshare" `
        BLOB_CONNECTION_STRING="$storageConnectionString" `
        BLOB_CONTAINER_NAME="photos" `
        COMPUTER_VISION_KEY="$visionKey" `
        COMPUTER_VISION_ENDPOINT="$visionEndpoint" `
        JWT_SECRET="$jwtSecret" `
    --output none

# Enable CORS
az functionapp cors add `
    --name $functionAppName `
    --resource-group $ResourceGroup `
    --allowed-origins "*" `
    --output none

Write-Host "✓ Function App configured" -ForegroundColor Green

# Output summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Deployment Complete!                 " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`nResources Created:" -ForegroundColor Green
Write-Host "  Resource Group:    $ResourceGroup"
Write-Host "  Storage Account:   $storageAccountName"
Write-Host "  Cosmos DB:         $cosmosAccountName"
Write-Host "  Computer Vision:   $visionName"
Write-Host "  Function App:      $functionAppName"

$functionAppUrl = "https://$functionAppName.azurewebsites.net/api"
Write-Host "`nAPI Endpoint: $functionAppUrl" -ForegroundColor Yellow

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Next Steps                           " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "1. Update frontend/js/config.js with:"
Write-Host "   API_BASE_URL: '$functionAppUrl'"
Write-Host ""
Write-Host "2. Deploy the Function App code:"
Write-Host "   func azure functionapp publish $functionAppName"
Write-Host ""
Write-Host "3. Deploy the frontend to Azure Static Web Apps"
Write-Host "   or any static hosting service"

# Save config to file
$config = @{
    resourceGroup = $ResourceGroup
    storageAccount = $storageAccountName
    cosmosAccount = $cosmosAccountName
    visionName = $visionName
    functionApp = $functionAppName
    apiUrl = $functionAppUrl
    blobUrl = "https://$storageAccountName.blob.core.windows.net/photos"
}
$config | ConvertTo-Json | Out-File -FilePath "azure-config.json"
Write-Host "`nConfiguration saved to azure-config.json" -ForegroundColor Green
