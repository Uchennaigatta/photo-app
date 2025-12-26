const { app } = require('@azure/functions');
const { getContainer } = require('../services/database');
const { verifyToken } = require('../services/auth');
const { v4: uuidv4 } = require('uuid');

// Get comments for a photo
app.http('getComments', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'photos/{photoId}/comments',
    handler: async (request, context) => {
        const photoId = request.params.photoId;
        context.log(`Get comments for photo: ${photoId}`);

        try {
            const container = await getContainer('comments');
            const { resources: comments } = await container.items
                .query({
                    query: 'SELECT * FROM c WHERE c.photoId = @photoId ORDER BY c.createdAt DESC',
                    parameters: [{ name: '@photoId', value: photoId }]
                })
                .fetchAll();

            return {
                jsonBody: { success: true, data: comments }
            };
        } catch (error) {
            context.log('Get comments error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to get comments' }
            };
        }
    }
});

// Add comment to a photo
app.http('addComment', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'photos/{photoId}/comments',
    handler: async (request, context) => {
        const photoId = request.params.photoId;
        context.log(`Add comment to photo: ${photoId}`);

        try {
            const user = await verifyToken(request);
            if (!user) {
                return { status: 401, jsonBody: { success: false, message: 'Unauthorized' } };
            }

            const { text } = await request.json();
            if (!text || !text.trim()) {
                return { status: 400, jsonBody: { success: false, message: 'Comment text is required' } };
            }

            // Verify photo exists
            const photosContainer = await getContainer('photos');
            const { resource: photo } = await photosContainer.item(photoId, photoId).read();

            if (!photo) {
                return { status: 404, jsonBody: { success: false, message: 'Photo not found' } };
            }

            // Create comment
            const commentId = uuidv4();
            const comment = {
                id: commentId,
                photoId,
                text: text.trim(),
                user: {
                    id: user.id,
                    name: user.name,
                    avatar: user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=6366f1&color=fff`
                },
                createdAt: new Date().toISOString()
            };

            const commentsContainer = await getContainer('comments');
            await commentsContainer.items.create(comment);

            // Update photo comment count
            photo.comments = (photo.comments || 0) + 1;
            photo.updatedAt = new Date().toISOString();
            await photosContainer.item(photoId, photoId).replace(photo);

            return {
                status: 201,
                jsonBody: { success: true, data: comment }
            };
        } catch (error) {
            context.log('Add comment error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to add comment' }
            };
        }
    }
});

// Delete comment
app.http('deleteComment', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'photos/{photoId}/comments/{commentId}',
    handler: async (request, context) => {
        const { photoId, commentId } = request.params;
        context.log(`Delete comment: ${commentId}`);

        try {
            const user = await verifyToken(request);
            if (!user) {
                return { status: 401, jsonBody: { success: false, message: 'Unauthorized' } };
            }

            const commentsContainer = await getContainer('comments');
            const { resource: comment } = await commentsContainer.item(commentId, commentId).read();

            if (!comment) {
                return { status: 404, jsonBody: { success: false, message: 'Comment not found' } };
            }

            if (comment.user.id !== user.id) {
                return { status: 403, jsonBody: { success: false, message: 'Not authorized to delete this comment' } };
            }

            await commentsContainer.item(commentId, commentId).delete();

            // Update photo comment count
            const photosContainer = await getContainer('photos');
            const { resource: photo } = await photosContainer.item(photoId, photoId).read();
            if (photo) {
                photo.comments = Math.max(0, (photo.comments || 0) - 1);
                await photosContainer.item(photoId, photoId).replace(photo);
            }

            return {
                jsonBody: { success: true, message: 'Comment deleted' }
            };
        } catch (error) {
            context.log('Delete comment error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to delete comment' }
            };
        }
    }
});
