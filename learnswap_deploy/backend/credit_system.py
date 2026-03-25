from models import Session, Skill, User, Transaction
from datetime import datetime

class CreditSystem:
    @staticmethod
    def calculate_credits(skill_level, duration):
        base_rates = {
            'Beginner': 10,
            'Intermediate': 20,
            'Advanced': 30
        }
        return base_rates.get(skill_level, 10) * duration
    
    @staticmethod
    def transfer_credits(session_id):
        session = Session.find_by_id(session_id)
        
        if not session:
            return {'success': False, 'error': 'Session not found'}

        # Prevent double transfer
        if session.get('credits_transferred') and session['credits_transferred'] > 0:
            return {'success': False, 'error': 'Credits already transferred for this session'}
        
        skill = Skill.find_by_id(session['skill_id'])
        if not skill:
            return {'success': False, 'error': 'Skill not found'}
        
        credits_amount = session.get('credits_allocated') or CreditSystem.calculate_credits(
            skill['level'], 
            session['duration']
        )
        
        # Check learner has enough credits RIGHT NOW (nothing was taken at booking)
        learner = User.find_by_id(session['learner_id'])
        if learner['credits'] < credits_amount:
            return {'success': False, 'error': f'Learner has insufficient credits ({learner["credits"]} available, {credits_amount} needed)'}
        
        # Deduct from learner, credit teacher — single atomic operation
        User.update_credits(session['learner_id'], -credits_amount)
        User.update_credits(session['teacher_id'], credits_amount)
        
        Session.update(session_id, 
            credits_transferred=credits_amount,
            status='completed'
        )
        
        Transaction.create(
            session['learner_id'], 
            'spent', 
            credits_amount, 
            session_id,
            f"Paid for completed session: {skill['name']}"
        )
        
        Transaction.create(
            session['teacher_id'], 
            'earned', 
            credits_amount, 
            session_id,
            f"Earned from teaching: {skill['name']}"
        )
        
        return {'success': True, 'amount': credits_amount}
    
    @staticmethod
    def handle_cancellation(session_id, cancelled_by, reason):
        session = Session.find_by_id(session_id)
        
        if not session:
            return {'success': False, 'error': 'Session not found'}

        # Credits are NEVER pre-deducted at booking time.
        # They only move when both parties confirm completion.
        # So cancellation never touches any credits — just update status.
        Session.update(session_id, 
            status='cancelled',
            cancelled_by=cancelled_by,
            cancellation_reason=reason
        )
        
        return {'success': True, 'message': 'Session cancelled. No credits were charged.'}