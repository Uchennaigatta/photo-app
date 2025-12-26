const { CosmosClient } = require('@azure/cosmos');

let client = null;
let database = null;
const containers = {};

// Initialize Cosmos DB client
function getClient() {
    if (!client) {
        const connectionString = process.env.COSMOS_CONNECTION_STRING;
        if (!connectionString) {
            throw new Error('COSMOS_CONNECTION_STRING is not configured');
        }
        client = new CosmosClient(connectionString);
    }
    return client;
}

// Get or create database
async function getDatabase() {
    if (!database) {
        const client = getClient();
        const databaseName = process.env.COSMOS_DATABASE_NAME || 'photoshare';
        const { database: db } = await client.databases.createIfNotExists({ id: databaseName });
        database = db;
    }
    return database;
}

// Get or create container
async function getContainer(containerName) {
    if (!containers[containerName]) {
        const db = await getDatabase();
        
        // Define container configurations
        const containerConfigs = {
            photos: {
                id: 'photos',
                partitionKey: { paths: ['/id'] },
                indexingPolicy: {
                    includedPaths: [{ path: '/*' }],
                    excludedPaths: [{ path: '/imageUrl/*' }, { path: '/aiAnalysis/*' }]
                }
            },
            users: {
                id: 'users',
                partitionKey: { paths: ['/id'] }
            },
            comments: {
                id: 'comments',
                partitionKey: { paths: ['/id'] }
            },
            ratings: {
                id: 'ratings',
                partitionKey: { paths: ['/id'] }
            },
            likes: {
                id: 'likes',
                partitionKey: { paths: ['/id'] }
            }
        };

        const config = containerConfigs[containerName] || { id: containerName, partitionKey: { paths: ['/id'] } };
        const { container } = await db.containers.createIfNotExists(config);
        containers[containerName] = container;
    }
    return containers[containerName];
}

// Utility function to check database health
async function checkHealth() {
    try {
        const db = await getDatabase();
        await db.read();
        return { status: 'healthy', database: db.id };
    } catch (error) {
        return { status: 'unhealthy', error: error.message };
    }
}

module.exports = {
    getClient,
    getDatabase,
    getContainer,
    checkHealth
};
