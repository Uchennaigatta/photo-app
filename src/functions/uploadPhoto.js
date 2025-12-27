const { app } = require('@azure/functions');
const { getContainer } = require('../services/database');
const { uploadToBlob, deleteFromBlob } = require('../services/storage');
const { analyzeImage } = require('../services/cognitiveServices');
const { verifyToken, requireCreator } = require('../services/auth');
const { v4: uuidv4 } = require('uuid');

// Upload photo (Creator only)
app.http('uploadPhoto', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'photos',
    handler: async (request, context) => {
        context.log('Upload photo request');

        try {
            // Verify authentication and creator role
            const user = await verifyToken(request);
            if (!user) {
                return { status: 401, jsonBody: { success: false, message: 'Unauthorized' } };
            }
            if (user.role !== 'creator') {
                return { status: 403, jsonBody: { success: false, message: 'Only creators can upload photos' } };
            }

            // Parse multipart form data
            const formData = await request.formData();
            const file = formData.get('photo');
            const title = formData.get('title');
            const caption = formData.get('caption') || '';
            const location = formData.get('location') || '';
            const people = formData.get('people') ? formData.get('people').split(',').map(p => p.trim()) : [];
            const tags = formData.get('tags') ? formData.get('tags').split(',').map(t => t.trim().toLowerCase()) : [];
            const autoTags = formData.get('autoTags') === 'true';
            const contentModeration = formData.get('contentModeration') === 'true';

            if (!file || !title) {
                return { status: 400, jsonBody: { success: false, message: 'Photo and title are required' } };
            }

            // Generate unique ID
            const photoId = uuidv4();
            const fileExtension = file.name.split('.').pop();
            const blobName = `${photoId}.${fileExtension}`;

            // Upload to Blob Storage
            const fileBuffer = Buffer.from(await file.arrayBuffer());
            const imageUrl = await uploadToBlob(blobName, fileBuffer, file.type);

            // AI Analysis (if enabled)
            let aiAnalysis = null;
            let status = 'approved';
            
            if (autoTags || contentModeration) {
                try {
                    const analysis = await analyzeImage(imageUrl);
                    
                    if (autoTags && analysis.tags) {
                        aiAnalysis = {
                            tags: analysis.tags,
                            description: analysis.description,
                            categories: analysis.categories
                        };
                        // Merge AI tags with user tags
                        analysis.tags.forEach(tag => {
                            if (!tags.includes(tag.toLowerCase())) {
                                tags.push(tag.toLowerCase());
                            }
                        });
                    }
                    
                    if (contentModeration && analysis.adult) {
                        if (analysis.adult.isAdultContent || analysis.adult.isGoryContent) {
                            status = 'rejected';
                            // Delete the uploaded image
                            await deleteFromBlob(blobName);
                            return {
                                status: 400,
                                jsonBody: { 
                                    success: false, 
                                    message: 'Image rejected due to inappropriate content' 
                                }
                            };
                        }
                        if (analysis.adult.isRacyContent) {
                            status = 'pending_review';
                        }
                    }
                } catch (aiError) {
                    context.log('AI analysis error:', aiError);
                    // Continue without AI analysis
                }
            }

            // Create photo document
            const photo = {
                id: photoId,
                title,
                caption,
                imageUrl,
                blobName,
                location,
                people,
                tags,
                category: tags[0] || 'general',
                aiAnalysis,
                status,
                creatorId: user.id,
                creator: {
                    id: user.id,
                    name: user.name,
                    avatar: user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=6366f1&color=fff`
                },
                likes: 0,
                rating: 0,
                ratingSum: 0,
                ratingCount: 0,
                comments: 0,
                views: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Save to Cosmos DB
            const container = await getContainer('photos');
            await container.items.create(photo);

            return {
                status: 201,
                jsonBody: {
                    success: true,
                    message: status === 'approved' ? 'Photo uploaded successfully' : 'Photo uploaded and pending review',
                    data: photo
                }
            };
        } catch (error) {
            context.log('Upload error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to upload photo', error: error.message }
            };
        }
    }
});

// Delete photo (Creator only, own photos)
app.http('deletePhoto', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'photos/{photoId}',
    handler: async (request, context) => {
        const photoId = request.params.photoId;
        context.log(`Delete photo: ${photoId}`);

        try {
            const user = await verifyToken(request);
            if (!user) {
                return { status: 401, jsonBody: { success: false, message: 'Unauthorized' } };
            }

            const container = await getContainer('photos');
            const { resource: photo } = await container.item(photoId, photoId).read();

            if (!photo) {
                return { status: 404, jsonBody: { success: false, message: 'Photo not found' } };
            }

            if (photo.creatorId !== user.id) {
                return { status: 403, jsonBody: { success: false, message: 'Not authorized to delete this photo' } };
            }

            // Delete from Blob Storage
            await deleteFromBlob(photo.blobName);

            // Delete from Cosmos DB
            await container.item(photoId, photoId).delete();

            // Delete associated comments
            const commentsContainer = await getContainer('comments');
            const { resources: comments } = await commentsContainer.items
                .query({ query: 'SELECT * FROM c WHERE c.photoId = @photoId', parameters: [{ name: '@photoId', value: photoId }] })
                .fetchAll();
            
            for (const comment of comments) {
                await commentsContainer.item(comment.id, comment.id).delete();
            }

            return {
                jsonBody: { success: true, message: 'Photo deleted successfully' }
            };
        } catch (error) {
            context.log('Delete error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to delete photo' }
            };
        }
    }
});

// Update photo (Creator only, own photos)
app.http('updatePhoto', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'photos/{photoId}',
    handler: async (request, context) => {
        const photoId = request.params.photoId;
        context.log(`Update photo: ${photoId}`);

        try {
            const user = await verifyToken(request);
            if (!user) {
                return { status: 401, jsonBody: { success: false, message: 'Unauthorized' } };
            }

            const container = await getContainer('photos');
            const { resource: photo } = await container.item(photoId, photoId).read();

            if (!photo) {
                return { status: 404, jsonBody: { success: false, message: 'Photo not found' } };
            }

            if (photo.creatorId !== user.id) {
                return { status: 403, jsonBody: { success: false, message: 'Not authorized to edit this photo' } };
            }

            const updates = await request.json();
            const allowedUpdates = ['title', 'caption', 'location', 'people', 'tags'];
            
            // Apply allowed updates
            allowedUpdates.forEach(field => {
                if (updates[field] !== undefined) {
                    photo[field] = updates[field];
                }
            });
            
            // Update category based on first tag
            if (updates.tags && updates.tags.length > 0) {
                photo.category = updates.tags[0];
            }
            
            photo.updatedAt = new Date().toISOString();

            await container.item(photoId, photoId).replace(photo);

            return {
                jsonBody: { 
                    success: true, 
                    message: 'Photo updated successfully',
                    data: photo
                }
            };
        } catch (error) {
            context.log('Update error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to update photo' }
            };
        }
    }
});
