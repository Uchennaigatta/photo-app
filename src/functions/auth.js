const { app } = require('@azure/functions');
const { getContainer } = require('../services/database');
const { hashPassword, comparePassword, generateToken, verifyToken } = require('../services/auth');
const { v4: uuidv4 } = require('uuid');

// Register new user
app.http('register', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'auth/register',
    handler: async (request, context) => {
        context.log('Register request');

        try {
            const { name, email, password, role } = await request.json();

            // Validate input
            if (!name || !email || !password) {
                return {
                    status: 400,
                    jsonBody: { success: false, message: 'Name, email, and password are required' }
                };
            }

            // Validate role
            const validRoles = ['creator', 'consumer'];
            const userRole = validRoles.includes(role) ? role : 'consumer';

            // Check if email already exists
            const container = await getContainer('users');
            const { resources: existingUsers } = await container.items
                .query({
                    query: 'SELECT * FROM c WHERE c.email = @email',
                    parameters: [{ name: '@email', value: email.toLowerCase() }]
                })
                .fetchAll();

            if (existingUsers.length > 0) {
                return {
                    status: 400,
                    jsonBody: { success: false, message: 'Email already registered' }
                };
            }

            // Hash password
            const hashedPassword = await hashPassword(password);

            // Create user
            const userId = uuidv4();
            const user = {
                id: userId,
                name,
                email: email.toLowerCase(),
                password: hashedPassword,
                role: userRole,
                avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff`,
                bio: '',
                photosCount: 0,
                likesReceived: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await container.items.create(user);

            // Generate token
            const token = generateToken(user);

            // Remove password from response
            const { password: _, ...userWithoutPassword } = user;

            return {
                status: 201,
                jsonBody: {
                    success: true,
                    message: 'Registration successful',
                    token,
                    user: userWithoutPassword
                }
            };
        } catch (error) {
            context.log('Registration error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Registration failed', error: error.message }
            };
        }
    }
});

// Login user
app.http('login', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'auth/login',
    handler: async (request, context) => {
        context.log('Login request');

        try {
            const { email, password } = await request.json();

            if (!email || !password) {
                return {
                    status: 400,
                    jsonBody: { success: false, message: 'Email and password are required' }
                };
            }

            // Find user
            const container = await getContainer('users');
            const { resources: users } = await container.items
                .query({
                    query: 'SELECT * FROM c WHERE c.email = @email',
                    parameters: [{ name: '@email', value: email.toLowerCase() }]
                })
                .fetchAll();

            if (users.length === 0) {
                return {
                    status: 401,
                    jsonBody: { success: false, message: 'Invalid email or password' }
                };
            }

            const user = users[0];

            // Verify password
            const isValid = await comparePassword(password, user.password);
            if (!isValid) {
                return {
                    status: 401,
                    jsonBody: { success: false, message: 'Invalid email or password' }
                };
            }

            // Generate token
            const token = generateToken(user);

            // Remove password from response
            const { password: _, ...userWithoutPassword } = user;

            return {
                jsonBody: {
                    success: true,
                    message: 'Login successful',
                    token,
                    user: userWithoutPassword
                }
            };
        } catch (error) {
            context.log('Login error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Login failed', error: error.message }
            };
        }
    }
});

// Get user profile
app.http('getProfile', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'auth/profile',
    handler: async (request, context) => {
        context.log('Get profile request');

        try {
            const user = await verifyToken(request);
            if (!user) {
                return { status: 401, jsonBody: { success: false, message: 'Unauthorized' } };
            }

            // Get fresh user data
            const container = await getContainer('users');
            const { resource: userData } = await container.item(user.id, user.id).read();

            if (!userData) {
                return { status: 404, jsonBody: { success: false, message: 'User not found' } };
            }

            const { password: _, ...userWithoutPassword } = userData;

            return {
                jsonBody: { success: true, user: userWithoutPassword }
            };
        } catch (error) {
            context.log('Get profile error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to get profile' }
            };
        }
    }
});

// Update user profile
app.http('updateProfile', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'auth/profile',
    handler: async (request, context) => {
        context.log('Update profile request');

        try {
            const user = await verifyToken(request);
            if (!user) {
                return { status: 401, jsonBody: { success: false, message: 'Unauthorized' } };
            }

            const updates = await request.json();
            const allowedUpdates = ['name', 'bio', 'avatar'];
            
            const container = await getContainer('users');
            const { resource: userData } = await container.item(user.id, user.id).read();

            if (!userData) {
                return { status: 404, jsonBody: { success: false, message: 'User not found' } };
            }

            // Apply allowed updates
            allowedUpdates.forEach(field => {
                if (updates[field] !== undefined) {
                    userData[field] = updates[field];
                }
            });
            userData.updatedAt = new Date().toISOString();

            await container.item(user.id, user.id).replace(userData);

            const { password: _, ...userWithoutPassword } = userData;

            return {
                jsonBody: {
                    success: true,
                    message: 'Profile updated successfully',
                    user: userWithoutPassword
                }
            };
        } catch (error) {
            context.log('Update profile error:', error);
            return {
                status: 500,
                jsonBody: { success: false, message: 'Failed to update profile' }
            };
        }
    }
});
