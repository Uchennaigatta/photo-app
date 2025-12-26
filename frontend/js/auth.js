// Authentication Module
class AuthService {
    constructor() {
        this.user = null;
        this.token = null;
        this.init();
    }

    init() {
        // Load stored auth data
        this.token = localStorage.getItem(CONFIG.TOKEN_KEY);
        const storedUser = localStorage.getItem(CONFIG.USER_KEY);
        
        if (storedUser) {
            try {
                this.user = JSON.parse(storedUser);
            } catch (e) {
                this.logout();
            }
        }

        // Validate token if exists
        if (this.token) {
            this.validateSession();
        }
    }

    async validateSession() {
        try {
            const profile = await api.getProfile();
            this.user = profile.user;
            localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(this.user));
            this.updateUI();
        } catch (error) {
            console.log('Session validation failed:', error);
            this.logout();
        }
    }

    async register(name, email, password, role) {
        try {
            const response = await api.register({ name, email, password, role });
            
            this.token = response.token;
            this.user = response.user;
            
            localStorage.setItem(CONFIG.TOKEN_KEY, this.token);
            localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(this.user));
            
            this.updateUI();
            showToast('Account created successfully!', 'success');
            
            return true;
        } catch (error) {
            showToast(error.message || 'Registration failed', 'error');
            return false;
        }
    }

    async login(email, password) {
        try {
            const response = await api.login({ email, password });
            
            this.token = response.token;
            this.user = response.user;
            
            localStorage.setItem(CONFIG.TOKEN_KEY, this.token);
            localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(this.user));
            
            this.updateUI();
            showToast(`Welcome back, ${this.user.name}!`, 'success');
            
            return true;
        } catch (error) {
            showToast(error.message || 'Login failed', 'error');
            return false;
        }
    }

    logout() {
        this.token = null;
        this.user = null;
        
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.USER_KEY);
        
        this.updateUI();
        showToast('Logged out successfully', 'info');
    }

    isAuthenticated() {
        return !!this.token && !!this.user;
    }

    isCreator() {
        return this.user?.role === 'creator';
    }

    isConsumer() {
        return this.user?.role === 'consumer';
    }

    getUser() {
        return this.user;
    }

    updateUI() {
        const body = document.body;
        const userAvatar = document.getElementById('userAvatar');
        const userName = document.getElementById('userName');
        const userRole = document.getElementById('userRole');
        const logoutBtn = document.getElementById('logoutBtn');
        const getStartedBtn = document.getElementById('getStartedBtn');

        // Update body class for role-based visibility
        body.classList.remove('user-role-creator', 'user-role-consumer', 'user-authenticated');
        
        if (this.isAuthenticated()) {
            body.classList.add('user-authenticated');
            body.classList.add(`user-role-${this.user.role}`);
            
            // Update user menu
            const avatarUrl = this.user.avatar || 
                `https://ui-avatars.com/api/?name=${encodeURIComponent(this.user.name)}&background=6366f1&color=fff`;
            userAvatar.src = avatarUrl;
            userName.textContent = this.user.name;
            userRole.textContent = this.user.role.charAt(0).toUpperCase() + this.user.role.slice(1);
            
            // Update get started button
            if (getStartedBtn) {
                getStartedBtn.innerHTML = this.isCreator() 
                    ? '<i class="fas fa-upload"></i> Upload Photo'
                    : '<i class="fas fa-compass"></i> Browse Photos';
            }
        } else {
            // Guest state
            userAvatar.src = 'https://ui-avatars.com/api/?name=Guest&background=6366f1&color=fff';
            userName.textContent = 'Guest';
            userRole.textContent = 'Not logged in';
            
            if (getStartedBtn) {
                getStartedBtn.innerHTML = '<i class="fas fa-rocket"></i> Get Started';
            }
        }
    }
}

// Create singleton instance
const auth = new AuthService();
window.auth = auth;
