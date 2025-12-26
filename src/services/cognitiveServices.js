const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
const { ApiKeyCredentials } = require('@azure/ms-rest-js');

let computerVisionClient = null;

// Initialize Computer Vision client
function getComputerVisionClient() {
    if (!computerVisionClient) {
        const key = process.env.COMPUTER_VISION_KEY;
        const endpoint = process.env.COMPUTER_VISION_ENDPOINT;
        
        if (!key || !endpoint) {
            console.warn('Computer Vision credentials not configured');
            return null;
        }
        
        const credentials = new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': key } });
        computerVisionClient = new ComputerVisionClient(credentials, endpoint);
    }
    return computerVisionClient;
}

// Analyze image using Computer Vision
async function analyzeImage(imageUrl) {
    const client = getComputerVisionClient();
    
    if (!client) {
        return {
            tags: [],
            description: null,
            categories: [],
            adult: null,
            error: 'Computer Vision not configured'
        };
    }
    
    try {
        // Features to analyze
        const visualFeatures = [
            'Categories',
            'Tags',
            'Description',
            'Adult',
            'Color',
            'ImageType',
            'Objects'
        ];
        
        const result = await client.analyzeImage(imageUrl, { visualFeatures });
        
        // Extract tags (with confidence > 0.5)
        const tags = result.tags
            ? result.tags
                .filter(tag => tag.confidence > 0.5)
                .map(tag => tag.name.toLowerCase())
                .slice(0, 10)
            : [];
        
        // Get description
        const description = result.description?.captions?.[0]?.text || null;
        
        // Get categories
        const categories = result.categories
            ? result.categories.map(cat => cat.name.replace(/_/g, ' '))
            : [];
        
        // Get adult content info
        const adult = result.adult || null;
        
        // Get dominant colors
        const colors = result.color
            ? {
                dominant: result.color.dominantColors,
                accent: result.color.accentColor,
                isBW: result.color.isBWImg
            }
            : null;
        
        // Get detected objects
        const objects = result.objects
            ? result.objects.map(obj => ({
                name: obj.object,
                confidence: obj.confidence,
                rectangle: obj.rectangle
            }))
            : [];
        
        return {
            tags,
            description,
            categories,
            adult,
            colors,
            objects,
            raw: result
        };
    } catch (error) {
        console.error('Computer Vision analysis error:', error);
        return {
            tags: [],
            description: null,
            categories: [],
            adult: null,
            error: error.message
        };
    }
}

// Generate image thumbnail
async function generateThumbnail(imageUrl, width = 200, height = 200) {
    const client = getComputerVisionClient();
    
    if (!client) {
        return null;
    }
    
    try {
        const result = await client.generateThumbnail(width, height, imageUrl, { smartCropping: true });
        return result;
    } catch (error) {
        console.error('Thumbnail generation error:', error);
        return null;
    }
}

// Read text from image (OCR)
async function readText(imageUrl) {
    const client = getComputerVisionClient();
    
    if (!client) {
        return { text: [], error: 'Computer Vision not configured' };
    }
    
    try {
        const result = await client.read(imageUrl);
        
        // Get operation ID from the response headers
        const operationId = result.operationLocation.split('/').slice(-1)[0];
        
        // Poll for results
        let readResult;
        do {
            await new Promise(resolve => setTimeout(resolve, 1000));
            readResult = await client.getReadResult(operationId);
        } while (readResult.status === 'running' || readResult.status === 'notStarted');
        
        if (readResult.status === 'succeeded') {
            const text = readResult.analyzeResult.readResults
                .flatMap(page => page.lines.map(line => line.text));
            return { text, status: 'succeeded' };
        }
        
        return { text: [], status: readResult.status };
    } catch (error) {
        console.error('OCR error:', error);
        return { text: [], error: error.message };
    }
}

// Detect faces in image
async function detectFaces(imageUrl) {
    const client = getComputerVisionClient();
    
    if (!client) {
        return { faces: [], error: 'Computer Vision not configured' };
    }
    
    try {
        const result = await client.analyzeImage(imageUrl, { visualFeatures: ['Faces'] });
        
        const faces = result.faces
            ? result.faces.map(face => ({
                age: face.age,
                gender: face.gender,
                rectangle: face.faceRectangle
            }))
            : [];
        
        return { faces };
    } catch (error) {
        console.error('Face detection error:', error);
        return { faces: [], error: error.message };
    }
}

// Content moderation using Content Moderator API
async function moderateContent(imageUrl) {
    const key = process.env.CONTENT_MODERATOR_KEY;
    const endpoint = process.env.CONTENT_MODERATOR_ENDPOINT;
    
    if (!key || !endpoint) {
        // Fall back to Computer Vision adult detection
        const analysis = await analyzeImage(imageUrl);
        return analysis.adult;
    }
    
    try {
        const response = await fetch(`${endpoint}/contentmoderator/moderate/v1.0/ProcessImage/Evaluate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': key
            },
            body: JSON.stringify({ DataRepresentation: 'URL', Value: imageUrl })
        });
        
        if (!response.ok) {
            throw new Error(`Content Moderator API error: ${response.status}`);
        }
        
        const result = await response.json();
        
        return {
            isAdultContent: result.IsImageAdultClassified,
            isRacyContent: result.IsImageRacyClassified,
            adultScore: result.AdultClassificationScore,
            racyScore: result.RacyClassificationScore
        };
    } catch (error) {
        console.error('Content moderation error:', error);
        // Fall back to Computer Vision
        const analysis = await analyzeImage(imageUrl);
        return analysis.adult;
    }
}

// Check service health
async function checkHealth() {
    const client = getComputerVisionClient();
    
    if (!client) {
        return { status: 'not_configured' };
    }
    
    try {
        // Try a simple operation to verify connectivity
        await client.listModels();
        return { status: 'healthy' };
    } catch (error) {
        return { status: 'unhealthy', error: error.message };
    }
}

module.exports = {
    getComputerVisionClient,
    analyzeImage,
    generateThumbnail,
    readText,
    detectFaces,
    moderateContent,
    checkHealth
};
