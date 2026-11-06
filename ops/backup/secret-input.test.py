#!/usr/bin/env python3
"""Проверка скрытого ввода через настоящий терминал. Значения тестовые, ключей не требует.

Запуск на сервере после установки: python3 ops/backup/secret-input.test.py
"""
import os
import pty
import select
import sys
import time

LIB = "/usr/local/lib/pelena-backup/secret-input.sh"
VALUE = "abcDEF0123456789"
ESC = "\x1b"


def run(script, keys):
    """Запускает bash в терминале, вводит keys, возвращает вывод и код."""
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("bash", ["bash", "-c", script])
    time.sleep(0.4)
    os.write(fd, keys.encode("latin-1"))
    out = b""
    while True:
        ready, _, _ = select.select([fd], [], [], 3)
        if not ready:
            break
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
    _, status = os.waitpid(pid, 0)
    return out.decode("utf-8", "replace"), os.waitstatus_to_exitcode(status)


READ = f'source {LIB}; ask_secret V "p: "; printf "<%s>" "$V"'
CASES = {
    "чистое значение": VALUE + "\n",
    "ESC в конце": VALUE + ESC + "\n",
    "метка конца": VALUE + ESC + "[201~\n",
    "метки начала и конца": ESC + "[200~" + VALUE + ESC + "[201~\n",
    "CR вместо перевода строки": VALUE + "\r",
    "CR и перевод строки": VALUE + "\r\n",
    "пробелы и табуляция": "  \t" + VALUE + " \t \n",
    "всё сразу": " " + ESC + "[200~" + VALUE + "\r" + ESC + "[201~ \n",
}

failed = 0
for name, keys in CASES.items():
    out, code = run(READ, keys)
    ok = f"<{VALUE}>" in out and code == 0 and "\x1b[?2004l" in out
    print(("ок  " if ok else "ОШИБКА "), name)
    failed += 0 if ok else 1

_, code = run(READ, "\n")
print("ок   пустой ввод читается" if code == 0 else "ОШИБКА пустой ввод")

FORMAT = {
    "age верный": ("AGE-SECRET-KEY-1" + "Q" * 58, "$AGE_KEY_RE", True),
    "age короткий": ("AGE-SECRET-KEY-1" + "Q" * 57, "$AGE_KEY_RE", False),
    "age длинный": ("AGE-SECRET-KEY-1" + "Q" * 59, "$AGE_KEY_RE", False),
    "age строчными": ("age-secret-key-1" + "q" * 58, "$AGE_KEY_RE", False),
    "age запрещённая буква B": ("AGE-SECRET-KEY-1" + "B" * 58, "$AGE_KEY_RE", False),
    "hex верный": ("a" * 64, "$HEX64_RE", True),
    "hex короткий": ("a" * 63, "$HEX64_RE", False),
    "hex не тот алфавит": ("z" * 64, "$HEX64_RE", False),
    "ключ s3 верный": ("Abc123-_.xyZ", "$S3_VALUE_RE", True),
    "ключ s3 с пробелом": ("Abc123 xyZ12", "$S3_VALUE_RE", False),
}
for name, (value, regex, expected) in FORMAT.items():
    script = f"source {LIB}; require_format '{value}' \"{regex}\" Проверка формата; echo ПРИНЯТО"
    out, _ = run(script, "")
    ok = ("ПРИНЯТО" in out) == expected and value not in out.replace("ПРИНЯТО", "")
    print(("ок  " if ok else "ОШИБКА "), name)
    failed += 0 if ok else 1

print("Итог:", "все проверки прошли" if not failed else f"ошибок {failed}")
sys.exit(1 if failed else 0)
