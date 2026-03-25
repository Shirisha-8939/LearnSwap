// Sessions management

if (!isAuthenticated()) {
    window.location.href = '/';
}

document.addEventListener('DOMContentLoaded', function() {
    loadUserInfo();
    loadSessions();
});

function loadUserInfo() {
    // Show cached data immediately
    const user = getCurrentUser();
    if (user) {
        const userNameEl = document.getElementById('userName');
        const userCreditsEl = document.getElementById('userCredits');
        if (userNameEl) userNameEl.textContent = user.username || 'User';
        if (userCreditsEl) userCreditsEl.textContent = `Credits: ${user.credits || 0}`;
    }

    // Then refresh from server so credits are always accurate
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch(`${API_URL}/api/user/profile`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(r => r.json())
    .then(data => {
        if (data && data.id) {
            // Update localStorage with fresh data
            const stored = getCurrentUser() || {};
            const updated = Object.assign(stored, { credits: data.credits, rating: data.rating });
            localStorage.setItem('user', JSON.stringify(updated));

            const userCreditsEl = document.getElementById('userCredits');
            if (userCreditsEl) userCreditsEl.textContent = `Credits: ${data.credits}`;
        }
    })
    .catch(() => {}); // silently ignore — cached data still shown
}

async function loadSessions() {
    const token = localStorage.getItem('token');
    
    try {
        const response = await fetch(`${API_URL}/api/sessions/my-sessions`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            displaySessions(data.sessions || []);
        }
    } catch (error) {
        console.error('Error loading sessions:', error);
        showNotification('Error loading sessions', 'error');
    }
}

function displaySessions(sessions) {
    const container = document.getElementById('sessionsList');
    if (!container) return;
    
    const user = getCurrentUser();
    
    if (sessions.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 3rem;">No sessions yet. Start by browsing skills!</p>';
        return;
    }
    
    container.innerHTML = sessions.map(session => {
        const isTeacher = session.teacher_id == user?.id;
        const otherUser = isTeacher ? session.learner_name : session.teacher_name;
        const myConfirmed   = isTeacher ? session.teacher_confirmed : session.learner_confirmed;
        const theyConfirmed = isTeacher ? session.learner_confirmed  : session.teacher_confirmed;

        // Confirmation status line
        let confirmStatus = '';
        if (session.status === 'ongoing' || (session.teacher_confirmed || session.learner_confirmed)) {
            if (myConfirmed && theyConfirmed) {
                confirmStatus = `<span style="font-size:0.8rem;color:#22c55e;">Both parties confirmed — credits transferred</span>`;
            } else if (myConfirmed) {
                confirmStatus = `<span style="font-size:0.8rem;color:#f59e0b;">⏳ You confirmed — waiting for ${otherUser} to confirm</span>`;
            } else if (theyConfirmed) {
                confirmStatus = `<span style="font-size:0.8rem;color:#f59e0b;">⏳ ${otherUser} confirmed — your confirmation needed to release credits</span>`;
            }
        }
        
        return `
            <div class="session-item">
                <div class="session-info">
                    <h3>${escapeHtml(session.skill_name || 'Skill Session')}</h3>
                    <div class="session-meta">
                        <span><i class="fas fa-user"></i> ${escapeHtml(otherUser || 'User')}</span>
                        <span><i class="fas fa-calendar"></i> ${formatDate(session.scheduled_time)}</span>
                        <span><i class="fas fa-clock"></i> ${session.duration || 0} hours</span>
                        <span><i class="fas fa-credit-card"></i> ${session.credits_allocated || 0} credits</span>
                    </div>
                    ${confirmStatus ? `<div style="margin-top:0.4rem;">${confirmStatus}</div>` : ''}
                </div>
                <div class="session-actions">
                    <span class="session-status status-${session.status || 'pending'}">${session.status || 'pending'}</span>
                    ${session.status === 'pending' && isTeacher ? `
                        <button class="btn btn-primary" onclick="acceptSession(${session.id})">
                            <i class="fas fa-check"></i> Accept
                        </button>
                    ` : ''}
                    ${session.status === 'accepted' ? `
                        <button class="btn btn-primary" onclick="startSession(${session.id})">
                            <i class="fas fa-play"></i> Start
                        </button>
                    ` : ''}
                    ${session.status === 'ongoing' && !myConfirmed ? `
                        <button class="btn btn-success" onclick="completeSession(${session.id})">
                            <i class="fas fa-check"></i> Confirm Complete
                        </button>
                    ` : ''}
                    ${(session.status === 'ongoing' || session.status === 'completed') ? `
                        <button class="btn btn-outline" style="font-size:0.8rem;padding:0.4rem 0.8rem;border-color:#ef4444;color:#ef4444;" onclick="reportSessionDispute(${session.id})" title="Report a problem with this session">
                            <i class="fas fa-flag"></i> Dispute
                        </button>
                    ` : ''}
                    ${(session.status === 'pending' || session.status === 'accepted' || session.status === 'ongoing') ? `
                        <button class="btn btn-outline" onclick="openChat(${session.id})">
                            <i class="fas fa-comments"></i> Chat
                        </button>
                    ` : ''}
                    ${(session.status === 'pending' || session.status === 'accepted') ? `
                        <button class="btn btn-danger" onclick="cancelSession(${session.id})">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

async function acceptSession(sessionId) {
    const token = localStorage.getItem('token');
    
    try {
        const response = await fetch(`${API_URL}/api/sessions/${sessionId}/accept`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            showNotification('Session accepted!', 'success');
            loadSessions();
        }
    } catch (error) {
        console.error('Error accepting session:', error);
    }
}

async function startSession(sessionId) {
    if (!confirm('Start this session now?')) return;
    
    const token = localStorage.getItem('token');
    
    try {
        const response = await fetch(`${API_URL}/api/sessions/${sessionId}/start`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            showNotification('Session started!', 'success');
            loadSessions();
        }
    } catch (error) {
        console.error('Error starting session:', error);
    }
}

async function completeSession(sessionId) {
    if (!confirm('Confirm this session is complete?\n\nCredits will only be transferred once BOTH you and the other party confirm.')) return;
    
    const token = localStorage.getItem('token');
    
    try {
        const response = await fetch(`${API_URL}/api/sessions/${sessionId}/confirm`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if (data.bothConfirmed) {
                showNotification(`Session complete! ${data.creditsTransferred} credits transferred.`, 'success');
            } else {
                showNotification('Your confirmation recorded. Waiting for the other party to confirm before credits are released.', 'info');
            }
            loadSessions();
        } else {
            showNotification(data.error || 'Error confirming session', 'error');
        }
    } catch (error) {
        console.error('Error completing session:', error);
        showNotification('Error confirming session. Please try again.', 'error');
    }
}

async function cancelSession(sessionId) {
    const reason = prompt('Please provide a reason for cancellation:');
    if (!reason) return;
    
    if (!confirm('Are you sure you want to cancel this session?')) return;
    
    const token = localStorage.getItem('token');
    
    try {
        const response = await fetch(`${API_URL}/api/sessions/${sessionId}/cancel`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ reason })
        });
        
        if (response.ok) {
            showNotification('Session cancelled', 'info');
            loadSessions();
        }
    } catch (error) {
        console.error('Error cancelling session:', error);
    }
}