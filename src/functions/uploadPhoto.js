const { app } = require('@azure/functions');
const { getContainer } = require('../services/database');
const { uploadToBlob, deleteFromBlob } = require('../services/storage');
const { analyzeImage, moderateContent } = require('../services/cognitiveServices');
const { verifyToken, requireCreator } = require('../services/auth');
const { v4: uuidv4 } = require('uuid');

// Upload media (Creator only)
app.http('uploadPhoto', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'photos',
    handler: async (request, context) => {
        context.log('Upload media request');

        try {
            // Verify authentication and creator role
            const user = await verifyToken(request);
            if (!user) {
                return { status: 401, jsonBody: { success: false, message: 'Unauthorized' } };
            }
            if (user.role !== 'creator') {
                return { status: 403, jsonBody: { success: false, message: 'Only creators can upload media' } };
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
                return { status: 400, jsonBody: { success: false, message: 'Media file and title are required' } };
            }

            // Check if file is video or image
            const isVideo = file.type.startsWith('video/');

            // Generate unique ID
            const photoId = uuidv4();
            const fileExtension = file.name.split('.').pop();
            const blobName = `${photoId}.${fileExtension}`;

            // Upload to Blob Storage
            const fileBuffer = Buffer.from(await file.arrayBuffer());
            const imageUrl = await uploadToBlob(blobName, fileBuffer, file.type);

            // AI Analysis (if enabled and not a video)
            let aiAnalysis = null;
            let status = 'approved';
            
            if (!isVideo && (autoTags || contentModeration)) {
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
                mediaType: isVideo ? 'video' : 'image',
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
                    message: status === 'approved' ? 'Media uploaded successfully' : 'Media uploaded and pending review',
                    data: photo
                }
            };
        } catch (error) {
            context.log('Upload error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to upload media', error: error.message }
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

            // Try to parse as FormData first (for image updates), fall back to JSON
            let updates = {};
            let newImageUrl = null;

            try {
                const formData = await request.formData();
                const photoFile = formData.get('photo');

                if (photoFile) {
                    // Upload new image
                    const fileBuffer = Buffer.from(await photoFile.arrayBuffer());
                    const blobName = `${photoId}_${Date.now()}.jpg`;
                    const imageUrl = await uploadToBlob(blobName, fileBuffer, photoFile.type);
                    newImageUrl = imageUrl;

                    // Delete old image if it exists
                    if (photo.imageUrl) {
                        try {
                            const oldBlobName = photo.imageUrl.split('/').pop();
                            await deleteFromBlob(oldBlobName);
                        } catch (deleteError) {
                            context.log('Failed to delete old image:', deleteError);
                        }
                    }
                }

                // Get other form fields
                updates = {
                    title: formData.get('title'),
                    caption: formData.get('caption'),
                    location: formData.get('location'),
                    people: formData.get('people') ? formData.get('people').split(',').map(p => p.trim()).filter(p => p) : [],
                    tags: formData.get('tags') ? formData.get('tags').split(',').map(t => t.trim().toLowerCase()).filter(t => t) : [],
                    autoTags: formData.get('autoTags') === 'true',
                    contentModeration: formData.get('contentModeration') === 'true'
                };
            } catch (formError) {
                // Not FormData, try JSON
                context.log('Not FormData, trying JSON');
                updates = await request.json();
            }

            const allowedUpdates = ['title', 'caption', 'location', 'people', 'tags', 'autoTags', 'contentModeration'];
            
            // Apply allowed updates
            allowedUpdates.forEach(field => {
                if (updates[field] !== undefined) {
                    photo[field] = updates[field];
                }
            });

            // Update image URL if new image was uploaded
            if (newImageUrl) {
                photo.imageUrl = newImageUrl;
            }
            
            // Update category based on first tag
            if (updates.tags && updates.tags.length > 0) {
                photo.category = updates.tags[0];
            }
            
            // Process AI features if requested and we have an image
            const imageUrl = newImageUrl || photo.imageUrl;
            if (updates.autoTags && imageUrl) {
                try {
                    // Get AI analysis for the image
                    const aiAnalysis = await analyzeImage(imageUrl);
                    photo.aiAnalysis = {
                        tags: aiAnalysis.tags || [],
                        description: aiAnalysis.description || '',
                        categories: aiAnalysis.categories || []
                    };
                    
                    // Add AI tags to existing tags if not already present
                    if (aiAnalysis.tags && aiAnalysis.tags.length > 0) {
                        const existingTags = new Set(photo.tags || []);
                        aiAnalysis.tags.forEach(tag => {
                            if (!existingTags.has(tag)) {
                                existingTags.add(tag);
                            }
                        });
                        photo.tags = Array.from(existingTags);
                    }
                } catch (aiError) {
                    context.log('AI analysis failed:', aiError);
                    // Continue without AI analysis
                }
            }
            
            // Content moderation if requested
            if (updates.contentModeration && imageUrl) {
                try {
                    const moderationResult = await moderateContent(imageUrl);
                    // Set moderation status based on results
                    if (moderationResult.isAdultContent || moderationResult.isRacyContent) {
                        photo.moderationStatus = 'rejected';
                    } else {
                        photo.moderationStatus = 'approved';
                    }
                } catch (modError) {
                    context.log('Content moderation failed:', modError);
                    // Continue without moderation
                }
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
