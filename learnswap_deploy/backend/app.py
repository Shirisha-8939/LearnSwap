from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import jwt
from datetime import datetime, timedelta, timezone
from functools import wraps
import bcrypt
import os, sys, logging, secrets, json
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from config import Config
from database import get_db, init_db, close_db
from models import User, Skill, Session, Message, Review, Transaction
from credit_system import CreditSystem

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Calculate correct absolute path to frontend
backend_dir = os.path.dirname(os.path.abspath(__file__))
frontend_dir = os.path.abspath(os.path.join(backend_dir, '..', 'frontend'))

# Only set static folder if frontend exists, otherwise serve API only
if os.path.exists(frontend_dir):
    app = Flask(__name__, static_folder=frontend_dir, static_url_path='')
else:
    app = Flask(__name__)
app.config.from_object(Config)

os.makedirs(os.path.join(os.path.dirname(__file__), 'instance'), exist_ok=True)

CORS(app, supports_credentials=True, origins="*")
init_db(app)

# Auto-create new tables if they don't exist yet (safe for existing DBs)
def ensure_new_tables():
    try:
        with app.app_context():
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                token VARCHAR(128) NOT NULL UNIQUE,
                expires_at DATETIME NOT NULL,
                used TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )""")
            cursor.execute("""CREATE TABLE IF NOT EXISTS notifications (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                type VARCHAR(50) NOT NULL,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                data JSON,
                is_read TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )""")
            cursor.execute("""CREATE TABLE IF NOT EXISTS confirmation_disputes (
                id INT PRIMARY KEY AUTO_INCREMENT,
                session_id INT NOT NULL,
                reporter_id INT NOT NULL,
                dispute_type VARCHAR(50) NOT NULL,
                description TEXT,
                status ENUM('open','investigating','resolved') DEFAULT 'open',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""")
            # Add new course planning columns (safe — ignore if already exist)
            try:
                cursor.execute("ALTER TABLE skills ADD COLUMN total_planned_sessions INT DEFAULT 1")
            except Exception: pass
            try:
                cursor.execute("ALTER TABLE skills ADD COLUMN course_duration_days INT DEFAULT 30")
            except Exception: pass
            try:
                cursor.execute("ALTER TABLE sessions ADD COLUMN session_number INT DEFAULT 1")
            except Exception: pass
            conn.commit()
            cursor.close()
            close_db()
            logger.info("✅ All required tables verified/created")
    except Exception as e:
        logger.error(f"Table creation error: {e}")

ensure_new_tables()

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    ping_timeout=60,
    ping_interval=25,
    logger=False,
    engineio_logger=False,
    transports=['websocket','polling']
)

@app.teardown_appcontext
def teardown_db(exception):
    close_db(exception)

# ─────────────────────────── HELPERS ────────────────────────────────────────

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'error': 'Token is missing'}), 401
        try:
            token = token.split(' ')[1]
            data = jwt.decode(token, app.config['JWT_SECRET_KEY'], algorithms=['HS256'])
            current_user = User.find_by_id(data['user_id'])
            if not current_user:
                return jsonify({'error': 'User not found'}), 401
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Token is invalid'}), 401
        return f(current_user, *args, **kwargs)
    return decorated


def send_reset_email(to_email, reset_token, username):
    """Send password reset email. In dev mode, writes link directly to terminal."""
    reset_link = f"http://localhost:5000/pages/reset-password.html?token={reset_token}"

    smtp_host = os.environ.get('SMTP_HOST', '')
    smtp_user = os.environ.get('SMTP_USER', '')
    smtp_pass = os.environ.get('SMTP_PASS', '')

    if smtp_host and smtp_user and smtp_pass:
        try:
            msg = MIMEMultipart()
            msg['From'] = smtp_user
            msg['To'] = to_email
            msg['Subject'] = 'LearnSwap - Reset Your Password'
            body = f"Hi {username},\n\nReset your password here (valid 1 hour):\n{reset_link}\n\n— LearnSwap"
            msg.attach(MIMEText(body, 'plain'))
            with smtplib.SMTP_SSL(smtp_host, 465) as server:
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
        except Exception as e:
            sys.stderr.write(f"SMTP error: {e}\n")
    else:
        # Force write directly to terminal — bypasses logging and buffering
        line = "=" * 65
        msg = (
            f"\n{line}\n"
            f"PASSWORD RESET LINK\n"
            f"{line}\n"
            f"User  : {username} <{to_email}>\n"
            f"Link  : {reset_link}\n"
            f"{line}\n"
            f"Open the link above in your browser to reset the password.\n"
            f"{line}\n\n"
        )
        sys.stdout.write(msg)
        sys.stdout.flush()
        sys.stderr.write(msg)
        sys.stderr.flush()


def create_notification(user_id, notif_type, title, message, data=None):
    """Store a notification in DB and push via SocketIO if connected."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO notifications (user_id, type, title, message, data, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (user_id, notif_type, title, message,
             json.dumps(data) if data else None, datetime.now())
        )
        conn.commit()
        notif_id = cursor.lastrowid
        cursor.close()

        try:
            socketio.emit('new_notification', {
                'id': notif_id, 'type': notif_type,
                'title': title, 'message': message, 'data': data,
                'created_at': datetime.now().isoformat()
            }, room=f"user_{user_id}")
        except Exception:
            pass

        return notif_id
    except Exception as e:
        logger.error(f"create_notification error: {e}")
        return None


def flag_dispute(session_id, reporter_id, dispute_type, description):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO confirmation_disputes "
            "(session_id, reporter_id, dispute_type, description, created_at) "
            "VALUES (%s, %s, %s, %s, %s)",
            (session_id, reporter_id, dispute_type, description, datetime.now())
        )
        conn.commit()
        cursor.close()
        logger.warning(f"[DISPUTE] session={session_id} type={dispute_type}")
    except Exception as e:
        logger.error(f"flag_dispute error: {e}")

# ─────────────────────────── STATIC / FRONTEND ──────────────────────────────

@app.route('/')
def serve_index():
    try:
        return send_from_directory(frontend_dir, 'index.html')
    except Exception as e:
        logger.error(f"Error serving index: {e}")
        return jsonify({'error': 'Frontend not available'}), 404

@app.route('/<path:path>')
def serve_frontend(path):
    try:
        full = os.path.join(frontend_dir, path)
        if os.path.exists(full) and os.path.isfile(full):
            return send_from_directory(frontend_dir, path)
        # For SPA routing, serve index.html for non-API routes
        if path and not path.startswith('api/'):
            return send_from_directory(frontend_dir, 'index.html')
        return jsonify({'error': 'Not found'}), 404
    except Exception as e:
        logger.error(f"Error serving {path}: {e}")
        return jsonify({'error': 'Frontend not available'}), 404

# ─────────────────────────── HEALTH ─────────────────────────────────────────

@app.route('/api/health', methods=['GET'])
def health_check():
    try:
        conn = get_db()
        with conn.cursor() as c:
            c.execute("SELECT 1")
        db_status = "connected"
    except Exception as e:
        db_status = f"disconnected: {e}"
    return jsonify({'status': 'healthy', 'database': db_status,
                    'timestamp': datetime.now(timezone.utc).isoformat()})

# ─────────────────────────── AUTH ───────────────────────────────────────────

@app.route('/api/register', methods=['POST'])
def register():
    try:
        data = request.json
        if not all(k in data for k in ['username', 'email', 'password']):
            return jsonify({'error': 'Missing required fields'}), 400
        if User.find_by_email(data['email']):
            return jsonify({'error': 'Email already registered'}), 400
        user_id = User.create(
            username=data['username'], email=data['email'],
            password=data['password'], role=data.get('role', 'both')
        )
        return jsonify({'success': True, 'userId': user_id,
                        'message': 'Registration successful! Please login.'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/login', methods=['POST'])
def login():
    try:
        data = request.json
        user = User.find_by_email(data['email'])
        if not user:
            return jsonify({'error': 'Invalid credentials'}), 401
        if not bcrypt.checkpw(data['password'].encode('utf-8'),
                               user['password'].encode('utf-8')):
            return jsonify({'error': 'Invalid credentials'}), 401
        token = jwt.encode({
            'user_id': user['id'], 'username': user['username'],
            'exp': datetime.now(timezone.utc) + timedelta(hours=24)
        }, app.config['JWT_SECRET_KEY'])
        return jsonify({
            'success': True, 'token': token,
            'user': {
                'id': user['id'], 'username': user['username'],
                'email': user['email'], 'credits': user.get('credits', 100),
                'role': user.get('role', 'both'),
                'rating': float(user.get('rating', 0))
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─────────────────────────── FORGOT / RESET PASSWORD ────────────────────────

@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    try:
        data = request.json or {}
        email = data.get('email', '').strip().lower()
        if not email:
            return jsonify({'error': 'Email is required'}), 400

        user = User.find_by_email(email)
        # Always return success to prevent user enumeration
        if not user:
            return jsonify({'success': True,
                            'message': 'If that email exists, a reset link has been sent.'})

        conn = get_db()
        cursor = conn.cursor()

        # Expire any existing unused tokens for this user
        cursor.execute(
            "UPDATE password_reset_tokens SET used = TRUE "
            "WHERE user_id = %s AND used = FALSE", (user['id'],)
        )
        conn.commit()

        # Create new token valid for 1 hour
        reset_token = secrets.token_urlsafe(48)
        expires_at = datetime.now() + timedelta(hours=1)
        cursor.execute(
            "INSERT INTO password_reset_tokens (user_id, token, expires_at) "
            "VALUES (%s, %s, %s)",
            (user['id'], reset_token, expires_at)
        )
        conn.commit()
        cursor.close()

        send_reset_email(user['email'], reset_token, user['username'])

        reset_link = f"http://localhost:5000/pages/reset-password.html?token={reset_token}"

        # Return the reset_link in the response so the frontend can open it directly
        # In production with SMTP configured, the link is emailed and not exposed here
        smtp_configured = bool(os.environ.get('SMTP_HOST'))
        return jsonify({
            'success': True,
            'message': 'Reset link generated.',
            # Only expose link when SMTP is not configured (dev mode)
            'reset_link': None if smtp_configured else reset_link
        })
    except Exception as e:
        logger.error(f"forgot_password error: {e}")
        return jsonify({'error': 'Something went wrong. Please try again.'}), 500


@app.route('/api/reset-password', methods=['POST'])
def reset_password():
    try:
        data = request.json or {}
        token = data.get('token', '').strip()
        new_password = data.get('password', '')

        if not token or not new_password:
            return jsonify({'error': 'Token and new password are required'}), 400
        if len(new_password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM password_reset_tokens "
            "WHERE token = %s AND used = FALSE AND expires_at > %s",
            (token, datetime.now())
        )
        record = cursor.fetchone()
        if not record:
            cursor.close()
            return jsonify({'error': 'Invalid or expired reset link. Please request a new one.'}), 400

        hashed = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        cursor.execute("UPDATE users SET password = %s WHERE id = %s",
                       (hashed, record['user_id']))
        cursor.execute("UPDATE password_reset_tokens SET used = TRUE WHERE id = %s",
                       (record['id'],))
        conn.commit()
        cursor.close()

        return jsonify({'success': True,
                        'message': 'Password reset successfully! You can now log in.'})
    except Exception as e:
        logger.error(f"reset_password error: {e}")
        return jsonify({'error': 'Something went wrong. Please try again.'}), 500


@app.route('/api/verify-reset-token', methods=['GET'])
def verify_reset_token():
    token = request.args.get('token', '').strip()
    if not token:
        return jsonify({'valid': False})
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id FROM password_reset_tokens "
        "WHERE token = %s AND used = FALSE AND expires_at > %s",
        (token, datetime.now())
    )
    record = cursor.fetchone()
    cursor.close()
    return jsonify({'valid': bool(record)})

# ─────────────────────────── USER PROFILE ───────────────────────────────────

@app.route('/api/user/profile', methods=['GET'])
@token_required
def get_profile(current_user):
    return jsonify({
        'id': current_user['id'], 'username': current_user['username'],
        'email': current_user['email'], 'credits': current_user.get('credits', 100),
        'rating': float(current_user.get('rating', 0)),
        'role': current_user.get('role', 'both'),
        'total_sessions': current_user.get('total_sessions', 0),
        'bio': current_user.get('bio', '') or '',
        'profile_pic': current_user.get('profile_pic', '') or '',
        'created_at': current_user['created_at'].isoformat() if current_user.get('created_at') else None
    })

@app.route('/api/user/profile/photo', methods=['POST'])
@token_required
def upload_profile_photo(current_user):
    try:
        data = request.json or {}
        photo_data = data.get('photo', '')  # base64 data URL

        if not photo_data:
            return jsonify({'error': 'No photo provided'}), 400

        # Validate it's a base64 image (data:image/...)
        if not photo_data.startswith('data:image/'):
            return jsonify({'error': 'Invalid image format'}), 400

        # Limit size to ~2MB base64 (~1.5MB actual)
        if len(photo_data) > 2 * 1024 * 1024:
            return jsonify({'error': 'Image too large. Please use an image under 1.5MB.'}), 400

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('UPDATE users SET profile_pic = %s WHERE id = %s',
                       (photo_data, current_user['id']))
        conn.commit()
        cursor.close()

        return jsonify({'success': True, 'photo': photo_data})
    except Exception as e:
        logger.error(f"upload_profile_photo error: {e}")
        return jsonify({'error': str(e)}), 500
    try:
        data = request.json or {}
        conn = get_db()
        cursor = conn.cursor()

        fields = []
        values = []

        if 'bio' in data:
            fields.append('bio = %s')
            values.append(data['bio'][:500])  # max 500 chars

        if 'username' in data:
            new_username = data['username'].strip()
            if not new_username or len(new_username) < 2:
                return jsonify({'error': 'Username must be at least 2 characters'}), 400
            # Check not taken by someone else
            cursor.execute('SELECT id FROM users WHERE username = %s AND id != %s',
                           (new_username, current_user['id']))
            if cursor.fetchone():
                cursor.close()
                return jsonify({'error': 'Username already taken'}), 400
            fields.append('username = %s')
            values.append(new_username)

        if not fields:
            cursor.close()
            return jsonify({'error': 'Nothing to update'}), 400

        values.append(current_user['id'])
        cursor.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = %s", values)
        conn.commit()
        cursor.close()

        # Return updated profile
        updated = User.find_by_id(current_user['id'])
        return jsonify({
            'success': True,
            'user': {
                'id': updated['id'], 'username': updated['username'],
                'email': updated['email'], 'credits': updated.get('credits', 100),
                'rating': float(updated.get('rating', 0)),
                'role': updated.get('role', 'both'),
                'total_sessions': updated.get('total_sessions', 0),
                'bio': updated.get('bio', '') or '',
            }
        })
    except Exception as e:
        logger.error(f"update_profile error: {e}")
        return jsonify({'error': str(e)}), 500

# ─────────────────────────── SKILLS ─────────────────────────────────────────

@app.route('/api/skills', methods=['GET'])
@token_required
def get_skills(current_user):
    try:
        filters = {}
        cat = request.args.get('category')
        lvl = request.args.get('level')
        srch = request.args.get('search', '')
        if cat:   filters['category'] = cat
        if lvl:   filters['level'] = lvl
        if srch:  filters['search'] = srch
        return jsonify({'skills': Skill.find_active(filters)})
    except Exception as e:
        return jsonify({'error': str(e), 'skills': []}), 500


@app.route('/api/skills', methods=['POST'])
@token_required
def add_skill(current_user):
    try:
        data = request.json
        skill_id = Skill.create(
            user_id=current_user['id'], name=data['name'],
            category=data['category'], level=data['level'],
            description=data.get('description', ''),
            tags=','.join(data.get('tags', [])),
            credits_per_hour=data['creditsPerHour'],
            total_planned_sessions=data.get('totalPlannedSessions', 1),
            course_duration_days=data.get('courseDurationDays', 30)
        )
        return jsonify({'success': True, 'skillId': skill_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/skills/my-skills', methods=['GET'])
@token_required
def get_my_skills(current_user):
    try:
        return jsonify({'skills': Skill.find_by_user(current_user['id'])})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/skills/<int:skill_id>', methods=['GET'])
@token_required
def get_skill(current_user, skill_id):
    try:
        skill = Skill.find_by_id(skill_id)
        return jsonify({'skill': skill}) if skill else (jsonify({'error': 'Skill not found'}), 404)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─────────────────────────── SESSIONS ───────────────────────────────────────

@app.route('/api/sessions/request', methods=['POST'])
@token_required
def request_session(current_user):
    try:
        data = request.json
        skill = Skill.find_by_id(data['skillId'])
        if not skill:
            return jsonify({'error': 'Skill not found'}), 404

        credits_needed = CreditSystem.calculate_credits(skill['level'], data['duration'])

        # Only CHECK the balance — do NOT deduct yet.
        # Credits move only when both parties confirm completion.
        if current_user['credits'] < credits_needed:
            return jsonify({'error': f'Insufficient credits. You need {credits_needed} credits but have {current_user["credits"]}.'}), 400

        # Normalise datetime string to MySQL format
        scheduled_time = data['scheduledTime']
        if 'T' in scheduled_time:
            scheduled_time = scheduled_time.replace('T', ' ').replace('Z', '').split('.')[0]
        if len(scheduled_time) == 16:
            scheduled_time += ':00'

        session_id = Session.create(
            learner_id=current_user['id'],
            teacher_id=skill['user_id'],
            skill_id=data['skillId'],
            scheduled_time=scheduled_time,
            duration=data['duration']
        )
        Session.update(session_id, credits_allocated=credits_needed)

        # Notify teacher
        create_notification(
            user_id=skill['user_id'],
            notif_type='session_requested',
            title='New Session Request 📚',
            message=f"{current_user['username']} wants to learn \"{skill['name']}\". "
                    f"Check your sessions to accept or decline.",
            data={'session_id': session_id}
        )

        return jsonify({'success': True, 'sessionId': session_id,
                        'creditsAllocated': credits_needed,
                        'message': f'{credits_needed} credits will be charged only after both parties confirm session completion.'})
    except Exception as e:
        logger.error(f"request_session error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>/accept', methods=['PUT'])
@token_required
def accept_session(current_user, session_id):
    session = Session.find_by_id(session_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404
    if session['teacher_id'] != current_user['id']:
        return jsonify({'error': 'Unauthorized'}), 403
    if session['status'] != 'pending':
        return jsonify({'error': 'Session is not pending'}), 400

    Session.update(session_id, status='accepted')

    # Notify learner
    create_notification(
        user_id=session['learner_id'],
        notif_type='session_accepted',
        title='Session Accepted! 🎉',
        message=f"{current_user['username']} accepted your session for \"{session['skill_name']}\". "
                f"You're scheduled for {session.get('scheduled_time', 'your chosen time')}.",
        data={'session_id': session_id, 'teacher_name': current_user['username']}
    )

    return jsonify({'success': True, 'message': 'Session accepted. Learner has been notified.'})


@app.route('/api/sessions/<int:session_id>/start', methods=['PUT'])
@token_required
def start_session(current_user, session_id):
    session = Session.find_by_id(session_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404
    if current_user['id'] not in [session['teacher_id'], session['learner_id']]:
        return jsonify({'error': 'Unauthorized'}), 403
    Session.update(session_id, status='ongoing', start_time=datetime.now())
    return jsonify({'success': True})


@app.route('/api/sessions/<int:session_id>/confirm', methods=['PUT'])
@token_required
def confirm_session(current_user, session_id):
    """
    Credits are transferred ONLY when BOTH teacher AND learner confirm.
    Calling this endpoint records one party's confirmation.
    When the second party calls it, credits are transferred and session is marked complete.
    """
    session = Session.find_by_id(session_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404

    user_id = current_user['id']
    is_teacher = (user_id == session['teacher_id'])
    is_learner = (user_id == session['learner_id'])

    if not is_teacher and not is_learner:
        return jsonify({'error': 'Unauthorized'}), 403

    if session['status'] not in ('ongoing', 'accepted'):
        return jsonify({'error': f"Cannot confirm a session with status '{session['status']}'"}), 400

    # Prevent double-confirming
    if is_teacher and session.get('teacher_confirmed'):
        return jsonify({'error': 'You have already confirmed this session'}), 400
    if is_learner and session.get('learner_confirmed'):
        return jsonify({'error': 'You have already confirmed this session'}), 400

    # Must be started before confirming
    if not session.get('start_time'):
        flag_dispute(session_id, user_id, 'confirm_without_start',
                     f"User {user_id} tried to confirm session that was never started.")
        return jsonify({'error': 'Session has not been started yet. Please start it first.'}), 400

    # Record this party's confirmation
    if is_teacher:
        Session.update(session_id, teacher_confirmed=True)
        other_confirmed = bool(int(session.get('learner_confirmed') or 0))
        create_notification(
            user_id=session['learner_id'],
            notif_type='session_teacher_confirmed',
            title='Teacher Confirmed ✅',
            message=f"{current_user['username']} marked the session as complete. "
                    f"Please confirm on your end to release the credits.",
            data={'session_id': session_id}
        )
    else:
        Session.update(session_id, learner_confirmed=True)
        other_confirmed = bool(int(session.get('teacher_confirmed') or 0))
        create_notification(
            user_id=session['teacher_id'],
            notif_type='session_learner_confirmed',
            title='Learner Confirmed ✅',
            message=f"{current_user['username']} confirmed the session is complete. "
                    f"Please confirm on your end to release the credits.",
            data={'session_id': session_id}
        )

    # ── BOTH confirmed → transfer credits now ────────────────────────────────
    if other_confirmed:
        Session.update(session_id, end_time=datetime.now())
        result = CreditSystem.transfer_credits(session_id)

        if result['success']:
            create_notification(
                user_id=session['teacher_id'],
                notif_type='credits_received',
                title='Credits Received 💰',
                message=f"You earned {result['amount']} credits for teaching \"{session['skill_name']}\"!",
                data={'session_id': session_id, 'amount': result['amount']}
            )
            create_notification(
                user_id=session['learner_id'],
                notif_type='session_completed',
                title='Session Complete 🎓',
                message=f"Session complete! {result['amount']} credits transferred to {session['teacher_name']}.",
                data={'session_id': session_id, 'amount': result['amount']}
            )
            return jsonify({
                'success': True, 'bothConfirmed': True,
                'message': f"Session complete! {result['amount']} credits transferred to the teacher.",
                'creditsTransferred': result['amount']
            })
        else:
            return jsonify({'error': result.get('error', 'Credit transfer failed')}), 500

    return jsonify({
        'success': True, 'bothConfirmed': False,
        'message': 'Your confirmation recorded. Credits will be transferred once the other party also confirms.'
    })


@app.route('/api/sessions/<int:session_id>/cancel', methods=['PUT'])
@token_required
def cancel_session(current_user, session_id):
    data = request.json or {}
    result = CreditSystem.handle_cancellation(session_id, current_user['id'],
                                               data.get('reason', 'No reason provided'))
    return jsonify(result)


@app.route('/api/sessions/my-sessions', methods=['GET'])
@token_required
def get_my_sessions(current_user):
    sessions = Session.find_by_user(current_user['id'])
    return jsonify({'sessions': sessions})


@app.route('/api/sessions/<int:session_id>/dispute', methods=['POST'])
@token_required
def report_dispute(current_user, session_id):
    data = request.json or {}
    session = Session.find_by_id(session_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404
    if current_user['id'] not in [session['teacher_id'], session['learner_id']]:
        return jsonify({'error': 'Unauthorized'}), 403
    flag_dispute(session_id, current_user['id'],
                 data.get('type', 'wrong_confirmation'),
                 data.get('description', 'User reported an issue.'))
    return jsonify({'success': True,
                    'message': 'Dispute recorded. Our team will review it shortly.'})

# ─────────────────────────── MESSAGES ───────────────────────────────────────

@app.route('/api/messages/<int:session_id>', methods=['GET'])
@token_required
def get_messages(current_user, session_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM sessions WHERE id = %s AND (teacher_id = %s OR learner_id = %s)",
            (session_id, current_user['id'], current_user['id'])
        )
        if not cursor.fetchone():
            cursor.close()
            return jsonify({'error': 'Unauthorized'}), 403
        cursor.execute(
            "SELECT m.*, u.username as sender_name FROM messages m "
            "JOIN users u ON m.sender_id = u.id "
            "WHERE m.session_id = %s ORDER BY m.created_at ASC", (session_id,)
        )
        messages = cursor.fetchall()
        cursor.close()
        return jsonify({'messages': messages})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/messages', methods=['POST'])
@token_required
def send_message(current_user):
    try:
        data = request.json
        session_id = data.get('sessionId')
        content = data.get('content')
        if not session_id or not content:
            return jsonify({'error': 'Missing required fields'}), 400
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM sessions WHERE id = %s AND (teacher_id = %s OR learner_id = %s)",
            (session_id, current_user['id'], current_user['id'])
        )
        if not cursor.fetchone():
            cursor.close()
            return jsonify({'error': 'Unauthorized'}), 403
        cursor.execute(
            "INSERT INTO messages (session_id, sender_id, content, created_at) VALUES (%s, %s, %s, %s)",
            (session_id, current_user['id'], content, datetime.now())
        )
        conn.commit()
        cursor.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─────────────────────────── NOTIFICATIONS ──────────────────────────────────

@app.route('/api/notifications', methods=['GET'])
@token_required
def get_notifications(current_user):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM notifications WHERE user_id = %s ORDER BY created_at DESC LIMIT 50",
            (current_user['id'],)
        )
        notifications = cursor.fetchall()
        cursor.close()

        # Normalise is_read to Python bool (MySQL returns 0/1)
        for n in notifications:
            n['is_read'] = bool(int(n.get('is_read') or 0))

        unread = sum(1 for n in notifications if not n['is_read'])
        return jsonify({'notifications': notifications, 'unread_count': unread})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/notifications/read-all', methods=['PUT'])
@token_required
def mark_all_read(current_user):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE notifications SET is_read = TRUE WHERE user_id = %s AND is_read = FALSE",
            (current_user['id'],)
        )
        conn.commit()
        cursor.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/notifications/<int:notif_id>/read', methods=['PUT'])
@token_required
def mark_one_read(current_user, notif_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE notifications SET is_read = TRUE WHERE id = %s AND user_id = %s",
            (notif_id, current_user['id'])
        )
        conn.commit()
        cursor.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─────────────────────────── REVIEWS / TRANSACTIONS ─────────────────────────

@app.route('/api/reviews', methods=['POST'])
@token_required
def create_review(current_user):
    try:
        data = request.json
        review_id = Review.create(
            session_id=data['sessionId'], reviewer_id=current_user['id'],
            reviewee_id=data['revieweeId'], rating=data['rating'],
            comment=data.get('comment', '')
        )
        User.update_rating(data['revieweeId'], data['rating'])
        return jsonify({'success': True, 'reviewId': review_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/reviews/user/<int:user_id>', methods=['GET'])
@token_required
def get_user_reviews(current_user, user_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT r.*, u.username as reviewer_name FROM reviews r "
            "JOIN users u ON r.reviewer_id = u.id "
            "WHERE r.reviewee_id = %s ORDER BY r.created_at DESC", (user_id,)
        )
        reviews = cursor.fetchall()
        cursor.close()
        return jsonify({'reviews': reviews})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/transactions', methods=['GET'])
@token_required
def get_transactions(current_user):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM transactions WHERE user_id = %s ORDER BY created_at DESC",
            (current_user['id'],)
        )
        transactions = cursor.fetchall()
        cursor.close()
        return jsonify({'transactions': transactions})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─────────────────────────── SOCKET.IO ──────────────────────────────────────

@socketio.on('connect')
def on_connect():
    logger.info(f'WS connected: {request.sid}')

@socketio.on('disconnect')
def on_disconnect(reason=None):
    logger.info(f'WS disconnected: {request.sid}')

@socketio.on('join_user_room')
def on_join_user_room(data):
    """Each logged-in user joins their own room so we can push notifications."""
    user_id = data.get('userId')
    if user_id:
        join_room(f"user_{user_id}")

@socketio.on('join_session')
def on_join_session(data):
    session_id = data.get('sessionId')
    if session_id:
        join_room(f"session_{session_id}")

@socketio.on('leave_session')
def on_leave_session(data):
    session_id = data.get('sessionId')
    if session_id:
        leave_room(f"session_{session_id}")

@socketio.on('send_message')
def on_send_message(data):
    try:
        session_id = data.get('sessionId')
        sender_id  = data.get('senderId')
        content    = data.get('content')
        if not all([session_id, sender_id, content]):
            return
        msg_id = Message.create(session_id=session_id, sender_id=sender_id, content=content)
        sender = User.find_by_id(sender_id)
        emit('receive_message', {
            'id': msg_id, 'senderId': sender_id,
            'senderName': sender['username'] if sender else 'Unknown',
            'content': content,
            'timestamp': datetime.now(timezone.utc).isoformat()
        }, room=f"session_{session_id}")
    except Exception as e:
        logger.error(f"send_message WS error: {e}")

@socketio.on('typing')
def on_typing(data):
    session_id = data.get('sessionId')
    if session_id:
        emit('user_typing', {'userId': data.get('userId'), 'isTyping': data.get('isTyping')},
             room=f"session_{session_id}", include_self=False)

# ─────────────────────────── MAIN ───────────────────────────────────────────

if __name__ == '__main__':
    print("="*65)
    print("LearnSwap Backend")
    print("="*65)
    print(f"   URL    : http://localhost:5000")
    print(f"   Health : http://localhost:5000/api/health")
    print(f"   Python : {sys.version.split()[0]}")
    print("\n   FORGOT PASSWORD: reset link will appear HERE in this terminal.")
    print("="*65)
    socketio.run(app, debug=False, port=5000)
