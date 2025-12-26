const { app } = require('@azure/functions');
const { getContainer } = require('../services/database');
const { verifyToken } = require('../services/auth');
const { v4: uuidv4 } = require('uuid');

// Rate a photo
app.http('ratePhoto', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'photos/{photoId}/rate',
    handler: async (request, context) => {
        const photoId = request.params.photoId;
        context.log(`Rate photo: ${photoId}`);

        try {
            const user = await verifyToken(request);
            if (!user) {
                return { status: 401, jsonBody: { success: false, message: 'Unauthorized' } };
            }

            const { rating } = await request.json();
            if (!rating || rating < 1 || rating > 5) {
                return { status: 400, jsonBody: { success: false, message: 'Rating must be between 1 and 5' } };
            }

            // Check if user already rated
            const ratingsContainer = await getContainer('ratings');
            const { resources: existingRatings } = await ratingsContainer.items
                .query({
                    query: 'SELECT * FROM c WHERE c.photoId = @photoId AND c.userId = @userId',
                    parameters: [
                        { name: '@photoId', value: photoId },
                        { name: '@userId', value: user.id }
                    ]
                })
                .fetchAll();

            const photosContainer = await getContainer('photos');
            const { resource: photo } = await photosContainer.item(photoId, photoId).read();

            if (!photo) {
                return { status: 404, jsonBody: { success: false, message: 'Photo not found' } };
            }

            if (existingRatings.length > 0) {
                // Update existing rating
                const existingRating = existingRatings[0];
                const oldRating = existingRating.rating;
                
                existingRating.rating = rating;
                existingRating.updatedAt = new Date().toISOString();
                await ratingsContainer.item(existingRating.id, existingRating.id).replace(existingRating);

                // Update photo average rating
                photo.ratingSum = (photo.ratingSum || 0) - oldRating + rating;
                photo.rating = photo.ratingSum / photo.ratingCount;
            } else {
                // Create new rating
                const ratingDoc = {
                    id: uuidv4(),
                    photoId,
                    userId: user.id,
                    rating,
                    createdAt: new Date().toISOString()
                };
                await ratingsContainer.items.create(ratingDoc);

                // Update photo average rating
                photo.ratingSum = (photo.ratingSum || 0) + rating;
                photo.ratingCount = (photo.ratingCount || 0) + 1;
                photo.rating = photo.ratingSum / photo.ratingCount;
            }

            photo.updatedAt = new Date().toISOString();
            await photosContainer.item(photoId, photoId).replace(photo);

            return {
                jsonBody: {
                    success: true,
                    data: {
                        rating: photo.rating,
                        ratingCount: photo.ratingCount,
                        userRating: rating
                    }
                }
            };
        } catch (error) {
            context.log('Rate error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to rate photo' }
            };
        }
    }
});

// Like a photo
app.http('likePhoto', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'photos/{photoId}/like',
    handler: async (request, context) => {
        const photoId = request.params.photoId;
        context.log(`Like photo: ${photoId}`);

        try {
            const user = await verifyToken(request);
            if (!user) {
                return { status: 401, jsonBody: { success: false, message: 'Unauthorized' } };
            }

            const likesContainer = await getContainer('likes');
            const { resources: existingLikes } = await likesContainer.items
                .query({
                    query: 'SELECT * FROM c WHERE c.photoId = @photoId AND c.userId = @userId',
                    parameters: [
                        { name: '@photoId', value: photoId },
                        { name: '@userId', value: user.id }
                    ]
                })
                .fetchAll();

            if (existingLikes.length > 0) {
                return { status: 400, jsonBody: { success: false, message: 'Already liked' } };
            }

            const photosContainer = await getContainer('photos');
            const { resource: photo } = await photosContainer.item(photoId, photoId).read();

            if (!photo) {
                return { status: 404, jsonBody: { success: false, message: 'Photo not found' } };
            }

            // Create like
            const like = {
                id: uuidv4(),
                photoId,
                userId: user.id,
                createdAt: new Date().toISOString()
            };
            await likesContainer.items.create(like);

            // Update photo likes count
            photo.likes = (photo.likes || 0) + 1;
            photo.updatedAt = new Date().toISOString();
            await photosContainer.item(photoId, photoId).replace(photo);

            // Update creator's likes received count
            const usersContainer = await getContainer('users');
            const { resource: creator } = await usersContainer.item(photo.creatorId, photo.creatorId).read();
            if (creator) {
                creator.likesReceived = (creator.likesReceived || 0) + 1;
                await usersContainer.item(photo.creatorId, photo.creatorId).replace(creator);
            }

            return {
                jsonBody: { success: true, likes: photo.likes }
            };
        } catch (error) {
            context.log('Like error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to like photo' }
            };
        }
    }
});

// Unlike a photo
app.http('unlikePhoto', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'photos/{photoId}/like',
    handler: async (request, context) => {
        const photoId = request.params.photoId;
        context.log(`Unlike photo: ${photoId}`);

        try {
            const user = await verifyToken(request);
            if (!user) {
                return { status: 401, jsonBody: { success: false, message: 'Unauthorized' } };
            }

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

            if (likes.length === 0) {
                return { status: 400, jsonBody: { success: false, message: 'Not liked yet' } };
            }

            // Delete like
            await likesContainer.item(likes[0].id, likes[0].id).delete();

            // Update photo likes count
            const photosContainer = await getContainer('photos');
            const { resource: photo } = await photosContainer.item(photoId, photoId).read();

            if (photo) {
                photo.likes = Math.max(0, (photo.likes || 0) - 1);
                photo.updatedAt = new Date().toISOString();
                await photosContainer.item(photoId, photoId).replace(photo);

                // Update creator's likes received count
                const usersContainer = await getContainer('users');
                const { resource: creator } = await usersContainer.item(photo.creatorId, photo.creatorId).read();
                if (creator) {
                    creator.likesReceived = Math.max(0, (creator.likesReceived || 0) - 1);
                    await usersContainer.item(photo.creatorId, photo.creatorId).replace(creator);
                }
            }

            return {
                jsonBody: { success: true, likes: photo ? photo.likes : 0 }
            };
        } catch (error) {
            context.log('Unlike error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to unlike photo' }
            };
        }
    }
});

// Get platform stats
app.http('getStats', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'stats',
    handler: async (request, context) => {
        context.log('Get stats request');

        try {
            const photosContainer = await getContainer('photos');
            const usersContainer = await getContainer('users');

            // Get photo count
            const { resources: [photoCount] } = await photosContainer.items
                .query({ query: 'SELECT VALUE COUNT(1) FROM c WHERE c.status = "approved"' })
                .fetchAll();

            // Get creator count
            const { resources: [creatorCount] } = await usersContainer.items
                .query({ query: 'SELECT VALUE COUNT(1) FROM c WHERE c.role = "creator"' })
                .fetchAll();

            // Get total views
            const { resources: [totalViews] } = await photosContainer.items
                .query({ query: 'SELECT VALUE SUM(c.views) FROM c' })
                .fetchAll();

            return {
                jsonBody: {
                    success: true,
                    data: {
                        photos: photoCount || 0,
                        creators: creatorCount || 0,
                        views: totalViews || 0
                    }
                }
            };
        } catch (error) {
            context.log('Stats error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to get stats' }
            };
        }
    }
});

// Search photos
app.http('searchPhotos', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'search',
    handler: async (request, context) => {
        const query = request.query.get('q');
        context.log(`Search photos: ${query}`);

        if (!query) {
            return { status: 400, jsonBody: { success: false, message: 'Search query is required' } };
        }

        try {
            const container = await getContainer('photos');
            const searchLower = query.toLowerCase();

            const { resources: photos } = await container.items
                .query({
                    query: `SELECT * FROM c WHERE c.status = 'approved' AND (
                        CONTAINS(LOWER(c.title), @search) OR 
                        CONTAINS(LOWER(c.caption), @search) OR 
                        CONTAINS(LOWER(c.location), @search) OR
                        ARRAY_CONTAINS(c.tags, @search)
                    ) ORDER BY c.createdAt DESC`,
                    parameters: [{ name: '@search', value: searchLower }]
                })
                .fetchAll();

            return {
                jsonBody: { success: true, data: photos }
            };
        } catch (error) {
            context.log('Search error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Search failed' }
            };
        }
    }
});
