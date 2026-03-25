// Skills management - Browse and request skills

if (!isAuthenticated()) {
    window.location.href = '/';
}

document.addEventListener('DOMContentLoaded', function() {
    loadUserInfo();
    loadSkills();
});

function loadUserInfo() {
    const user = getCurrentUser();
    
    if (user) {
        const userNameEl = document.getElementById('userName');
        const userCreditsEl = document.getElementById('userCredits');
        
        if (userNameEl) userNameEl.textContent = user.username || 'User';
        if (userCreditsEl) userCreditsEl.textContent = `Credits: ${user.credits || 0}`;
    }
}

function getFilters() {
    return {
        search: document.getElementById('searchInput')?.value || '',
        category: document.getElementById('categoryFilter')?.value || '',
        level: document.getElementById('levelFilter')?.value || ''
    };
}

function applyFilters() {
    loadSkills();
}

async function loadSkills() {
    const token = localStorage.getItem('token');
    
    if (!token) {
        showNotification('Please login first', 'error');
        window.location.href = '/';
        return;
    }
    
    const filters = getFilters();
    const grid = document.getElementById('skillsGrid');
    
    if (!grid) return;
    
    grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem;">
            <div class="spinner"></div>
            <p style="margin-top: 1rem; color: var(--text-secondary);">Loading skills...</p>
        </div>
    `;
    
    try {
        const url = new URL(`${API_URL}/api/skills`);
        if (filters.search) url.searchParams.append('search', filters.search);
        if (filters.category) url.searchParams.append('category', filters.category);
        if (filters.level) url.searchParams.append('level', filters.level);
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.skills && data.skills.length > 0) {
            displaySkills(data.skills);
        } else {
            displayNoSkills();
        }
        
    } catch (error) {
        console.error('Error loading skills:', error);
        
        grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 3rem;">
                <i class="fas fa-exclamation-circle" style="font-size: 3rem; color: var(--danger-color); margin-bottom: 1rem;"></i>
                <h3>Failed to Load Skills</h3>
                <p style="color: var(--text-secondary); margin: 1rem 0;">${error.message}</p>
                <button class="btn btn-primary" onclick="loadSkills()">
                    <i class="fas fa-sync-alt"></i> Try Again
                </button>
            </div>
        `;
        
        showNotification('Failed to load skills', 'error');
    }
}

function displayNoSkills() {
    const grid = document.getElementById('skillsGrid');
    if (!grid) return;
    
    grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem;">
            <i class="fas fa-search" style="font-size: 3rem; color: var(--text-light); margin-bottom: 1rem;"></i>
            <h3>No Skills Found</h3>
            <p style="color: var(--text-secondary); margin-bottom: 2rem;">Be the first to add a skill!</p>
            <a href="add-skill.html" class="btn btn-primary">
                <i class="fas fa-plus"></i> Add a Skill
            </a>
        </div>
    `;
}

// FIXED VERSION - Safe rating handling
function displaySkills(skills) {
    const grid = document.getElementById('skillsGrid');
    const user = getCurrentUser();
    
    if (!grid) return;
    
    const availableSkills = user ? skills.filter(skill => skill.user_id != user.id) : skills;
    
    if (availableSkills.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 3rem;">
                <i class="fas fa-user-graduate" style="font-size: 3rem; color: var(--text-light); margin-bottom: 1rem;"></i>
                <h3>No Skills to Learn</h3>
                <p style="color: var(--text-secondary);">All skills are from you! Add more skills or check back later.</p>
                <a href="add-skill.html" class="btn btn-primary" style="margin-top: 1rem;">
                    <i class="fas fa-plus"></i> Add Another Skill
                </a>
            </div>
        `;
        return;
    }
    
    let html = '';
    availableSkills.forEach(skill => {
        // FIX: Convert teacher_rating to number safely
        let rating = 0;
        if (skill.teacher_rating !== null && skill.teacher_rating !== undefined) {
            rating = parseFloat(skill.teacher_rating);
            if (isNaN(rating)) rating = 0;
        }
        
        html += `
            <div class="skill-card">
                <div class="skill-header">
                    <h3>${escapeHtml(skill.name || 'Untitled')}</h3>
                    <span class="skill-level ${skill.level || 'Beginner'}">${skill.level || 'Beginner'}</span>
                </div>
                <p class="skill-description">${escapeHtml(skill.description || 'No description provided')}</p>
                ${(skill.total_planned_sessions > 1) ? `<div style="font-size:0.78rem;color:#6366f1;font-weight:600;margin-bottom:6px;"><i class="fas fa-layer-group"></i> ${skill.total_planned_sessions} session course</div>` : ''}
                <div class="skill-teacher">
                    <i class="fas fa-user"></i>
                    <span>${escapeHtml(skill.teacher_name || 'Unknown')}</span>
                </div>
                <div class="skill-rating">
                    ${generateStarRating(rating)}
                    <span style="color: var(--text-secondary); margin-left: 0.5rem;">(${rating.toFixed(1)})</span>
                </div>
                <div class="skill-footer">
                    <span class="skill-credits">${skill.credits_per_hour || 0} credits/hour</span>
                    <button class="btn btn-primary" onclick='openRequestModal("${skill.id}", "${skill.user_id}", "${escapeHtml(skill.name)}", "${escapeHtml(skill.teacher_name)}")'>
                        Request Session
                    </button>
                </div>
            </div>
        `;
    });
    
    grid.innerHTML = html;
}

// Make sure generateStarRating can handle numbers
function generateStarRating(rating) {
    // Ensure rating is a number
    const numRating = parseFloat(rating) || 0;
    const fullStars = Math.floor(numRating);
    const hasHalfStar = numRating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    
    let stars = '';
    
    for (let i = 0; i < fullStars; i++) {
        stars += '<i class="fas fa-star" style="color: #fbbf24;"></i>';
    }
    
    if (hasHalfStar) {
        stars += '<i class="fas fa-star-half-alt" style="color: #fbbf24;"></i>';
    }
    
    for (let i = 0; i < emptyStars; i++) {
        stars += '<i class="far fa-star" style="color: #fbbf24;"></i>';
    }
    
    return stars;
}

async function addSkill(event) {
    event.preventDefault();
    
    const token = localStorage.getItem('token');
    if (!token) {
        showNotification('Please login first', 'error');
        window.location.href = '/';
        return;
    }
    
    const nameInput = document.getElementById('skillName');
    const categoryInput = document.getElementById('skillCategory');
    const levelInput = document.getElementById('skillLevel');
    const descriptionInput = document.getElementById('skillDescription');
    const tagsInput = document.getElementById('skillTags');
    const creditsInput = document.getElementById('creditsPerHour');
    
    if (!nameInput || !categoryInput || !levelInput || !creditsInput) {
        showNotification('Form elements not found', 'error');
        return;
    }
    
    const skillData = {
        name: nameInput.value.trim(),
        category: categoryInput.value,
        level: levelInput.value,
        description: descriptionInput ? descriptionInput.value.trim() : '',
        tags: tagsInput ? tagsInput.value.split(',').map(tag => tag.trim()).filter(tag => tag) : [],
        creditsPerHour: parseInt(creditsInput.value),
        totalPlannedSessions: parseInt(document.getElementById('totalPlannedSessions')?.value || '1'),
        courseDurationDays: parseInt(document.getElementById('courseDurationDays')?.value || '30')
    };
    
    if (!skillData.name) {
        showNotification('Please enter a skill name', 'error');
        nameInput.focus();
        return;
    }
    
    if (!skillData.category) {
        showNotification('Please select a category', 'error');
        categoryInput.focus();
        return;
    }
    
    if (!skillData.level) {
        showNotification('Please select a proficiency level', 'error');
        levelInput.focus();
        return;
    }
    
    if (isNaN(skillData.creditsPerHour) || skillData.creditsPerHour < 5 || skillData.creditsPerHour > 100) {
        showNotification('Credits per hour must be between 5 and 100', 'error');
        creditsInput.focus();
        return;
    }
    
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
    submitBtn.disabled = true;
    
    try {
        const response = await fetch(`${API_URL}/api/skills`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(skillData)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('Skill added successfully!', 'success');
            
            nameInput.value = '';
            categoryInput.value = '';
            levelInput.value = '';
            if (descriptionInput) descriptionInput.value = '';
            if (tagsInput) tagsInput.value = '';
            creditsInput.value = '10';
            
            setTimeout(() => {
                window.location.href = 'profile.html';
            }, 2000);
        } else {
            showNotification(data.error || 'Failed to add skill', 'error');
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    } catch (error) {
        console.error('Error adding skill:', error);
        showNotification('Failed to add skill. Please try again.', 'error');
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

function openRequestModal(skillId, teacherId, skillName, teacherName) {
    document.getElementById('requestSkillId').value = skillId;
    document.getElementById('requestTeacherId').value = teacherId;
    document.getElementById('requestSkillName').textContent = skillName;
    document.getElementById('requestTeacherName').textContent = teacherName;
    document.getElementById('requestModal').style.display = 'block';
    calculateCredits();
}

async function calculateCredits() {
    const skillId = document.getElementById('requestSkillId').value;
    const duration = parseFloat(document.getElementById('duration').value) || 0;
    
    const token = localStorage.getItem('token');
    
    try {
        const response = await fetch(`${API_URL}/api/skills/${skillId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            const creditsPerHour = data.skill?.credits_per_hour || 10;
            const totalCredits = creditsPerHour * duration;
            document.getElementById('creditsRequired').textContent = totalCredits;
        }
    } catch (error) {
        console.error('Error calculating credits:', error);
    }
}

// UPDATED submitRequest with datetime fix
async function submitRequest(event) {
    event.preventDefault();
    
    const token = localStorage.getItem('token');
    const user = getCurrentUser();
    
    const scheduledTime = document.getElementById('scheduledTime').value;
    if (!scheduledTime) {
        showNotification('Please select a date and time', 'error');
        return;
    }
    
    // FIX: Convert to MySQL datetime format
    // scheduledTime comes as "2026-03-27T03:30" from datetime-local input
    // Replace 'T' with space and add seconds
    const mysqlDateTime = scheduledTime.replace('T', ' ') + ':00';
    
    const requestData = {
        skillId: document.getElementById('requestSkillId').value,
        scheduledTime: mysqlDateTime,  // Send in MySQL format
        duration: parseFloat(document.getElementById('duration').value)
    };
    
    console.log('Submitting request:', requestData);
    
    try {
        const response = await fetch(`${API_URL}/api/sessions/request`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(requestData)
        });
        
        const data = await response.json();
        console.log('Request response:', data);
        
        if (response.ok) {
            showNotification(`Session requested! ${data.creditsAllocated} credits will be charged after session completion.`, 'success');
            closeModal('requestModal');
            
            // Do NOT touch credits here — credits only move after both parties confirm completion
            
            setTimeout(() => {
                window.location.href = 'my-sessions.html';
            }, 2000);
        } else {
            showNotification(data.error || 'Failed to request session', 'error');
        }
    } catch (error) {
        console.error('Error requesting session:', error);
        showNotification('Failed to request session. Please try again.', 'error');
    }
}