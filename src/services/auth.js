const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';
const SALT_ROUNDS = 10;

// Hash password
async function hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
}

// Compare password with hash
async function comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
}

// Generate JWT token
function generateToken(user) {
    const payload = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar: user.avatar
    };
    
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Verify JWT token from request
async function verifyToken(request) {
    try {
        const authHeader = request.headers.get('authorization');
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return null;
        }
        
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET);
        
        return decoded;
    } catch (error) {
        console.error('Token verification failed:', error.message);
        return null;
    }
}

// Middleware-style function to require authentication
async function requireAuth(request) {
    const user = await verifyToken(request);
    if (!user) {
        throw new Error('Authentication required');
    }
    return user;
}

// Middleware-style function to require creator role
async function requireCreator(request) {
    const user = await requireAuth(request);
    if (user.role !== 'creator') {
        throw new Error('Creator role required');
    }
    return user;
}

// Middleware-style function to require consumer role
async function requireConsumer(request) {
    const user = await requireAuth(request);
    if (user.role !== 'consumer') {
        throw new Error('Consumer role required');
    }
    return user;
}

// Generate password reset token
function generateResetToken(userId) {
    return jwt.sign({ userId, type: 'password-reset' }, JWT_SECRET, { expiresIn: '1h' });
}

// Verify password reset token
function verifyResetToken(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== 'password-reset') {
            return null;
        }
        return decoded;
    } catch (error) {
        return null;
    }
}

module.exports = {
    hashPassword,
    comparePassword,
    generateToken,
    verifyToken,
    requireAuth,
    requireCreator,
    requireConsumer,
    generateResetToken,
    verifyResetToken
};
