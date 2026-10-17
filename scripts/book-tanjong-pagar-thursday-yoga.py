#!/usr/bin/env python3
"""Book Tanjong Pagar Thursday Yoga on the AF booking site.

Uses your own member login (email + WhatsApp number). Does not store the password.

  AF_BOOKING_EMAIL='you@email.com' AF_BOOKING_WHATSAPP='81234567' \\
    python3 scripts/book-tanjong-pagar-thursday-yoga.py

  python3 scripts/book-tanjong-pagar-thursday-yoga.py --dry-run
  python3 scripts/book-tanjong-pagar-thursday-yoga.py --no-wait
  python3 scripts/book-tanjong-pagar-thursday-yoga.py --notify-test
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.cookiejar import CookieJar
from typing import Any

BASE = "https://af-class-booking.fly.dev"
CLUB = "tanjong-pagar"
DAY = "Thursday"
TITLE_NEEDLE = "yoga"
SGT = timezone(timedelta(hours=8))
POLL_SECONDS = 15
MAX_POLLS = 40


def sgt_now() -> datetime:
    return datetime.now(SGT)


def sgt_today() -> str:
    return sgt_now().date().isoformat()


def next_saturday_2pm_sgt() -> datetime:
    now = sgt_now()
    days = (5 - now.weekday()) % 7
    target = now.replace(hour=14, minute=0, second=0, microsecond=0) + timedelta(days=days)
    if target <= now:
        target += timedelta(days=7)
    return target


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


class BookingClient:
    def __init__(self) -> None:
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=30) as res:
                raw = res.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {"error": raw or err.reason}
            message = payload.get("error") or payload.get("message") or err.reason
            raise RuntimeError(f"{err.code}: {message}") from err

    def login(self, email: str, whatsapp: str) -> dict[str, Any]:
        data = self.request("POST", "/api/participants/login", {"email": email, "password": whatsapp})
        participant = data.get("participant") or data
        if not participant.get("id") and not participant.get("name"):
            raise RuntimeError(data.get("error") or "Login failed")
        return participant

    def classes(self, participant: dict[str, Any]) -> list[dict[str, Any]]:
        phone = str(participant.get("phone") or "").replace(" ", "")
        query = f"/api/classes?phone={urllib.parse.quote(phone)}&participantId={participant.get('id') or ''}"
        email = participant.get("email")
        if email:
            query += f"&email={urllib.parse.quote(str(email))}"
        data = self.request("GET", query)
        return data.get("classes") or []

    def book(self, class_id: int, participant: dict[str, Any], phone: str) -> dict[str, Any]:
        return self.request(
            "POST",
            "/api/bookings",
            {
                "classId": class_id,
                "participantName": participant.get("name") or "",
                "email": participant.get("email") or "",
                "phone": phone,
            },
        )


def is_target(cls: dict[str, Any]) -> bool:
    if str(cls.get("club_code") or "").lower() != CLUB:
        return False
    if str(cls.get("day_of_week") or "") != DAY:
        return False
    if TITLE_NEEDLE not in str(cls.get("title") or "").lower():
        return False
    if cls.get("is_cancelled") or cls.get("status") == "CANCELLED":
        return False
    return str(cls.get("class_date") or "") >= sgt_today()


def pick_class(classes: list[dict[str, Any]]) -> dict[str, Any] | None:
    matches = [cls for cls in classes if is_target(cls)]
    matches.sort(key=lambda cls: (cls.get("class_date") or "", cls.get("start_time") or ""))
    return matches[0] if matches else None


def wait_until(when: datetime) -> None:
    while True:
        remaining = (when - datetime.now(timezone.utc)).total_seconds()
        if remaining <= 0:
            return
        sleep_for = min(remaining, 30)
        print(f"Waiting {int(remaining)}s until booking opens ({when.astimezone(SGT):%a %d %b %H:%M SGT})...", flush=True)
        time.sleep(sleep_for)


def credentials() -> tuple[str, str]:
    email = os.environ.get("AF_BOOKING_EMAIL", "").strip()
    whatsapp = os.environ.get("AF_BOOKING_WHATSAPP", "").strip()
    if not email:
        email = input("Booking email: ").strip()
    if not whatsapp:
        whatsapp = getpass.getpass("WhatsApp number (password): ").strip()
    digits = "".join(ch for ch in whatsapp if ch.isdigit())
    if len(digits) < 8:
        raise SystemExit("WhatsApp number must be at least 8 digits.")
    return email, digits


def describe(cls: dict[str, Any]) -> str:
    return (
        f"{cls.get('title')} · {cls.get('club_name')} · {cls.get('class_date')} "
        f"{cls.get('start_time')}–{cls.get('end_time')} · {cls.get('booking_opens_label') or 'Open Now'}"
    )


def class_line(cls: dict[str, Any]) -> str:
    return (
        f"{cls.get('title')} · {cls.get('club_name')} · {cls.get('class_date')} "
        f"{cls.get('start_time')}–{cls.get('end_time')}"
    )


def is_waitlist_status(status: str) -> bool:
    return "wait" in (status or "").lower()


def telegram_request(token: str, method: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if payload else "GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(raw[:300] or err.reason) from err


def resolve_telegram_chat_id(token: str) -> str:
    chat_id = os.environ.get("AF_TELEGRAM_CHAT_ID", "").strip()
    if chat_id:
        return chat_id
    data = telegram_request(token, "getUpdates")
    for update in data.get("result") or []:
        chat = ((update.get("message") or update.get("edited_message") or {}).get("chat") or {})
        if chat.get("id") is not None:
            return str(chat["id"])
    raise RuntimeError("No Telegram chat found. Open your bot, send /start, then set AF_TELEGRAM_CHAT_ID.")


def notify_telegram(text: str) -> None:
    token = os.environ.get("AF_TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        print("Telegram notify skipped (no AF_TELEGRAM_BOT_TOKEN).", flush=True)
        return
    try:
        chat_id = resolve_telegram_chat_id(token)
        data = telegram_request(token, "sendMessage", {"chat_id": chat_id, "text": text})
        if data.get("ok"):
            print("Telegram notify sent.", flush=True)
        else:
            print(f"Telegram notify failed: {data.get('description') or data}", flush=True)
    except Exception as err:
        print(f"Telegram notify failed: {str(err).replace(token, '***')}", flush=True)


def trigger_label() -> str:
    event = os.environ.get("GITHUB_EVENT_NAME", "").strip()
    if event == "schedule":
        return "GitHub 定时"
    if event == "workflow_dispatch":
        return "cron-job.org / 手动"
    if event:
        return event
    return "本地运行"


def format_report(detail: str) -> str:
    return (
        "预约脚本已执行\n"
        f"时间: {sgt_now():%a %d %b %H:%M SGT}\n"
        f"触发: {trigger_label()}\n"
        f"{detail.strip()}"
    )


def book_class(args: argparse.Namespace) -> tuple[int, str]:
    email, phone = credentials()
    client = BookingClient()
    participant = client.login(email, phone)
    who = participant.get("name") or email
    print(f"Logged in as {who}", flush=True)

    polls = 0
    while True:
        classes = client.classes(participant)
        if participant.get("is_suspended"):
            return 1, f"登录成功（{who}）\n会员资料被暂停，无法预约。"
        target = pick_class(classes)
        if not target:
            return 1, f"登录成功（{who}）\n没有找到即将到来的 Tanjong Pagar 周四 Yoga。"

        print(describe(target), flush=True)
        line = class_line(target)
        if target.get("is_user_enrolled") or target.get("user_booking"):
            booking = target.get("user_booking") or {}
            status = booking.get("status") or "enrolled"
            print(f"Already on this class ({status}).")
            return 0, f"登录成功（{who}）\n已经约上（{status}）\n{line}"

        if target.get("is_booking_open") is False:
            opens = parse_iso(target.get("booking_opens_at")) or next_saturday_2pm_sgt()
            if args.no_wait:
                return 1, (
                    f"登录成功（{who}）\n"
                    f"预约还没开放，锁定到 {opens.astimezone(SGT):%a %d %b %H:%M SGT}\n{line}"
                )
            wait_until(opens)
            polls += 1
            if polls > MAX_POLLS:
                return 1, f"登录成功（{who}）\n等到超时，课还没开放\n{line}"
            time.sleep(1)
            continue

        if args.dry_run:
            print("Dry run: would book this class now.")
            return 0, f"登录成功（{who}）\n试运行：现在可以预约，没有提交\n{line}"

        if target.get("is_full") and target.get("is_waitlist_full"):
            return 1, f"登录成功（{who}）\n正课和 waitlist 都满了\n{line}"

        try:
            result = client.book(int(target["id"]), participant, phone)
        except RuntimeError as err:
            message = str(err)
            if "not open" in message.lower() or "locked" in message.lower():
                if args.no_wait:
                    return 1, f"登录成功（{who}）\n预约失败：{message}\n{line}"
                print(message, flush=True)
                time.sleep(POLL_SECONDS)
                polls += 1
                if polls > MAX_POLLS:
                    return 1, f"登录成功（{who}）\n等到超时，课还没开放\n{line}"
                continue
            return 1, f"登录成功（{who}）\n预约失败：{message}\n{line}"

        booking = result.get("booking") or result
        status = booking.get("status") or booking.get("state") or "confirmed"
        print(f"Booked: {status}")
        extra = f"status: {status}"
        if booking.get("booking_code"):
            print(f"Code: {booking['booking_code']}")
            extra += f"\ncode: {booking['booking_code']}"
        if is_waitlist_status(str(status)):
            return 0, f"登录成功（{who}）\n已加入 waitlist（{status}）\n{line}\n{extra}"
        return 0, f"登录成功（{who}）\n预约成功（{status}）\n{line}\n{extra}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Book Tanjong Pagar Thursday Yoga")
    parser.add_argument("--dry-run", action="store_true", help="Login and find the class, but do not book")
    parser.add_argument("--no-wait", action="store_true", help="Fail instead of waiting if booking is still locked")
    parser.add_argument("--notify-test", action="store_true", help="Send a Telegram test message and exit")
    args = parser.parse_args()

    if args.notify_test:
        notify_telegram(format_report("测试通知：Telegram 正常。"))
        return 0

    code = 1
    detail = "执行结束，没有详细结果。"
    try:
        code, detail = book_class(args)
    except SystemExit as err:
        if err.code in (0, None):
            code, detail = 0, "已结束。"
        else:
            text = err.code if isinstance(err.code, str) else (err.args[0] if err.args else str(err.code))
            code = err.code if isinstance(err.code, int) else 1
            detail = f"未完成\n{text}"
    except Exception as err:
        code = 1
        detail = f"出错了\n{err}"
    notify_telegram(format_report(detail))
    return code


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        notify_telegram(format_report("已停止。"))
        raise SystemExit("\nStopped.")
