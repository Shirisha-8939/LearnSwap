// Profile management

if (!isAuthenticated()) {
    window.location.href = '/';
}

document.addEventListener('DOMContentLoaded', function() {
    loadUserProfile();
    loadMySkills();
    loadUserReviews();
});

async function loadUserProfile() {
    const token = localStorage.getItem('token');
    
    try {
        const response = await fetch(`${API_URL}/api/user/profile`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const user = await response.json();
            
            document.getElementById('userName').textContent = user.username || 'User';
            document.getElementById('userCredits').textContent = `Credits: ${user.credits || 0}`;
            document.getElementById('profileUsername').textContent = user.username || 'User';
            document.getElementById('profileEmail').textContent = user.email || '';
            document.getElementById('profileCredits').textContent = user.credits || 0;
            document.getElementById('profileRating').textContent = (user.rating || 0).toFixed(1);
            document.getElementById('profileSessions').textContent = user.total_sessions || 0;
            document.getElementById('profileRole').textContent = user.role || 'both';
            
            if (user.created_at) {
                const date = new Date(user.created_at);
                document.getElementById('profileJoined').textContent = date.toLocaleDateString();
            }
        }
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

async function loadMySkills() {
    const token = localStorage.getItem('token');
    
    try {
        const response = await fetch(`${API_URL}/api/skills/my-skills`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            displayMySkills(data.skills || []);
        }
    } catch (error) {
        console.error('Error loading skills:', error);
        document.getElementById('mySkills').innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 2rem;">
                <i class="fas fa-exclamation-circle" style="color: var(--danger-color);"></i>
                <p>Failed to load skills</p>
            </div>
        `;
    }
}

function displayMySkills(skills) {
    const container = document.getElementById('mySkills');
    if (!container) return;
    
    if (!skills || skills.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 2rem;">
                <i class="fas fa-plus-circle" style="font-size: 2rem; color: var(--primary-color); margin-bottom: 1rem;"></i>
                <p>You haven't added any skills yet.</p>
                <a href="add-skill.html" class="btn btn-primary" style="margin-top: 1rem;">
                    <i class="fas fa-plus"></i> Add Your First Skill
                </a>
            </div>
        `;
        return;
    }
    
    container.innerHTML = skills.map(skill => `
        <div class="profile-skill-card">
            <div class="profile-skill-header">
                <div class="profile-skill-name">${escapeHtml(skill.name || 'Untitled')}</div>
                <span class="profile-skill-level">${skill.level || 'Beginner'}</span>
            </div>
            <div style="color: var(--text-secondary); font-size: 0.9rem; margin: 0.5rem 0;">
                ${escapeHtml(skill.description ? skill.description.substring(0, 60) + '...' : 'No description')}
            </div>
            <div class="profile-skill-credits">
                ${skill.credits_per_hour || 0} credits/hour
            </div>
        </div>
    `).join('');
}

async function loadUserReviews() {
    const token = localStorage.getItem('token');
    const user = getCurrentUser();
    
    if (!user) return;
    
    try {
        const response = await fetch(`${API_URL}/api/reviews/user/${user.id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            displayReviews(data.reviews || []);
        }
    } catch (error) {
        console.error('Error loading reviews:', error);
    }
}

function displayReviews(reviews) {
    const container = document.getElementById('recentReviews');
    if (!container) return;
    
    if (!reviews || reviews.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem;">No reviews yet.</div>';
        return;
    }
    
    container.innerHTML = reviews.map(review => {
        const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
        
        return `
            <div class="review-item">
                <div class="review-header">
                    <span class="reviewer-name">${escapeHtml(review.reviewer_name || 'Anonymous')}</span>
                    <span class="review-rating">${stars}</span>
                </div>
                <div class="review-comment">${escapeHtml(review.comment || 'No comment provided')}</div>
                <div class="review-date">${new Date(review.created_at).toLocaleDateString()}</div>
            </div>
        `;
    }).join('');
}