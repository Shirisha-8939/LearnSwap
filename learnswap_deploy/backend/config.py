import os
from datetime import timedelta

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'learnswap-secret-key-2024')
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'learnswap-jwt-secret-key-2024')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=24)

    # MySQL Configuration — reads from environment variables on Render
    MYSQL_HOST = os.environ.get('MYSQL_HOST', 'localhost')
    MYSQL_USER = os.environ.get('MYSQL_USER', 'root')
    MYSQL_PASSWORD = os.environ.get('MYSQL_PASSWORD', '3889')
    MYSQL_DB = os.environ.get('MYSQL_DB', 'learnswap')
    MYSQL_PORT = int(os.environ.get('MYSQL_PORT', 3306))
