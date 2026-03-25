// ==================== LEARNSWAP NOTIFICATIONS ====================
(function () {
    'use strict';

    var POLL_MS = 15000;
    var pollTimer = null;
    var bellInjected = false;

    document.addEventListener('DOMContentLoaded', function () {
        injectBell();
        if (isAuthenticated()) {
            loadNotifications();
            startPolling();
            connectSocket();
        }
    });

    function hasSidebar() {
        return !!document.querySelector('.sidebar');
    }

    // ── Inject Bell ──────────────────────────────────────────────────────────
    function injectBell() {
        if (bellInjected) return;
        bellInjected = true;

        // Panel is always appended directly to body — never clipped by any container
        var panelDiv = document.createElement('div');
        panelDiv.id = 'lsNotifPanel';
        panelDiv.style.cssText =
            'display:none;position:fixed;top:60px;right:20px;z-index:999999;' +
            'width:320px;max-height:460px;overflow-y:auto;' +
            'background:#fff;border:1px solid #e5e7eb;' +
            'border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.18);';
        panelDiv.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;' +
            'padding:12px 16px 8px;border-bottom:1px solid #f3f4f6;">' +
            '<span style="font-weight:700;font-size:0.92rem;color:#111;">Notifications</span>' +
            '<button onclick="window._lsMarkAllRead()" ' +
            'style="background:none;border:none;cursor:pointer;color:#6366f1;font-size:0.75rem;font-weight:500;padding:2px 6px;">' +
            'Mark all read</button></div>' +
            '<div id="lsNotifList" style="padding:4px 0;">' +
            '<p style="text-align:center;color:#9ca3af;padding:2rem;font-size:0.82rem;">No notifications yet</p>' +
            '</div>';
        document.body.appendChild(panelDiv);

        // Bell button HTML
        var bellBtn =
            '<button id="lsNotifBell" title="Notifications" onclick="window._lsToggle(event)" ' +
            'style="cursor:pointer;position:relative;border:none;background:none;' +
            'font-size:1.2rem;padding:6px 10px;border-radius:8px;color:#374151;line-height:1;">' +
            '<i class="fas fa-bell"></i>' +
            '<span id="lsNotifBadge" ' +
            'style="display:none;position:absolute;top:0px;right:0px;' +
            'background:#ef4444;color:#fff;font-size:0.6rem;font-weight:700;' +
            'border-radius:999px;min-width:16px;height:16px;padding:0 3px;' +
            'line-height:16px;text-align:center;border:2px solid #fff;">0</span>' +
            '</button>';

        var wrapper = document.createElement('div');
        wrapper.id = 'lsNotifWrapper';

        if (hasSidebar()) {
            // Fixed top-right on inner pages
            wrapper.style.cssText = 'position:fixed;top:14px;right:18px;z-index:99998;';
            wrapper.innerHTML = bellBtn;
            document.body.appendChild(wrapper);
            // Style the bell like a card button on sidebar pages
            setTimeout(function() {
                var b = document.getElementById('lsNotifBell');
                if (b) b.style.cssText +=
                    ';background:#fff;border:1px solid #e5e7eb !important;' +
                    'border-radius:50%;width:40px;height:40px;display:inline-flex;' +
                    'align-items:center;justify-content:center;padding:0;' +
                    'box-shadow:0 2px 8px rgba(0,0,0,0.1);font-size:1rem;color:#374151;';
            }, 0);
        } else {
            // Nav-links on landing page
            var navLinks = document.querySelector('.nav-links');
            if (!navLinks) return;
            wrapper.style.cssText = 'display:inline-flex;align-items:center;margin-right:4px;';
            wrapper.innerHTML = bellBtn;
            var firstBtn = navLinks.querySelector('a.btn, button') || navLinks.firstChild;
            navLinks.insertBefore(wrapper, firstBtn);
        }

        // Close on outside click
        document.addEventListener('click', function (e) {
            var panel = document.getElementById('lsNotifPanel');
            var w     = document.getElementById('lsNotifWrapper');
            var bell  = document.getElementById('lsNotifBell');
            if (!panel) return;
            if ((w && w.contains(e.target)) || (bell && bell.contains(e.target))) return;
            panel.style.display = 'none';
        });
    }

    // ── Toggle panel ─────────────────────────────────────────────────────────
    window._lsToggle = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        var panel = document.getElementById('lsNotifPanel');
        if (!panel) return;

        if (panel.style.display === 'block') {
            panel.style.display = 'none';
            return;
        }

        // Position below the bell
        var bell = document.getElementById('lsNotifBell');
        if (bell) {
            var rect = bell.getBoundingClientRect();
            panel.style.top   = (rect.bottom + window.scrollY + 8) + 'px';
            panel.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
            panel.style.left  = 'auto';
        }

        panel.style.display = 'block';
        if (isAuthenticated()) loadNotifications();
    };

    window._lsMarkAllRead = function () {
        var token = localStorage.getItem('token');
        if (!token) return;
        fetch(apiUrl() + '/api/notifications/read-all', {
            method: 'PUT', headers: { 'Authorization': 'Bearer ' + token }
        }).then(function () { loadNotifications(); }).catch(function () {});
    };

    window._lsReadOne = function (id, el) {
        var token = localStorage.getItem('token');
        if (!token) return;
        if (el) {
            el.style.background = '';
            var dot = el.querySelector('.ls-dot');
            if (dot) dot.remove();
        }
        fetch(apiUrl() + '/api/notifications/' + id + '/read', {
            method: 'PUT', headers: { 'Authorization': 'Bearer ' + token }
        }).then(function () { loadNotifications(); }).catch(function () {});
    };

    // ── Load & render ─────────────────────────────────────────────────────────
    function loadNotifications() {
        var token = localStorage.getItem('token');
        if (!token) return;

        fetch(apiUrl() + '/api/notifications', {
            headers: { 'Authorization': 'Bearer ' + token }
        })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
            if (!data) { renderEmpty(); return; }
            setBadge(data.unread_count || 0);
            renderList(data.notifications || []);
        })
        .catch(function () { renderEmpty(); });
    }

    function renderEmpty() {
        var el = document.getElementById('lsNotifList');
        if (el) el.innerHTML =
            '<p style="text-align:center;color:#9ca3af;padding:2rem;font-size:0.82rem;">No notifications yet</p>';
    }

    function setBadge(count) {
        var b = document.getElementById('lsNotifBadge');
        if (!b) return;
        if (count > 0) {
            b.style.display = 'inline-block';
            b.textContent = count > 99 ? '99+' : String(count);
        } else {
            b.style.display = 'none';
        }
    }

    // Use Font Awesome icons instead of emojis (works on all Windows systems)
    var ICONS = {
        session_requested:         '<i class="fas fa-paper-plane"  style="color:#6366f1;"></i>',
        session_accepted:          '<i class="fas fa-check-circle" style="color:#22c55e;"></i>',
        session_teacher_confirmed: '<i class="fas fa-user-check"   style="color:#6366f1;"></i>',
        session_learner_confirmed: '<i class="fas fa-user-check"   style="color:#6366f1;"></i>',
        credits_received:          '<i class="fas fa-coins"        style="color:#f59e0b;"></i>',
        session_completed:         '<i class="fas fa-graduation-cap" style="color:#6366f1;"></i>'
    };
    var DEFAULT_ICON = '<i class="fas fa-bell" style="color:#6366f1;"></i>';

    function renderList(list) {
        var el = document.getElementById('lsNotifList');
        if (!el) return;
        if (!list.length) { renderEmpty(); return; }

        el.innerHTML = list.map(function (n) {
            var icon = ICONS[n.type] || DEFAULT_ICON;
            var ago  = timeAgo(n.created_at);
            var read = (n.is_read === true || n.is_read === 1 || n.is_read === '1');
            var bg   = read ? '' : 'background:#f5f3ff;';
            var dot  = read ? '' :
                '<span class="ls-dot" style="width:7px;height:7px;border-radius:50%;' +
                'background:#6366f1;flex-shrink:0;margin-top:6px;display:inline-block;"></span>';
            return '<div onclick="window._lsReadOne(' + n.id + ',this)" ' +
                'style="display:flex;gap:10px;padding:11px 14px;cursor:pointer;' + bg +
                'border-bottom:1px solid #f3f4f6;">' +
                '<span style="font-size:1rem;flex-shrink:0;width:20px;text-align:center;margin-top:1px;">' + icon + '</span>' +
                '<div style="flex:1;min-width:0;">' +
                '<div style="font-weight:600;font-size:0.8rem;color:#111;margin-bottom:2px;">' + esc(n.title) + '</div>' +
                '<div style="font-size:0.76rem;color:#6b7280;line-height:1.4;">' + esc(n.message) + '</div>' +
                '<div style="font-size:0.7rem;color:#9ca3af;margin-top:3px;">' + ago + '</div>' +
                '</div>' + dot + '</div>';
        }).join('');
    }

    // ── Toast pop-up (bottom-right) ───────────────────────────────────────────
    function showToast(title, message, type) {
        var icon = ICONS[type] || DEFAULT_ICON;
        var t = document.createElement('div');
        t.style.cssText =
            'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999999;' +
            'background:#fff;border:1px solid #e5e7eb;border-left:4px solid #6366f1;' +
            'border-radius:12px;padding:14px 16px;max-width:300px;' +
            'box-shadow:0 6px 24px rgba(0,0,0,0.14);display:flex;gap:10px;align-items:flex-start;';
        t.innerHTML =
            '<span style="font-size:1.1rem;flex-shrink:0;width:20px;text-align:center;">' + icon + '</span>' +
            '<div style="flex:1;">' +
            '<div style="font-weight:600;font-size:0.82rem;color:#111;">' + esc(title) + '</div>' +
            '<div style="font-size:0.78rem;color:#6b7280;margin-top:2px;">' + esc(message) + '</div>' +
            '</div>' +
            '<button onclick="this.parentElement.remove()" ' +
            'style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:1.1rem;line-height:1;padding:0;flex-shrink:0;">&times;</button>';
        document.body.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.remove(); }, 6000);
    }
    window._lsShowToast = showToast;

    // ── Polling ───────────────────────────────────────────────────────────────
    function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(function () {
            if (isAuthenticated()) loadNotifications();
        }, POLL_MS);
    }

    // ── SocketIO (graceful fallback to polling if unavailable) ────────────────
    function connectSocket() {
        if (typeof io === 'undefined') return;
        var user = getCurrentUser();
        if (!user) return;
        try {
            var sock = io(apiUrl(), { transports: ['polling'] }); // polling only — no WebSocket
            sock.on('connect', function () {
                sock.emit('join_user_room', { userId: user.id });
            });
            sock.on('new_notification', function (n) {
                showToast(n.title, n.message, n.type);
                loadNotifications();
            });
        } catch (e) { /* polling only */ }
    }

    function apiUrl() {
        return (typeof API_URL !== 'undefined') ? API_URL : window.location.origin;
    }
    function esc(str) {
        if (!str) return '';
        var d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }
    function timeAgo(ds) {
        if (!ds) return '';
        var d = Math.floor((Date.now() - new Date(ds).getTime()) / 1000);
        if (d < 60)    return 'Just now';
        if (d < 3600)  return Math.floor(d / 60) + 'm ago';
        if (d < 86400) return Math.floor(d / 3600) + 'h ago';
        return Math.floor(d / 86400) + 'd ago';
    }
})();
