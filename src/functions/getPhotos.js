const { app } = require('@azure/functions');
const { getContainer } = require('../services/database');
const { verifyToken } = require('../services/auth');

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

            // Get total count for pagination
            const countQuery = {
                query: 'SELECT VALUE COUNT(1) FROM c WHERE c.status = @status',
                parameters: [{ name: '@status', value: 'approved' }]
            };
            const { resources: [total] } = await container.items.query(countQuery).fetchAll();

            return {
                jsonBody: {
                    success: true,
                    data: photos,
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

            // Check if user has liked/rated this photo
            const user = await verifyToken(request);
            if (user) {
                // Check if user liked this photo
                const likesContainer = await getContainer('likes');
                const { resources: likes } = await likesContainer.items
                    .query({
                        query: 'SELECT * FROM c WHERE c.photoId = @photoId AND c.userId = @userId',
                        parameters: [
                            { name: '@photoId', value: photoId },
                            { name: '@userId', value: user.id }
                        ]
                    })
                    .fetchAll();
                photo.userLiked = likes.length > 0;

                // Check if user rated this photo
                const ratingsContainer = await getContainer('ratings');
                const { resources: ratings } = await ratingsContainer.items
                    .query({
                        query: 'SELECT * FROM c WHERE c.photoId = @photoId AND c.userId = @userId',
                        parameters: [
                            { name: '@photoId', value: photoId },
                            { name: '@userId', value: user.id }
                        ]
                    })
                    .fetchAll();
                photo.userRating = ratings.length > 0 ? ratings[0].rating : 0;
            }

            return {
                jsonBody: { success: true, data: photo }
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
