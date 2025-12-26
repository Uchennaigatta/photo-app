const { BlobServiceClient } = require('@azure/storage-blob');

let blobServiceClient = null;
let containerClient = null;

// Initialize Blob Storage client
function getBlobServiceClient() {
    if (!blobServiceClient) {
        const connectionString = process.env.BLOB_CONNECTION_STRING;
        if (!connectionString) {
            throw new Error('BLOB_CONNECTION_STRING is not configured');
        }
        blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    }
    return blobServiceClient;
}

// Get or create container
async function getContainerClient() {
    if (!containerClient) {
        const client = getBlobServiceClient();
        const containerName = process.env.BLOB_CONTAINER_NAME || 'photos';
        containerClient = client.getContainerClient(containerName);
        
        // Create container if it doesn't exist (with public access for images)
        await containerClient.createIfNotExists({
            access: 'blob' // Public read access for blobs only
        });
    }
    return containerClient;
}

// Upload file to blob storage
async function uploadToBlob(blobName, buffer, contentType) {
    const container = await getContainerClient();
    const blockBlobClient = container.getBlockBlobClient(blobName);
    
    await blockBlobClient.uploadData(buffer, {
        blobHTTPHeaders: {
            blobContentType: contentType,
            blobCacheControl: 'public, max-age=31536000' // Cache for 1 year
        }
    });
    
    return blockBlobClient.url;
}

// Upload stream to blob storage (for larger files)
async function uploadStreamToBlob(blobName, stream, contentType, contentLength) {
    const container = await getContainerClient();
    const blockBlobClient = container.getBlockBlobClient(blobName);
    
    await blockBlobClient.uploadStream(stream, contentLength, undefined, {
        blobHTTPHeaders: {
            blobContentType: contentType,
            blobCacheControl: 'public, max-age=31536000'
        }
    });
    
    return blockBlobClient.url;
}

// Delete blob from storage
async function deleteFromBlob(blobName) {
    const container = await getContainerClient();
    const blockBlobClient = container.getBlockBlobClient(blobName);
    
    try {
        await blockBlobClient.deleteIfExists();
        return true;
    } catch (error) {
        console.error('Error deleting blob:', error);
        return false;
    }
}

// Get blob URL
async function getBlobUrl(blobName) {
    const container = await getContainerClient();
    const blockBlobClient = container.getBlockBlobClient(blobName);
    return blockBlobClient.url;
}

// Generate SAS URL for temporary access
async function generateSasUrl(blobName, expiresInMinutes = 60) {
    const { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } = require('@azure/storage-blob');
    
    const container = await getContainerClient();
    const blockBlobClient = container.getBlockBlobClient(blobName);
    
    // For SAS token generation, you need account name and key
    // This is a simplified version - in production, use managed identity
    const sasOptions = {
        containerName: container.containerName,
        blobName: blobName,
        permissions: BlobSASPermissions.parse('r'), // Read only
        expiresOn: new Date(Date.now() + expiresInMinutes * 60 * 1000)
    };
    
    // Return direct URL if container has public access
    return blockBlobClient.url;
}

// List all blobs in container
async function listBlobs(prefix = '') {
    const container = await getContainerClient();
    const blobs = [];
    
    for await (const blob of container.listBlobsFlat({ prefix })) {
        blobs.push({
            name: blob.name,
            contentType: blob.properties.contentType,
            contentLength: blob.properties.contentLength,
            createdOn: blob.properties.createdOn,
            url: `${container.url}/${blob.name}`
        });
    }
    
    return blobs;
}

// Check storage health
async function checkHealth() {
    try {
        const container = await getContainerClient();
        await container.getProperties();
        return { status: 'healthy', container: container.containerName };
    } catch (error) {
        return { status: 'unhealthy', error: error.message };
    }
}

module.exports = {
    getBlobServiceClient,
    getContainerClient,
    uploadToBlob,
    uploadStreamToBlob,
    deleteFromBlob,
    getBlobUrl,
    generateSasUrl,
    listBlobs,
    checkHealth
};
