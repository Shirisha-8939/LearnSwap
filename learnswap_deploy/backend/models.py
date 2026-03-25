from database import get_db
import bcrypt
from datetime import datetime

class User:
    @staticmethod
    def create(username, email, password, role='both'):
        conn = get_db()
        cursor = conn.cursor()
        
        hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
        
        cursor.execute("""
            INSERT INTO users (username, email, password, role, credits, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (username, email, hashed.decode('utf-8'), role, 100, datetime.now()))
        
        conn.commit()
        user_id = cursor.lastrowid
        cursor.close()
        
        return user_id
    
    @staticmethod
    def find_by_email(email):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM users WHERE LOWER(email) = LOWER(%s)", (email,))
        user = cursor.fetchone()
        cursor.close()
        
        return user
    
    @staticmethod
    def find_by_id(user_id):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone()
        cursor.close()
        
        return user
    
    @staticmethod
    def update_credits(user_id, amount):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE users 
            SET credits = credits + %s 
            WHERE id = %s
        """, (amount, user_id))
        
        conn.commit()
        cursor.close()
        
        return True
    
    @staticmethod
    def update_rating(user_id, new_rating):
        conn = get_db()
        cursor = conn.cursor()
        
        user = User.find_by_id(user_id)
        total_sessions = user['total_sessions'] + 1
        current_rating = user['rating']
        
        new_avg = (current_rating * user['total_sessions'] + new_rating) / total_sessions if total_sessions > 0 else new_rating
        
        cursor.execute("""
            UPDATE users 
            SET total_sessions = %s,
                rating = %s
            WHERE id = %s
        """, (total_sessions, new_avg, user_id))
        
        conn.commit()
        cursor.close()
        
        return True

class Skill:
    @staticmethod
    def create(user_id, name, category, level, description, tags, credits_per_hour,
               total_planned_sessions=1, course_duration_days=30):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO skills (user_id, name, category, level, description, tags,
                                credits_per_hour, total_planned_sessions, course_duration_days, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (user_id, name, category, level, description, tags,
              credits_per_hour, total_planned_sessions, course_duration_days, datetime.now()))
        
        conn.commit()
        skill_id = cursor.lastrowid
        cursor.close()
        
        return skill_id
    
    @staticmethod
    def find_active(filters=None):
        conn = get_db()
        cursor = conn.cursor()
        
        query = """
            SELECT s.*, u.username as teacher_name, u.rating as teacher_rating,
                   COALESCE(s.total_planned_sessions, 1) as total_planned_sessions,
                   COALESCE(s.course_duration_days, 30) as course_duration_days
            FROM skills s
            JOIN users u ON s.user_id = u.id
            WHERE s.is_active = TRUE
        """
        params = []
        
        if filters:
            if filters.get('category'):
                query += " AND s.category = %s"
                params.append(filters['category'])
            
            if filters.get('level'):
                query += " AND s.level = %s"
                params.append(filters['level'])
            
            if filters.get('search'):
                query += """ AND (s.name LIKE %s OR s.description LIKE %s OR s.tags LIKE %s)"""
                search_term = f"%{filters['search']}%"
                params.extend([search_term, search_term, search_term])
        
        query += " ORDER BY s.created_at DESC"
        
        cursor.execute(query, params)
        skills = cursor.fetchall()
        cursor.close()
        
        return skills
    
    @staticmethod
    def find_by_id(skill_id):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT s.*, u.username as teacher_name, u.rating as teacher_rating,
                   COALESCE(s.total_planned_sessions, 1) as total_planned_sessions,
                   COALESCE(s.course_duration_days, 30) as course_duration_days
            FROM skills s
            JOIN users u ON s.user_id = u.id
            WHERE s.id = %s
        """, (skill_id,))
        
        skill = cursor.fetchone()
        cursor.close()
        
        return skill
    
    @staticmethod
    def find_by_user(user_id):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM skills 
            WHERE user_id = %s AND is_active = TRUE
            ORDER BY created_at DESC
        """, (user_id,))
        
        skills = cursor.fetchall()
        cursor.close()
        
        return skills

class Session:
    @staticmethod
    def create(learner_id, teacher_id, skill_id, scheduled_time, duration):
        conn = get_db()
        cursor = conn.cursor()
        
        # FIX: Ensure scheduled_time is in correct MySQL format
        if isinstance(scheduled_time, str):
            # Remove any milliseconds if present
            if '.' in scheduled_time:
                scheduled_time = scheduled_time.split('.')[0]
        
        cursor.execute("""
            INSERT INTO sessions (learner_id, teacher_id, skill_id, scheduled_time, duration, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (learner_id, teacher_id, skill_id, scheduled_time, duration, datetime.now()))
        
        conn.commit()
        session_id = cursor.lastrowid
        cursor.close()
        
        return session_id
    
    @staticmethod
    def find_by_user(user_id):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT s.*, 
                   sk.name as skill_name, sk.level as skill_level,
                   COALESCE(sk.total_planned_sessions, 1) as total_planned_sessions,
                   t.username as teacher_name,
                   l.username as learner_name,
                   (SELECT COUNT(*) FROM sessions s2 
                    WHERE s2.skill_id = s.skill_id 
                    AND s2.learner_id = s.learner_id
                    AND s2.status = 'completed') as completed_session_count
            FROM sessions s
            JOIN skills sk ON s.skill_id = sk.id
            JOIN users t ON s.teacher_id = t.id
            JOIN users l ON s.learner_id = l.id
            WHERE s.teacher_id = %s OR s.learner_id = %s
            ORDER BY s.created_at DESC
        """, (user_id, user_id))
        
        sessions = cursor.fetchall()
        cursor.close()
        
        return sessions
    
    @staticmethod
    def find_by_id(session_id):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT s.*, 
                   sk.name as skill_name, sk.level as skill_level,
                   sk.credits_per_hour,
                   COALESCE(sk.total_planned_sessions, 1) as total_planned_sessions,
                   t.username as teacher_name,
                   l.username as learner_name
            FROM sessions s
            JOIN skills sk ON s.skill_id = sk.id
            JOIN users t ON s.teacher_id = t.id
            JOIN users l ON s.learner_id = l.id
            WHERE s.id = %s
        """, (session_id,))
        
        session = cursor.fetchone()
        cursor.close()
        
        return session
    
    @staticmethod
    def update(session_id, **kwargs):
        conn = get_db()
        cursor = conn.cursor()
        
        fields = []
        values = []
        
        for key, value in kwargs.items():
            fields.append(f"{key} = %s")
            values.append(value)
        
        values.append(session_id)
        
        query = f"UPDATE sessions SET {', '.join(fields)} WHERE id = %s"
        
        cursor.execute(query, values)
        conn.commit()
        cursor.close()
        
        return True

class Message:
    @staticmethod
    def create(session_id, sender_id, content):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO messages (session_id, sender_id, content, created_at)
            VALUES (%s, %s, %s, %s)
        """, (session_id, sender_id, content, datetime.now()))
        
        conn.commit()
        message_id = cursor.lastrowid
        cursor.close()
        
        return message_id
    
    @staticmethod
    def get_session_messages(session_id):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT m.*, u.username as sender_name
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.session_id = %s
            ORDER BY m.created_at ASC
        """, (session_id,))
        
        messages = cursor.fetchall()
        cursor.close()
        
        return messages

class Review:
    @staticmethod
    def create(session_id, reviewer_id, reviewee_id, rating, comment):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO reviews (session_id, reviewer_id, reviewee_id, rating, comment, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (session_id, reviewer_id, reviewee_id, rating, comment, datetime.now()))
        
        conn.commit()
        review_id = cursor.lastrowid
        cursor.close()
        
        return review_id
    
    @staticmethod
    def get_user_reviews(user_id):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT r.*, u.username as reviewer_name
            FROM reviews r
            JOIN users u ON r.reviewer_id = u.id
            WHERE r.reviewee_id = %s
            ORDER BY r.created_at DESC
        """, (user_id,))
        
        reviews = cursor.fetchall()
        cursor.close()
        
        return reviews

class Transaction:
    @staticmethod
    def create(user_id, type, amount, session_id, description):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO transactions (user_id, type, amount, session_id, description, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (user_id, type, amount, session_id, description, datetime.now()))
        
        conn.commit()
        transaction_id = cursor.lastrowid
        cursor.close()
        
        return transaction_id
    
    @staticmethod
    def get_user_transactions(user_id):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM transactions
            WHERE user_id = %s
            ORDER BY created_at DESC
        """, (user_id,))
        
        transactions = cursor.fetchall()
        cursor.close()
        
        return transactions