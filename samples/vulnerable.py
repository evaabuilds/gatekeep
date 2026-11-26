# Intentionally INSECURE example code for testing GateKeep. Do not use in real projects.
import hashlib
import os
import pickle
import sqlite3
import subprocess

API_KEY = "sk_live_1234567890abcdef"  # hardcoded secret


def get_user(username):
    conn = sqlite3.connect("app.db")
    cur = conn.cursor()
    # SQL injection: user input pasted straight into the query
    cur.execute("SELECT * FROM users WHERE name = '%s'" % username)
    return cur.fetchone()


def ping(host):
    # Command injection: shell=True with user input
    return subprocess.call("ping -c 1 " + host, shell=True)


def load_session(data):
    # Unsafe deserialization
    return pickle.loads(data)


def hash_password(password):
    # Weak hash for passwords
    return hashlib.md5(password.encode()).hexdigest()


def calculate(expr):
    # Arbitrary code execution
    return eval(expr)


def withdraw(balance, amount):
    # Logic bug (Semgrep can't see this): no check for negative amount or overdraft
    return balance - amount


def delete_file(name):
    os.system("rm " + name)
