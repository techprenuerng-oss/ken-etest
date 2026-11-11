"""Ken E-Test configuration."""
import os
from urllib.parse import unquote, urlparse

def env_or(name, default):
    value = os.environ.get(name)
    return default if value is None or value == "" else value

# EthioDeploy injects its managed MySQL connection as DATABASE_URL.
_database_url = os.environ.get("DATABASE_URL", "")
_url = urlparse(_database_url) if _database_url else None
_url_db = unquote((_url.path or "").lstrip("/")) if _url else "ken_etest"

DB_HOST = env_or("ETEST_DB_HOST", _url.hostname if _url and _url.hostname else "127.0.0.1")
DB_PORT = int(env_or("ETEST_DB_PORT", str(_url.port if _url and _url.port else 3306)))
DB_NAME = env_or("ETEST_DB_NAME", _url_db or "ken_etest")
DB_USER = env_or("ETEST_DB_USER", unquote(_url.username or "root") if _url else "root")
DB_PASS = env_or("ETEST_DB_PASS", unquote(_url.password or "") if _url else "")

SESSION_SECONDS = 21600
SHUFFLE_QUESTIONS = True
SHUFFLE_OPTIONS = True
DEBUG = False
