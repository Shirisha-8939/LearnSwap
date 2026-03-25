// Dashboard functionality
if (!isAuthenticated()) window.location.href = '/';

document.addEventListener('DOMContentLoaded', function() {
    loadUserProfile();
    loadRecentSessions();
});

async function loadUserProfile() {
    var u = getCurrentUser();
    if (u) {
        document.getElementById('userName').textContent      = u.username || 'User';
        document.getElementById('welcomeName').textContent   = u.username || 'User';
        document.getElementById('userCredits').textContent   = 'Credits: ' + (u.credits || 0);
        document.getElementById('creditsCount').textContent  = u.credits || 0;
        // Show profile pic in sidebar if available
        if (u.profile_pic) {
            var sa = document.getElementById('sidebarAvatar');
            if (sa) sa.innerHTML = '<img src="' + u.profile_pic + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="Avatar">';
        }
    }

    var token = localStorage.getItem('token');
    try {
        var res = await fetch(API_URL + '/api/user/profile', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) return;
        var userData = await res.json();
        localStorage.setItem('user', JSON.stringify(userData));

        document.getElementById('userName').textContent     = userData.username || 'User';
        document.getElementById('welcomeName').textContent  = userData.username || 'User';
        document.getElementById('userCredits').textContent  = 'Credits: ' + (userData.credits || 0);
        document.getElementById('creditsCount').textContent = userData.credits || 0;
        document.getElementById('ratingCount').textContent  = userData.total_sessions > 0
            ? parseFloat(userData.rating || 0).toFixed(1)
            : '—';

        if (userData.profile_pic) {
            var sa2 = document.getElementById('sidebarAvatar');
            if (sa2) sa2.innerHTML = '<img src="' + userData.profile_pic + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="Avatar">';
        }
    } catch(e) { console.error(e); }
}

async function loadRecentSessions() {
    var token = localStorage.getItem('token');
    var user  = getCurrentUser();
    try {
        var res = await fetch(API_URL + '/api/sessions/my-sessions', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        var data = await res.json();
        if (res.ok) {
            var sessions = data.sessions || [];
            document.getElementById('teachingCount').textContent = sessions.filter(function(s){ return s.teacher_id == user?.id; }).length;
            document.getElementById('learningCount').textContent = sessions.filter(function(s){ return s.learner_id == user?.id; }).length;
            displayRecentSessions(sessions.slice(0, 6), user?.id);
        }
    } catch(e) { console.error(e); }
}

function displayRecentSessions(sessions, userId) {
    var container = document.getElementById('recentSessions');
    if (!container) return;

    if (!sessions || !sessions.length) {
        container.innerHTML =
            '<div class="empty-state">' +
            '<i class="fas fa-calendar-plus"></i>' +
            '<p>No sessions yet. Browse skills to get started!</p>' +
            '<a href="browse-skills.html" class="btn btn-primary"><i class="fas fa-search"></i> Browse Skills</a>' +
            '</div>';
        return;
    }

    var statusClass = { pending:'status-pending', accepted:'status-accepted', ongoing:'status-ongoing', completed:'status-completed', cancelled:'status-cancelled' };

    container.innerHTML = sessions.map(function(s) {
        var isTeacher   = s.teacher_id == userId;
        var otherName   = isTeacher ? (s.learner_name || 'Learner') : (s.teacher_name || 'Teacher');
        var initials    = otherName.substring(0,2).toUpperCase();
        var status      = s.status || 'pending';
        var statusCls   = statusClass[status] || 'status-pending';
        var skillName   = escapeHtml(s.skill_name || 'Session');
        var date        = s.scheduled_time ? formatDate(s.scheduled_time) : 'TBD';

        // Course progress bar
        var totalPlan   = parseInt(s.total_planned_sessions) || 0;
        var completed   = parseInt(s.completed_session_count) || 0;
        var pct         = totalPlan > 1 ? Math.min(100, Math.round(completed / totalPlan * 100)) : 0;
        var progressHtml = totalPlan > 1
            ? '<div class="sess-progress-wrap">' +
              '<div class="sess-progress-label"><span>Course Progress</span><span>' + completed + '/' + totalPlan + ' sessions</span></div>' +
              '<div class="sess-progress-bar"><div class="sess-progress-fill" style="width:' + pct + '%;"></div></div>' +
              '</div>'
            : '';

        return '<div class="sess-card">' +
            '<div class="sess-avatar">' + initials + '</div>' +
            '<div class="sess-body">' +
            '<div class="sess-title">' + skillName + '</div>' +
            '<div class="sess-meta">' +
            '<span><i class="fas fa-user"></i>' + escapeHtml(otherName) + '</span>' +
            '<span><i class="fas fa-calendar"></i>' + date + '</span>' +
            '<span><i class="fas fa-coins"></i>' + (s.credits_allocated || 0) + ' credits</span>' +
            '</div>' +
            progressHtml +
            '</div>' +
            '<div class="sess-right">' +
            '<span class="status-badge ' + statusCls + '">' + status + '</span>' +
            (status === 'pending' || status === 'accepted' || status === 'ongoing'
                ? '<a href="my-sessions.html" style="font-size:0.75rem;color:#6366f1;font-weight:500;">Manage</a>'
                : '') +
            '</div>' +
            '</div>';
    }).join('');
}
