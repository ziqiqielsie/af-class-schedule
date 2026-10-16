#!/usr/bin/env python3
"""Book Tanjong Pagar Thursday Yoga on the AF booking site.

Uses your own member login (email + WhatsApp number). Does not store the password.

  AF_BOOKING_EMAIL='you@email.com' AF_BOOKING_WHATSAPP='81234567' \\
    python3 scripts/book-tanjong-pagar-thursday-yoga.py

  python3 scripts/book-tanjong-pagar-thursday-yoga.py --dry-run
  python3 scripts/book-tanjong-pagar-thursday-yoga.py --no-wait
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Book Tanjong Pagar Thursday Yoga")
    parser.add_argument("--dry-run", action="store_true", help="Login and find the class, but do not book")
    parser.add_argument("--no-wait", action="store_true", help="Fail instead of waiting if booking is still locked")
    args = parser.parse_args()

    email, phone = credentials()
    client = BookingClient()
    participant = client.login(email, phone)
    print(f"Logged in as {participant.get('name') or email}", flush=True)

    polls = 0
    while True:
        classes = client.classes(participant)
        if participant.get("is_suspended"):
            raise SystemExit("This member profile is suspended and cannot book.")
        target = pick_class(classes)
        if not target:
            raise SystemExit("No upcoming Tanjong Pagar Thursday Yoga session was found.")

        print(describe(target), flush=True)
        if target.get("is_user_enrolled") or target.get("user_booking"):
            booking = target.get("user_booking") or {}
            status = booking.get("status") or "enrolled"
            print(f"Already on this class ({status}).")
            return 0

        if target.get("is_booking_open") is False:
            opens = parse_iso(target.get("booking_opens_at")) or next_saturday_2pm_sgt()
            if args.no_wait:
                raise SystemExit(f"Booking is locked until {opens.astimezone(SGT):%a %d %b %H:%M SGT}.")
            wait_until(opens)
            polls += 1
            if polls > MAX_POLLS:
                raise SystemExit("Timed out waiting for the class to open.")
            time.sleep(1)
            continue

        if args.dry_run:
            print("Dry run: would book this class now.")
            return 0

        if target.get("is_full") and target.get("is_waitlist_full"):
            raise SystemExit("Class and waitlist are both full.")

        try:
            result = client.book(int(target["id"]), participant, phone)
        except RuntimeError as err:
            message = str(err)
            if "not open" in message.lower() or "locked" in message.lower():
                if args.no_wait:
                    raise
                print(message, flush=True)
                time.sleep(POLL_SECONDS)
                polls += 1
                if polls > MAX_POLLS:
                    raise SystemExit("Timed out waiting for the class to open.")
                continue
            raise

        booking = result.get("booking") or result
        status = booking.get("status") or booking.get("state") or "confirmed"
        print(f"Booked: {status}")
        if booking.get("booking_code"):
            print(f"Code: {booking['booking_code']}")
        return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit("\nStopped.")
