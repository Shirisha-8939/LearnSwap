// ==================== LEARNSWAP CORE UTILITIES ====================

// API Base URL — all requests go to Flask on port 5000
const API_URL = 'http://localhost:5000';

// ── Notification toast ────────────────────────────────────────────
function showNotification(message, type) {
    type = type || 'info';
    var el = document.getElementById('notification');
    if (!el) return;

    el.textContent = message;
    el.className   = 'notification ' + type;
    el.style.display = 'block';

    // Clear any existing timer
    if (window._notifTimer) clearTimeout(window._notifTimer);
    // Error/warning stay longer; success/info 3s
    var duration = (type === 'error' || type === 'warning') ? 5000 : 3000;
    window._notifTimer = setTimeout(function() {
        el.style.display = 'none';
    }, duration);
}

// ── Date formatting ───────────────────────────────────────────────
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// ── Star rating HTML ──────────────────────────────────────────────
function generateStarRating(rating) {
    var num = parseFloat(rating) || 0;
    var full  = Math.floor(num);
    var half  = (num % 1) >= 0.5 ? 1 : 0;
    var empty = 5 - full - half;
    var s = '';
    for (var i = 0; i < full;  i++) s += '<i class="fas fa-star"          style="color:#fbbf24;"></i>';
    if (half)                        s += '<i class="fas fa-star-half-alt" style="color:#fbbf24;"></i>';
    for (var j = 0; j < empty; j++) s += '<i class="far fa-star"           style="color:#fbbf24;"></i>';
    return s;
}

// ── Modal helpers ─────────────────────────────────────────────────
function showLoginModal() {
    _openModal('loginModal');
}

function showSignupModal() {
    _openModal('signupModal');
}

function closeModal(modalId) {
    var modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
}

function _openModal(modalId) {
    // Close any currently open modal first
    document.querySelectorAll('.modal').forEach(function(m) {
        m.style.display = 'none';
    });
    var modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'block';
}

function switchToSignup() {
    closeModal('loginModal');
    _openModal('signupModal');
}

function switchToLogin() {
    closeModal('signupModal');
    _openModal('loginModal');
}

// Close modal when clicking the backdrop (outside modal-content)
// Uses a delegated listener — does NOT use window.onclick to avoid conflicts
document.addEventListener('click', function(e) {
    // Only close if the click target IS the modal backdrop div itself
    if (e.target && e.target.classList && e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});

// Close modal on Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(function(m) {
            m.style.display = 'none';
        });
    }
});

// ── Auth utilities ────────────────────────────────────────────────
function isAuthenticated() {
    var token = localStorage.getItem('token');
    if (!token) return false;
    // Basic token expiry check without a library
    try {
        var payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            // Token expired — clean up
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            return false;
        }
    } catch(e) { /* malformed token */ }
    return true;
}

function getCurrentUser() {
    var s = localStorage.getItem('user');
    if (!s) return null;
    try { return JSON.parse(s); } catch(e) { return null; }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
}

// ── XSS protection ────────────────────────────────────────────────
function escapeHtml(text) {
    if (!text) return '';
    var d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

// ── Auth guard for inner pages ────────────────────────────────────
// Call this at the top of any page that requires login
function requireAuth() {
    if (!isAuthenticated()) {
        window.location.href = '/';
        return false;
    }
    return true;
}
