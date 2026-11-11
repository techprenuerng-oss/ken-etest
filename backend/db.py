"""Ken E-Test - backend/db.py
One database connection per request (PyMySQL). Every query uses placeholders (%s), so
user input can never change the meaning of a query (no SQL injection)."""
import pymysql
import pymysql.cursors
from flask import g

from . import config


def get_conn():
    if "db" not in g:
        g.db = pymysql.connect(
            host=config.DB_HOST, port=config.DB_PORT, user=config.DB_USER,
            password=config.DB_PASS, database=config.DB_NAME, charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor, autocommit=True,
        )
        with g.db.cursor() as cur:
            cur.execute("SET time_zone = '+00:00'")   # all dates are stored in UTC
    return g.db


def close_conn(exception=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def run(sql, params=()):
    """Runs a statement that changes data."""
    with get_conn().cursor() as cur:
        cur.execute(sql, params)
        return cur.rowcount


def fetch_all(sql, params=()):
    with get_conn().cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def fetch_one(sql, params=()):
    """Returns the first row, or None when there is none."""
    with get_conn().cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def generate_id(counter, prefix, digits):
    """Creates the next readable ID, for example STU006 (counter "student", prefix "STU").
    The counter row is updated in one atomic statement, so two requests never get the same ID."""
    run(
        "INSERT INTO counters (name, value) VALUES (%s, LAST_INSERT_ID(1)) "
        "ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)",
        (counter,),
    )
    number = int(fetch_one("SELECT LAST_INSERT_ID() AS n")["n"])
    return prefix + str(number).zfill(digits)


def is_duplicate_key(exc):
    """True when the error was caused by a duplicate key (UNIQUE or PRIMARY KEY)."""
    return isinstance(exc, pymysql.err.IntegrityError) and exc.args and exc.args[0] == 1062
