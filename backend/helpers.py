"""Ken E-Test - backend/helpers.py
Small shared functions: response format, text cleaning, dates, shuffling."""
import math
import re
import secrets
import time
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP


def ok(message="OK", data=None):
    """Every reply has the same shape: { success, message, code, data }
    (the format the website's js/api.js has always used)."""
    return {"success": True, "message": message, "code": "OK", "data": data}


def fail(message, code="ERROR", data=None):
    return {"success": False, "message": message, "code": code, "data": data}


def auth_required():
    return fail("Your session has expired. Please log in again.", "AUTH_REQUIRED")


def req(data, key):
    """Reads one value from the request, or None."""
    return data.get(key) if isinstance(data, dict) else None


def is_scalar(value):
    return isinstance(value, (str, int, float)) and not isinstance(value, bool)


def clean_text(value, max_length):
    """Trims text, replaces control characters and limits the length."""
    if not is_scalar(value):
        return ""
    text = re.sub(r"[\x00-\x1f\x7f]", " ", str(value)).strip()
    return text[:max_length]


def text_length(text):
    return len(text)


def is_valid_email(email):
    return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email)) and len(email) <= 120


def to_number(value):
    """A number from a number or numeric string, or None (rejects True/False, 'abc', NaN)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        try:
            number = float(value.strip())
        except ValueError:
            return None
    else:
        return None
    return number if math.isfinite(number) else None


def whole_number(value, minimum, maximum):
    """A whole number inside a range, or None. Accepts 5 and "5", rejects 5.5, "abc", True."""
    number = to_number(value)
    if number is None or number != math.floor(number):
        return None
    number = int(number)
    return None if number < minimum or number > maximum else number


def is_active_status(status):
    return str(status).lower() == "active"


# ---------- dates: stored in UTC, sent to the browser as ISO 8601 ----------

def now_utc():
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def to_iso(date):
    return None if date is None else date.strftime("%Y-%m-%dT%H:%M:%SZ")


def utc_timestamp(date):
    return date.replace(tzinfo=timezone.utc).timestamp()


def utc_now_seconds():
    return time.time()


# ---------- random order ----------

_random = secrets.SystemRandom()


def secure_shuffle(items):
    """Fisher-Yates shuffle using a cryptographically secure random generator."""
    items = list(items)
    for i in range(len(items) - 1, 0, -1):
        j = _random.randint(0, i)
        items[i], items[j] = items[j], items[i]
    return items


def round_half_up(number, digits):
    """Rounds .5 upwards (Python's round() rounds .5 to the nearest even number)."""
    quantum = Decimal(1).scaleb(-digits)
    return float(Decimal(str(number)).quantize(quantum, rounding=ROUND_HALF_UP))
