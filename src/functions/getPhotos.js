const { app } = require('@azure/functions');
const { getContainer } = require('../services/database');
const { verifyToken } = require('../services/auth');
const { generateSasUrl } = require('../services/storage');

// Helper function to add SAS token to photo URLs
async function addSasToPhotos(photos) {
    return Promise.all(photos.map(async (photo) => {
        if (photo.blobName && photo.imageUrl && !photo.imageUrl.includes('?')) {
            // Generate SAS URL if not already present
            try {
                photo.imageUrl = await generateSasUrl(photo.blobName, 525600); // 1 year
            } catch (e) {
                console.error('Failed to generate SAS for', photo.blobName, e);
            }
        }
        return photo;
    }));
}

app.http('getPhotos', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'photos',
    handler: async (request, context) => {
        context.log('Get photos request');

        try {
            const container = await getContainer('photos');
            
            // Parse query parameters
            const page = parseInt(request.query.get('page')) || 1;
            const limit = parseInt(request.query.get('limit')) || 12;
            const filter = request.query.get('filter') || 'all';
            const sort = request.query.get('sort') || 'newest';
            const search = request.query.get('search') || '';
            const creatorId = request.query.get('creatorId');

            // Build query
            let querySpec = {
                query: 'SELECT * FROM c WHERE c.status = @status',
                parameters: [{ name: '@status', value: 'approved' }]
            };

            // Add filter
            if (filter !== 'all') {
                querySpec.query += ' AND c.category = @category';
                querySpec.parameters.push({ name: '@category', value: filter });
            }

            // Add creator filter
            if (creatorId) {
                querySpec.query += ' AND c.creatorId = @creatorId';
                querySpec.parameters.push({ name: '@creatorId', value: creatorId });
            }

            // Add search
            if (search) {
                querySpec.query += ' AND (CONTAINS(LOWER(c.title), @search) OR CONTAINS(LOWER(c.caption), @search) OR ARRAY_CONTAINS(c.tags, @search))';
                querySpec.parameters.push({ name: '@search', value: search.toLowerCase() });
            }

            // Add sorting
            switch (sort) {
                case 'oldest':
                    querySpec.query += ' ORDER BY c.createdAt ASC';
                    break;
                case 'popular':
                    querySpec.query += ' ORDER BY c.likes DESC';
                    break;
                case 'rating':
                    querySpec.query += ' ORDER BY c.rating DESC';
                    break;
                default:
                    querySpec.query += ' ORDER BY c.createdAt DESC';
            }

            // Add pagination
            const offset = (page - 1) * limit;
            querySpec.query += ` OFFSET ${offset} LIMIT ${limit}`;

            const { resources: photos } = await container.items.query(querySpec).fetchAll();

            // Add SAS tokens to photo URLs
            const photosWithSas = await addSasToPhotos(photos);

            // Get total count for pagination
            const countQuery = {
                query: 'SELECT VALUE COUNT(1) FROM c WHERE c.status = @status',
                parameters: [{ name: '@status', value: 'approved' }]
            };
            const { resources: [total] } = await container.items.query(countQuery).fetchAll();

            return {
                jsonBody: {
                    success: true,
                    data: photosWithSas,
                    pagination: {
                        page,
                        limit,
                        total,
                        totalPages: Math.ceil(total / limit),
                        hasMore: page * limit < total
                    }
                }
            };
        } catch (error) {
            context.log('Error fetching photos:', error);
            return {
                status: 500,
                jsonBody: {
                    success: false,
                    message: 'Failed to fetch photos',
                    error: error.message
                }
            };
        }
    }
});

// Get single photo by ID
app.http('getPhotoById', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'photos/{photoId}',
    handler: async (request, context) => {
        const photoId = request.params.photoId;
        context.log(`Get photo: ${photoId}`);

        try {
            const container = await getContainer('photos');
            const { resource: photo } = await container.item(photoId, photoId).read();

            if (!photo) {
                return {
                    status: 404,
                    jsonBody: { success: false, message: 'Photo not found' }
                };
            }

            // Increment view count
            photo.views = (photo.views || 0) + 1;
            await container.item(photoId, photoId).replace(photo);

            // Add SAS token to imageUrl if needed
            if (photo.blobName && photo.imageUrl && !photo.imageUrl.includes('?')) {
                try {
                    photo.imageUrl = await generateSasUrl(photo.blobName, 525600);
                } catch (e) {
                    context.log('Failed to generate SAS:', e);
                }
            }

            // Check if user is authenticated and get user-specific data
            let userLiked = false;
            let userRating = 0;
            
            const authHeader = request.headers.get('authorization');
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.split(' ')[1];
                try {
                    const decoded = verifyToken(token);
                    if (decoded && decoded.userId) {
                        const userId = decoded.userId;
                        
                        // Check if user liked this photo
                        try {
                            const likesContainer = await getContainer('likes');
                            const likeQuery = {
                                query: 'SELECT * FROM c WHERE c.photoId = @photoId AND c.userId = @userId',
                                parameters: [
                                    { name: '@photoId', value: photoId },
                                    { name: '@userId', value: userId }
                                ]
                            };
                            const { resources: likes } = await likesContainer.items.query(likeQuery).fetchAll();
                            userLiked = likes.length > 0;
                        } catch (e) {
                            context.log('Error checking likes:', e);
                        }
                        
                        // Check user's rating
                        try {
                            const ratingsContainer = await getContainer('ratings');
                            const ratingQuery = {
                                query: 'SELECT * FROM c WHERE c.photoId = @photoId AND c.userId = @userId',
                                parameters: [
                                    { name: '@photoId', value: photoId },
                                    { name: '@userId', value: userId }
                                ]
                            };
                            const { resources: ratings } = await ratingsContainer.items.query(ratingQuery).fetchAll();
                            if (ratings.length > 0) {
                                userRating = ratings[0].rating;
                            }
                        } catch (e) {
                            context.log('Error checking ratings:', e);
                        }
                    }
                } catch (e) {
                    context.log('Token verification failed:', e);
                }
            }

            return {
                jsonBody: { 
                    success: true, 
                    data: {
                        ...photo,
                        userLiked,
                        userRating
                    }
                }
            };
        } catch (error) {
            context.log('Error fetching photo:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to fetch photo' }
            };
        }
    }
});
