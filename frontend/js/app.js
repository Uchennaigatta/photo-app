// Main Application Module
document.addEventListener('DOMContentLoaded', () => {
    // Initialize app
    App.init();
});

const App = {
    currentPage: 1,
    currentFilter: 'all',
    currentSort: 'newest',
    currentSearch: '',
    photos: [],
    hasMore: true,
    currentPhoto: null,
    viewingMyPhotos: false,

    init() {
        this.bindEvents();
        this.loadStats();
        this.loadPhotos();
        auth.updateUI();
    },

    bindEvents() {
        // Navigation
        document.getElementById('navToggle').addEventListener('click', this.toggleMobileNav);
        document.getElementById('homeLink').addEventListener('click', (e) => this.navigateTo(e, 'home'));
        document.getElementById('exploreLink').addEventListener('click', (e) => this.navigateTo(e, 'explore'));
        document.getElementById('myPhotosLink')?.addEventListener('click', (e) => this.showMyPhotos(e));
        document.getElementById('myPhotosBtn')?.addEventListener('click', (e) => this.showMyPhotos(e));
        document.getElementById('uploadLink')?.addEventListener('click', (e) => this.openUploadModal(e));

        // User menu
        document.getElementById('userAvatar').addEventListener('click', this.toggleUserDropdown);
        document.getElementById('logoutBtn').addEventListener('click', (e) => {
            e.preventDefault();
            auth.logout();
            this.toggleUserDropdown();
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.nav-user')) {
                document.getElementById('userDropdown').classList.remove('show');
            }
        });

        // Auth modal
        document.getElementById('getStartedBtn').addEventListener('click', () => this.handleGetStarted());
        document.getElementById('authModalClose').addEventListener('click', () => this.closeModal('authModal'));
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.switchAuthTab(e.target.dataset.tab));
        });
        document.querySelectorAll('.switch-auth').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchAuthTab(e.target.dataset.target);
            });
        });

        // Auth forms
        document.getElementById('loginForm').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('registerForm').addEventListener('submit', (e) => this.handleRegister(e));

        // Upload modal
        document.getElementById('uploadModalClose').addEventListener('click', () => this.closeModal('uploadModal'));
        document.getElementById('uploadZone').addEventListener('click', () => document.getElementById('photoInput').click());
        document.getElementById('photoInput').addEventListener('change', (e) => this.handleFileSelect(e));
        document.getElementById('removePreview').addEventListener('click', () => this.removePreview());
        document.getElementById('uploadForm').addEventListener('submit', (e) => this.handleUpload(e));

        // Drag and drop
        const uploadZone = document.getElementById('uploadZone');
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('drag-over');
        });
        uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
        uploadZone.addEventListener('drop', (e) => this.handleDrop(e));

        // Photo modal
        document.getElementById('photoModalClose').addEventListener('click', () => this.closeModal('photoModal'));
        document.getElementById('commentForm').addEventListener('submit', (e) => this.handleComment(e));
        document.querySelectorAll('#starRating i').forEach(star => {
            star.addEventListener('click', (e) => this.handleRating(e));
            star.addEventListener('mouseenter', (e) => this.highlightStars(e.target.dataset.rating));
            star.addEventListener('mouseleave', () => this.resetStars());
        });
        document.getElementById('likeBtn').addEventListener('click', () => this.handleLike());

        // Gallery filters
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleFilter(e));
        });
        document.getElementById('sortSelect').addEventListener('change', (e) => this.handleSort(e));

        // Search
        document.getElementById('searchInput').addEventListener('input', debounce((e) => this.handleSearch(e), 500));

        // Load more
        document.getElementById('loadMoreBtn').addEventListener('click', () => this.loadMore());

        // Hero buttons
        document.getElementById('exploreBtn').addEventListener('click', () => this.scrollToGallery());

        // Close modals on overlay click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });

        // Close modals on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal.show').forEach(modal => {
                    this.closeModal(modal.id);
                });
            }
        });
    },

    // Navigation
    toggleMobileNav() {
        document.querySelector('.nav-links').classList.toggle('show');
    },

    toggleUserDropdown() {
        document.getElementById('userDropdown').classList.toggle('show');
    },

    navigateTo(e, page) {
        e.preventDefault();
        document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
        e.target.closest('.nav-link').classList.add('active');

        // Reset from "My Photos" view
        if (this.viewingMyPhotos) {
            this.viewingMyPhotos = false;
            document.querySelector('.gallery-header h2').innerHTML = '<i class="fas fa-images"></i> Photo Gallery';
            this.currentPage = 1;
            this.photos = [];
            this.loadPhotos();
        }

        if (page === 'home') {
            document.getElementById('heroSection').classList.remove('hidden');
            document.getElementById('featuresSection').classList.remove('hidden');
        } else if (page === 'explore') {
            this.scrollToGallery();
        }
    },

    scrollToGallery() {
        document.getElementById('gallerySection').scrollIntoView({ behavior: 'smooth' });
    },

    // Show My Photos (creator's uploaded photos)
    showMyPhotos(e) {
        e.preventDefault();
        if (!auth.isAuthenticated()) {
            showToast('Please login first', 'warning');
            this.openModal('authModal');
            return;
        }
        
        // Update navigation UI
        document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
        document.getElementById('myPhotosLink')?.classList.add('active');
        
        // Hide hero and features sections
        document.getElementById('heroSection').classList.add('hidden');
        document.getElementById('featuresSection').classList.add('hidden');
        
        // Update gallery title
        document.querySelector('.gallery-header h2').innerHTML = '<i class="fas fa-images"></i> My Uploaded Photos';
        
        // Set filter to show only user's photos
        this.viewingMyPhotos = true;
        this.currentPage = 1;
        this.photos = [];
        this.loadMyPhotos();
        
        // Scroll to gallery
        this.scrollToGallery();
        
        // Close dropdown if open
        document.getElementById('userDropdown').classList.remove('show');
    },

    async loadMyPhotos() {
        const loadingSpinner = document.getElementById('loadingSpinner');
        const photoGrid = document.getElementById('photoGrid');
        const noPhotos = document.getElementById('noPhotos');
        const loadMore = document.getElementById('loadMore');
        
        loadingSpinner.classList.add('show');
        noPhotos.classList.remove('show');
        loadMore.classList.remove('show');
        
        try {
            const user = auth.getUser();
            const response = await api.getPhotos({
                page: this.currentPage,
                limit: 12,
                creatorId: user.id // Filter by current user's ID
            });
            
            if (response.success) {
                const newPhotos = response.data || [];
                this.photos = this.currentPage === 1 ? newPhotos : [...this.photos, ...newPhotos];
                this.hasMore = response.pagination?.hasMore || false;
                
                if (this.currentPage === 1) {
                    photoGrid.innerHTML = '';
                }
                
                if (newPhotos.length > 0) {
                    this.renderPhotos(newPhotos);
                }
                
                if (this.photos.length === 0) {
                    photoGrid.innerHTML = `
                        <div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 60px 20px;">
                            <i class="fas fa-camera" style="font-size: 4rem; color: var(--text-muted); margin-bottom: 20px;"></i>
                            <h3 style="color: var(--text-secondary);">No photos uploaded yet</h3>
                            <p style="color: var(--text-muted); margin-bottom: 20px;">Start sharing your moments with the world!</p>
                            <button class="btn btn-primary" onclick="App.openUploadModal(event)">
                                <i class="fas fa-upload"></i> Upload Your First Photo
                            </button>
                        </div>
                    `;
                } else if (this.hasMore) {
                    loadMore.classList.add('show');
                }
            } else {
                showToast(response.error || 'Failed to load photos', 'error');
            }
        } catch (error) {
            console.error('Load my photos error:', error);
            showToast('Failed to load photos', 'error');
        } finally {
            loadingSpinner.classList.remove('show');
        }
    },

    // Modals
    openModal(modalId) {
        document.getElementById(modalId).classList.add('show');
        document.body.style.overflow = 'hidden';
    },

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('show');
        document.body.style.overflow = '';
    },

    handleGetStarted() {
        if (auth.isAuthenticated()) {
            if (auth.isCreator()) {
                this.openModal('uploadModal');
            } else {
                this.scrollToGallery();
            }
        } else {
            this.openModal('authModal');
        }
    },

    openUploadModal(e) {
        e.preventDefault();
        if (!auth.isAuthenticated()) {
            showToast('Please login to upload photos', 'warning');
            this.openModal('authModal');
            return;
        }
        if (!auth.isCreator()) {
            showToast('Only creators can upload photos', 'warning');
            return;
        }
        this.openModal('uploadModal');
    },

    // Auth
    switchAuthTab(tab) {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`.auth-tab[data-tab="${tab}"]`).classList.add('active');
        
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        document.getElementById(`${tab}Form`).classList.add('active');
    },

    async handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        const success = await auth.login(email, password);
        if (success) {
            this.closeModal('authModal');
            document.getElementById('loginForm').reset();
        }
    },

    async handleRegister(e) {
        e.preventDefault();
        const name = document.getElementById('registerName').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const role = document.getElementById('registerRole').value;

        const success = await auth.register(name, email, password, role);
        if (success) {
            this.closeModal('authModal');
            document.getElementById('registerForm').reset();
        }
    },

    // File handling
    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) this.previewFile(file);
    },

    handleDrop(e) {
        e.preventDefault();
        document.getElementById('uploadZone').classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) this.previewFile(file);
    },

    previewFile(file) {
        // Validate file
        if (!CONFIG.ALLOWED_TYPES.includes(file.type)) {
            showToast('Invalid file type. Please upload an image.', 'error');
            return;
        }
        if (file.size > CONFIG.MAX_FILE_SIZE) {
            showToast('File too large. Maximum size is 10MB.', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('previewImage').src = e.target.result;
            document.getElementById('uploadZone').classList.add('hidden');
            document.getElementById('uploadPreview').classList.add('show');
        };
        reader.readAsDataURL(file);
    },

    removePreview() {
        document.getElementById('photoInput').value = '';
        document.getElementById('previewImage').src = '';
        document.getElementById('uploadPreview').classList.remove('show');
        document.getElementById('uploadZone').classList.remove('hidden');
    },

    async handleUpload(e) {
        e.preventDefault();

        const fileInput = document.getElementById('photoInput');
        const file = fileInput.files[0];

        if (!file) {
            showToast('Please select a photo to upload', 'warning');
            return;
        }

        const formData = new FormData();
        formData.append('photo', file);
        formData.append('title', document.getElementById('photoTitle').value);
        formData.append('caption', document.getElementById('photoCaption').value);
        formData.append('location', document.getElementById('photoLocation').value);
        formData.append('people', document.getElementById('photoPeople').value);
        formData.append('tags', document.getElementById('photoTags').value);
        formData.append('autoTags', document.getElementById('autoTags').checked);
        formData.append('contentModeration', document.getElementById('contentModeration').checked);

        const progressEl = document.getElementById('uploadProgress');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const uploadBtn = document.getElementById('uploadBtn');

        progressEl.classList.add('show');
        uploadBtn.disabled = true;

        try {
            await api.uploadPhoto(formData, (percent) => {
                progressFill.style.width = `${percent}%`;
                progressText.textContent = percent < 100 
                    ? `Uploading... ${percent}%` 
                    : 'Processing with AI...';
            });

            showToast('Photo uploaded successfully!', 'success');
            this.closeModal('uploadModal');
            this.resetUploadForm();
            this.loadPhotos(true);
        } catch (error) {
            showToast(error.message || 'Upload failed', 'error');
        } finally {
            progressEl.classList.remove('show');
            progressFill.style.width = '0%';
            uploadBtn.disabled = false;
        }
    },

    resetUploadForm() {
        document.getElementById('uploadForm').reset();
        this.removePreview();
    },

    // Photos
    async loadStats() {
        try {
            // For demo, use mock data
            // const stats = await api.getStats();
            const stats = { photos: 150, creators: 25, views: 10000 };
            
            animateNumber('totalPhotos', stats.photos);
            animateNumber('totalCreators', stats.creators);
            animateNumber('totalViews', stats.views);
        } catch (error) {
            console.log('Could not load stats:', error);
        }
    },

    async loadPhotos(reset = false) {
        if (reset) {
            this.currentPage = 1;
            this.photos = [];
            this.hasMore = true;
        }

        const loadingSpinner = document.getElementById('loadingSpinner');
        const photoGrid = document.getElementById('photoGrid');
        const noPhotos = document.getElementById('noPhotos');
        const loadMore = document.getElementById('loadMore');

        loadingSpinner.classList.add('show');
        noPhotos.classList.remove('show');
        loadMore.classList.remove('show');

        try {
            // Fetch real photos from API
            const response = await api.getPhotos({
                page: this.currentPage,
                limit: CONFIG.PHOTOS_PER_PAGE,
                filter: this.currentFilter,
                sort: this.currentSort,
                search: this.currentSearch
            });
            
            if (response.success) {
                const newPhotos = response.data || [];
                this.photos = reset ? newPhotos : [...this.photos, ...newPhotos];
                this.hasMore = response.pagination?.hasMore || false;

                if (reset) {
                    photoGrid.innerHTML = '';
                }

                if (newPhotos.length > 0) {
                    this.renderPhotos(newPhotos);
                }

                if (this.photos.length === 0) {
                    noPhotos.classList.add('show');
                } else if (this.hasMore) {
                    loadMore.classList.add('show');
                }
            } else {
                showToast(response.message || 'Failed to load photos', 'error');
            }
        } catch (error) {
            console.error('Failed to load photos:', error);
            showToast('Failed to load photos', 'error');
        } finally {
            loadingSpinner.classList.remove('show');
        }
    },

    renderPhotos(photos) {
        const photoGrid = document.getElementById('photoGrid');
        
        photos.forEach(photo => {
            const card = document.createElement('div');
            card.className = 'photo-card';
            card.dataset.id = photo.id;
            const rating = typeof photo.rating === 'number' ? photo.rating.toFixed(1) : '0.0';
            const likes = photo.likes || 0;
            const comments = photo.comments || 0;
            const creatorAvatar = photo.creator?.avatar || `https://ui-avatars.com/api/?name=User&background=6366f1&color=fff`;
            const creatorName = photo.creator?.name || 'Unknown';
            card.innerHTML = `
                <div class="photo-card-image">
                    <img src="${photo.imageUrl}" alt="${photo.title}" loading="lazy">
                </div>
                <div class="photo-card-overlay">
                    <div class="photo-card-info">
                        <h4>${photo.title}</h4>
                        <p>${photo.caption || ''}</p>
                    </div>
                </div>
                <div class="photo-card-stats">
                    <span><i class="fas fa-heart"></i> ${likes}</span>
                    <span><i class="fas fa-star"></i> ${rating}</span>
                </div>
                <div class="photo-card-content">
                    <h4>${photo.title}</h4>
                    <p>${photo.caption || ''}</p>
                </div>
                <div class="photo-card-footer">
                    <div class="photo-card-creator">
                        <img src="${creatorAvatar}" alt="${creatorName}">
                        <span>${creatorName}</span>
                    </div>
                    <div class="photo-card-actions">
                        <span><i class="far fa-comment"></i> ${comments}</span>
                    </div>
                </div>
            `;
            
            card.addEventListener('click', () => this.openPhotoModal(photo));
            photoGrid.appendChild(card);
        });
    },

    loadMore() {
        this.currentPage++;
        this.loadPhotos();
    },

    handleFilter(e) {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        this.currentFilter = e.target.dataset.filter;
        this.loadPhotos(true);
    },

    handleSort(e) {
        this.currentSort = e.target.value;
        this.loadPhotos(true);
    },

    handleSearch(e) {
        this.currentSearch = e.target.value;
        this.loadPhotos(true);
    },

    // Photo Modal
    openPhotoModal(photo) {
        this.currentPhoto = photo;
        
        document.getElementById('modalImage').src = photo.imageUrl;
        document.getElementById('modalTitle').textContent = photo.title;
        document.getElementById('modalCaption').textContent = photo.caption || '';
        document.getElementById('creatorAvatar').src = photo.creator?.avatar || `https://ui-avatars.com/api/?name=User&background=6366f1&color=fff`;
        document.getElementById('creatorName').textContent = photo.creator?.name || 'Unknown';
        document.getElementById('photoDate').textContent = formatDate(photo.createdAt);
        
        // Location & People
        const locationEl = document.getElementById('modalLocation');
        const peopleEl = document.getElementById('modalPeople');
        
        if (photo.location) {
            locationEl.querySelector('span').textContent = photo.location;
            locationEl.classList.remove('hidden');
        } else {
            locationEl.classList.add('hidden');
        }
        
        if (photo.people && photo.people.length) {
            peopleEl.querySelector('span').textContent = photo.people.join(', ');
            peopleEl.classList.remove('hidden');
        } else {
            peopleEl.classList.add('hidden');
        }
        
        // Tags
        const tagsEl = document.getElementById('modalTags');
        tagsEl.innerHTML = '';
        if (photo.tags && photo.tags.length) {
            photo.tags.forEach(tag => {
                const span = document.createElement('span');
                span.className = 'tag';
                span.textContent = `#${tag}`;
                tagsEl.appendChild(span);
            });
        }
        
        // AI Analysis
        const aiAnalysis = document.getElementById('aiAnalysis');
        const aiTags = document.getElementById('aiTags');
        const aiDescription = document.getElementById('aiDescription');
        
        if (photo.aiAnalysis && photo.aiAnalysis.tags) {
            aiAnalysis.classList.remove('hidden');
            aiTags.innerHTML = '';
            photo.aiAnalysis.tags.forEach(tag => {
                const span = document.createElement('span');
                span.textContent = tag;
                aiTags.appendChild(span);
            });
            aiDescription.textContent = photo.aiAnalysis.description || '';
        } else {
            aiAnalysis.classList.add('hidden');
        }
        
        // Rating
        const rating = typeof photo.rating === 'number' ? photo.rating.toFixed(1) : '0.0';
        document.getElementById('avgRating').textContent = rating;
        document.getElementById('ratingCount').textContent = `(${photo.ratingCount || 0} ratings)`;
        this.resetStars();
        
        // Likes
        document.getElementById('likeCount').textContent = photo.likes;
        const likeBtn = document.getElementById('likeBtn');
        likeBtn.classList.toggle('liked', photo.userLiked);
        likeBtn.querySelector('i').className = photo.userLiked ? 'fas fa-heart' : 'far fa-heart';
        
        // Comments
        this.loadComments(photo);
        
        this.openModal('photoModal');
    },

    loadComments(photo) {
        const commentsList = document.getElementById('commentsList');
        const commentCount = document.getElementById('commentCount');
        
        commentsList.innerHTML = '';
        commentCount.textContent = `(${photo.commentsData?.length || 0})`;
        
        if (photo.commentsData && photo.commentsData.length) {
            photo.commentsData.forEach(comment => {
                const div = document.createElement('div');
                div.className = 'comment';
                div.innerHTML = `
                    <img class="comment-avatar" src="${comment.user.avatar}" alt="${comment.user.name}">
                    <div class="comment-content">
                        <div class="comment-header">
                            <span class="comment-author">${comment.user.name}</span>
                            <span class="comment-date">${formatDate(comment.createdAt)}</span>
                        </div>
                        <p class="comment-text">${comment.text}</p>
                    </div>
                `;
                commentsList.appendChild(div);
            });
        }
    },

    async handleComment(e) {
        e.preventDefault();
        
        if (!auth.isAuthenticated()) {
            showToast('Please login to comment', 'warning');
            this.closeModal('photoModal');
            this.openModal('authModal');
            return;
        }
        
        const input = document.getElementById('commentInput');
        const text = input.value.trim();
        
        if (!text) return;
        
        try {
            // For demo, add mock comment
            const newComment = {
                id: Date.now(),
                text,
                user: auth.getUser(),
                createdAt: new Date().toISOString()
            };
            
            if (!this.currentPhoto.commentsData) {
                this.currentPhoto.commentsData = [];
            }
            this.currentPhoto.commentsData.unshift(newComment);
            this.currentPhoto.comments++;
            
            this.loadComments(this.currentPhoto);
            input.value = '';
            
            showToast('Comment added!', 'success');
            
            // await api.addComment(this.currentPhoto.id, text);
        } catch (error) {
            showToast('Failed to add comment', 'error');
        }
    },

    highlightStars(rating) {
        document.querySelectorAll('#starRating i').forEach((star, index) => {
            star.classList.toggle('active', index < rating);
        });
    },

    resetStars() {
        const userRating = this.currentPhoto?.userRating || 0;
        this.highlightStars(userRating);
    },

    async handleRating(e) {
        if (!auth.isAuthenticated()) {
            showToast('Please login to rate', 'warning');
            return;
        }
        
        const rating = parseInt(e.target.dataset.rating);
        
        try {
            this.currentPhoto.userRating = rating;
            this.highlightStars(rating);
            
            showToast('Rating submitted!', 'success');
            
            // await api.ratePhoto(this.currentPhoto.id, rating);
        } catch (error) {
            showToast('Failed to submit rating', 'error');
        }
    },

    async handleLike() {
        if (!auth.isAuthenticated()) {
            showToast('Please login to like photos', 'warning');
            return;
        }
        
        const likeBtn = document.getElementById('likeBtn');
        const likeCount = document.getElementById('likeCount');
        
        try {
            this.currentPhoto.userLiked = !this.currentPhoto.userLiked;
            this.currentPhoto.likes += this.currentPhoto.userLiked ? 1 : -1;
            
            likeBtn.classList.toggle('liked', this.currentPhoto.userLiked);
            likeBtn.querySelector('i').className = this.currentPhoto.userLiked ? 'fas fa-heart' : 'far fa-heart';
            likeCount.textContent = this.currentPhoto.likes;
            
            // if (this.currentPhoto.userLiked) {
            //     await api.likePhoto(this.currentPhoto.id);
            // } else {
            //     await api.unlikePhoto(this.currentPhoto.id);
            // }
        } catch (error) {
            showToast('Failed to update like', 'error');
        }
    },

    // Mock data for demo
    getMockPhotos() {
        const categories = ['nature', 'portrait', 'architecture', 'street'];
        const mockImages = [
            'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800',
            'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800',
            'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=800',
            'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=800',
            'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800',
            'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800',
            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800',
            'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800',
            'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800',
            'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800',
            'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=800',
            'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800',
            'https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=800',
            'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800',
            'https://images.unsplash.com/photo-1516321497487-e288fb19713f?w=800',
            'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800'
        ];
        
        return mockImages.map((url, index) => ({
            id: `photo-${index + 1}`,
            title: `Beautiful Photo ${index + 1}`,
            caption: 'This is a stunning photograph captured with passion and creativity.',
            imageUrl: url,
            category: categories[index % categories.length],
            location: ['New York', 'Paris', 'Tokyo', 'London'][index % 4],
            tags: ['photography', categories[index % categories.length], 'art'],
            people: index % 3 === 0 ? ['John Doe'] : [],
            likes: Math.floor(Math.random() * 500) + 50,
            rating: (Math.random() * 2 + 3).toFixed(1),
            ratingCount: Math.floor(Math.random() * 100) + 10,
            comments: Math.floor(Math.random() * 50) + 5,
            userLiked: false,
            userRating: 0,
            creator: {
                id: `creator-${(index % 5) + 1}`,
                name: ['Alex Johnson', 'Sarah Smith', 'Mike Brown', 'Emily Davis', 'Chris Wilson'][index % 5],
                avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(['Alex Johnson', 'Sarah Smith', 'Mike Brown', 'Emily Davis', 'Chris Wilson'][index % 5])}&background=6366f1&color=fff`
            },
            aiAnalysis: {
                tags: ['landscape', 'outdoor', 'scenic', 'natural'],
                description: 'AI detected: Beautiful outdoor scene with natural lighting and vibrant colors.'
            },
            commentsData: [
                {
                    id: 1,
                    text: 'Amazing shot! Love the composition.',
                    user: { name: 'Photo Lover', avatar: 'https://ui-avatars.com/api/?name=Photo+Lover&background=ec4899&color=fff' },
                    createdAt: new Date(Date.now() - 3600000).toISOString()
                },
                {
                    id: 2,
                    text: 'The colors are incredible!',
                    user: { name: 'Art Fan', avatar: 'https://ui-avatars.com/api/?name=Art+Fan&background=06b6d4&color=fff' },
                    createdAt: new Date(Date.now() - 7200000).toISOString()
                }
            ],
            createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString()
        }));
    }
};

// Utility Functions
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    toast.innerHTML = `
        <i class="fas ${icons[type]}"></i>
        <span class="toast-message">${message}</span>
        <button class="toast-close">&times;</button>
    `;
    
    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function animateNumber(elementId, target) {
    const element = document.getElementById(elementId);
    const duration = 1500;
    const start = 0;
    const increment = target / (duration / 16);
    let current = start;
    
    const animate = () => {
        current += increment;
        if (current >= target) {
            element.textContent = formatNumber(target);
        } else {
            element.textContent = formatNumber(Math.floor(current));
            requestAnimationFrame(animate);
        }
    };
    
    animate();
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Export for global access
window.showToast = showToast;
window.App = App;
