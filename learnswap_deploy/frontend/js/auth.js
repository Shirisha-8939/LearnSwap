// ==================== LEARNSWAP AUTH ====================

// Show forgot password modal
function showForgotPasswordModal() {
    closeModal('loginModal');

    // Restore the form if it was previously replaced with a success message
    var wrap = document.getElementById('forgotFormWrap');
    if (wrap && !document.getElementById('forgotEmail')) {
        wrap.innerHTML =
            '<div class="form-group">' +
            '<label for="forgotEmail">Email Address</label>' +
            '<input type="email" id="forgotEmail" placeholder="The email you registered with">' +
            '</div>' +
            '<button type="button" id="forgotSubmitBtn" class="btn btn-primary btn-full" ' +
            'style="padding:13px;" onclick="handleForgotPassword()">' +
            '<i class="fas fa-key"></i> Get Reset Link' +
            '</button>';
    }

    var modal = document.getElementById('forgotPasswordModal');
    if (modal) modal.style.display = 'block';

    // Focus the email input
    setTimeout(function() {
        var el = document.getElementById('forgotEmail');
        if (el) el.focus();
    }, 100);
}

// Handle forgot password submission
async function handleForgotPassword() {
    var emailEl = document.getElementById('forgotEmail');
    var email   = emailEl ? emailEl.value.trim() : '';

    if (!email) {
        showNotification('Please enter your email address.', 'error');
        if (emailEl) emailEl.focus();
        return;
    }

    var btn = document.getElementById('forgotSubmitBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Please wait...';
    }

    try {
        var res = await fetch(API_URL + '/api/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
        });
        var data = await res.json();

        if (data.success) {
            var wrap = document.getElementById('forgotFormWrap');
            if (!wrap) return;

            if (data.reset_link) {
                // Dev mode — show direct link button
                wrap.innerHTML =
                    '<div style="text-align:center;padding:0.5rem 0;">' +
                    '<div style="width:60px;height:60px;background:#ede9fe;border-radius:50%;' +
                    'display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">' +
                    '<i class="fas fa-check" style="color:#6366f1;font-size:1.5rem;"></i></div>' +
                    '<p style="font-weight:700;color:#111;font-size:1rem;margin-bottom:0.4rem;">Account Found!</p>' +
                    '<p style="color:#6b7280;font-size:0.86rem;margin-bottom:1.4rem;line-height:1.5;">' +
                    'Click the button below to set your new password.</p>' +
                    '<a href="' + data.reset_link + '" ' +
                    'style="display:block;width:100%;padding:13px;background:linear-gradient(135deg,#6366f1,#8b5cf6);' +
                    'color:#fff;border-radius:10px;font-weight:700;text-align:center;text-decoration:none;' +
                    'font-size:0.95rem;box-sizing:border-box;">' +
                    '<i class="fas fa-lock"></i> Set New Password</a>' +
                    '</div>';
            } else {
                // Production — email sent
                wrap.innerHTML =
                    '<div style="text-align:center;padding:0.5rem 0;">' +
                    '<div style="width:60px;height:60px;background:#dcfce7;border-radius:50%;' +
                    'display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">' +
                    '<i class="fas fa-envelope" style="color:#16a34a;font-size:1.4rem;"></i></div>' +
                    '<p style="font-weight:700;color:#111;margin-bottom:0.4rem;">Email Sent!</p>' +
                    '<p style="color:#6b7280;font-size:0.86rem;line-height:1.5;">Check your inbox for the reset link.</p>' +
                    '<button type="button" class="btn btn-primary btn-full" style="margin-top:1.2rem;padding:13px;" ' +
                    'onclick="closeModal(\'forgotPasswordModal\');showLoginModal();">' +
                    '<i class="fas fa-sign-in-alt"></i> Back to Login</button>' +
                    '</div>';
            }
        } else {
            showNotification(data.error || 'Something went wrong. Please try again.', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-key"></i> Get Reset Link';
            }
        }
    } catch (err) {
        showNotification('Cannot reach the server. Make sure the backend is running on port 5000.', 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-key"></i> Get Reset Link';
        }
    }
}

// Handle login
async function handleLogin(event) {
    event.preventDefault();

    var email    = document.getElementById('loginEmail')    ? document.getElementById('loginEmail').value.trim()    : '';
    var password = document.getElementById('loginPassword') ? document.getElementById('loginPassword').value : '';

    if (!email || !password) {
        showNotification('Please enter your email and password.', 'error');
        return;
    }

    // Disable button to prevent double submit
    var btn = event.target.querySelector('button[type="submit"]');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
    }

    try {
        var res = await fetch(API_URL + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, password: password })
        });

        var data = await res.json();

        if (res.ok && data.token) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            closeModal('loginModal');
            showNotification('Login successful! Taking you to dashboard...', 'success');
            setTimeout(function() {
                window.location.href = 'pages/dashboard.html';
            }, 800);
        } else {
            showNotification(data.error || 'Invalid email or password. Please try again.', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
            }
        }
    } catch (err) {
        showNotification('Cannot reach server. Make sure the backend is running on port 5000.', 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
        }
    }
}

// Handle signup
async function handleSignup(event) {
    event.preventDefault();

    var username = document.getElementById('signupUsername') ? document.getElementById('signupUsername').value.trim() : '';
    var email    = document.getElementById('signupEmail')    ? document.getElementById('signupEmail').value.trim()    : '';
    var password = document.getElementById('signupPassword') ? document.getElementById('signupPassword').value         : '';
    var role     = document.getElementById('signupRole')     ? document.getElementById('signupRole').value             : 'both';

    if (!username || !email || !password) {
        showNotification('Please fill in all fields.', 'error');
        return;
    }
    if (password.length < 6) {
        showNotification('Password must be at least 6 characters.', 'error');
        return;
    }

    // Terms checkbox
    var terms = document.getElementById('agreeTerms');
    if (terms && !terms.checked) {
        showNotification('Please read and agree to the Terms & Conditions and Safety Guidelines.', 'error');
        return;
    }

    var btn = event.target.querySelector('button[type="submit"]');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating account...';
    }

    try {
        var res = await fetch(API_URL + '/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, email: email, password: password, role: role })
        });
        var data = await res.json();

        if (res.ok && data.success) {
            showNotification('Account created! Please log in.', 'success');
            closeModal('signupModal');

            // Clear form
            ['signupUsername', 'signupEmail', 'signupPassword'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) el.value = '';
            });
            var t = document.getElementById('agreeTerms');
            if (t) t.checked = false;

            setTimeout(function() { showLoginModal(); }, 600);
        } else {
            showNotification(data.error || 'Registration failed. Please try again.', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-user-plus"></i> Create Free Account';
            }
        }
    } catch (err) {
        showNotification('Cannot reach server. Make sure the backend is running on port 5000.', 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-user-plus"></i> Create Free Account';
        }
    }
}
