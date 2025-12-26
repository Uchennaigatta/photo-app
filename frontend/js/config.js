// API Configuration
const CONFIG = {
    // Azure Functions API endpoint (update after deployment)
    API_BASE_URL: 'http://localhost:7071/api',
    
    // Azure Blob Storage CDN endpoint (update after deployment)
    BLOB_STORAGE_URL: 'https://your-storage-account.blob.core.windows.net/photos',
    
    // JWT token storage key
    TOKEN_KEY: 'photoshare_token',
    USER_KEY: 'photoshare_user',
    
    // Pagination
    PHOTOS_PER_PAGE: 12,
    
    // File upload limits
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    
    // Feature flags
    FEATURES: {
        AI_TAGGING: true,
        CONTENT_MODERATION: true,
        CACHING: true
    }
};

// Environment detection
const isProduction = window.location.hostname !== 'localhost' && 
                     window.location.hostname !== '127.0.0.1';

if (isProduction) {
    // Update with your deployed Azure Functions URL
    // CONFIG.API_BASE_URL = 'https://your-function-app.azurewebsites.net/api';
}

// Export for use in other modules
window.CONFIG = CONFIG;
