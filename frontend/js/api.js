// API Service Module
class ApiService {
    constructor() {
        this.baseUrl = CONFIG.API_BASE_URL;
    }

    // Get authorization headers
    getHeaders(includeAuth = true) {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (includeAuth) {
            const token = localStorage.getItem(CONFIG.TOKEN_KEY);
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
        }
        
        return headers;
    }

    // Generic API request handler
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            headers: this.getHeaders(options.auth !== false),
            ...options
        };

        try {
            const response = await fetch(url, config);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error(`API Error [${endpoint}]:`, error);
            throw error;
        }
    }

    // === Authentication APIs ===
    async register(userData) {
        return this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify(userData),
            auth: false
        });
    }

    async login(credentials) {
        return this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify(credentials),
            auth: false
        });
    }

    async getProfile() {
        return this.request('/auth/profile');
    }

    async updateProfile(profileData) {
        return this.request('/auth/profile', {
            method: 'PUT',
            body: JSON.stringify(profileData)
        });
    }

    // === Photos APIs ===
    async getPhotos(params = {}) {
        const queryParams = new URLSearchParams();
        
        if (params.page) queryParams.append('page', params.page);
        if (params.limit) queryParams.append('limit', params.limit);
        if (params.filter) queryParams.append('filter', params.filter);
        if (params.sort) queryParams.append('sort', params.sort);
        if (params.search) queryParams.append('search', params.search);
        if (params.creatorId) queryParams.append('creatorId', params.creatorId);
        
        const query = queryParams.toString();
        return this.request(`/photos${query ? '?' + query : ''}`, {
            auth: false
        });
    }

    async getPhoto(photoId) {
        return this.request(`/photos/${photoId}`, {
            auth: false
        });
    }

    async uploadPhoto(formData, onProgress) {
        const url = `${this.baseUrl}/photos`;
        const token = localStorage.getItem(CONFIG.TOKEN_KEY);

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable && onProgress) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    onProgress(percent);
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(JSON.parse(xhr.responseText));
                } else {
                    try {
                        const error = JSON.parse(xhr.responseText);
                        reject(new Error(error.message || 'Upload failed'));
                    } catch {
                        reject(new Error('Upload failed'));
                    }
                }
            });

            xhr.addEventListener('error', () => reject(new Error('Network error')));
            xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

            xhr.open('POST', url);
            if (token) {
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }
            xhr.send(formData);
        });
    }

    async deletePhoto(photoId) {
        return this.request(`/photos/${photoId}`, {
            method: 'DELETE'
        });
    }

    // === Comments APIs ===
    async getComments(photoId) {
        return this.request(`/photos/${photoId}/comments`, {
            auth: false
        });
    }

    async addComment(photoId, text) {
        return this.request(`/photos/${photoId}/comments`, {
            method: 'POST',
            body: JSON.stringify({ text })
        });
    }

    async deleteComment(photoId, commentId) {
        return this.request(`/photos/${photoId}/comments/${commentId}`, {
            method: 'DELETE'
        });
    }

    // === Ratings APIs ===
    async ratePhoto(photoId, rating) {
        return this.request(`/photos/${photoId}/rate`, {
            method: 'POST',
            body: JSON.stringify({ rating })
        });
    }

    async likePhoto(photoId) {
        return this.request(`/photos/${photoId}/like`, {
            method: 'POST'
        });
    }

    async unlikePhoto(photoId) {
        return this.request(`/photos/${photoId}/like`, {
            method: 'DELETE'
        });
    }

    // === Stats APIs ===
    async getStats() {
        return this.request('/stats', {
            auth: false
        });
    }

    // === Search APIs ===
    async searchPhotos(query) {
        return this.request(`/search?q=${encodeURIComponent(query)}`, {
            auth: false
        });
    }
}

// Create singleton instance
const api = new ApiService();
window.api = api;
