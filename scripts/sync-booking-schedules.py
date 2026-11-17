#!/usr/bin/env python3
"""Compare public booking timetables with data/schedules.js and update the seed.

Sources:
  - WellnessLiving gyms that already have a bookingUrl on wellnessliving.com
  - Clubs listed on https://af-class-booking.fly.dev/api/classes

Does not log in, does not book, and does not keep member names from the hub API.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = ROOT / "data" / "schedules.js"
FLY_BASE = "https://af-class-booking.fly.dev"
SGT = timezone(timedelta(hours=8))
KEEP_NAME = {"HIIT", "HYROX", "ABT", "GX"}
DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_FROM_LONG = {
    "monday": "mon",
    "tuesday": "tue",
    "wednesday": "wed",
    "thursday": "thu",
    "friday": "fri",
    "saturday": "sat",
    "sunday": "sun",
    "mon": "mon",
    "tue": "tue",
    "wed": "wed",
    "thu": "thu",
    "fri": "fri",
    "sat": "sat",
    "sun": "sun",
}
MONTHS = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}
CLASS_FIELDS = ("id", "day", "name", "start", "end", "instructor", "level", "from", "note")
GYM_SUFFIX = re.compile(
    r"\s*(?:[-–]\s*)?(?:\((?:MB|DH|Tampines|Potong Pasir|Depot Heights|Mountbatten)\)|"
    r"(?:Tampines|Potong Pasir|Depot Heights|Mountbatten|DH|MB))\s*$",
    re.I,
)
DATE_LINE = re.compile(r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})")
TIME_LINE = re.compile(r"^(\d{1,2}:\d{2})\s*([AP]M)$")
DUR_LINE = re.compile(r"^(\d+)\s*min$", re.I)
SPOTS_LINE = re.compile(r"(\d+\s+spots|\don waitlist|waitlist|spots left)", re.I)
SKIP_LINES = {
    "book now",
    "join waitlist",
    "closed",
    "booking is closed",
    "special instructions",
    "filter",
    "today",
    "day",
    "week",
    "month",
    "time zone:",
    "singapore time - singapore",
    "outside",
    "powered by",
}
WL_EXTRACT_JS = r"""() => {
  const week = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Week');
  if (week) week.click();
  const range = [...document.querySelectorAll('button')].find(b => /[A-Z][a-z]{2} \d{1,2}\s*[–-]/.test(b.innerText || ''));
  return { range: range ? range.innerText.trim() : '', text: document.body.innerText };
}"""
WL_NEXT_JS = r"""() => {
  const buttons = [...document.querySelectorAll('button')];
  const idx = buttons.findIndex(b => /[A-Z][a-z]{2} \d{1,2}\s*[–-]/.test(b.innerText || ''));
  if (idx >= 0 && buttons[idx + 1]) buttons[idx + 1].click();
  return idx;
}"""


def sgt_now() -> datetime:
    return datetime.now(SGT)


def trigger_label() -> str:
    event = os.environ.get("GITHUB_EVENT_NAME", "").strip()
    if event == "schedule":
        return "GitHub 定时"
    if event == "workflow_dispatch":
        return "cron-job.org / 手动"
    return event or "本地运行"


def http_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "af-class-schedule-sync"})
    with urllib.request.urlopen(req, timeout=45) as res:
        raw = res.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def telegram_send(text: str) -> None:
    token = os.environ.get("AF_TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("AF_TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        print("Telegram notify skipped (missing AF_TELEGRAM_BOT_TOKEN or AF_TELEGRAM_CHAT_ID).", flush=True)
        return
    payload = json.dumps({"chat_id": chat_id, "text": text}).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.loads(res.read().decode("utf-8"))
        if data.get("ok"):
            print("Telegram notify sent.", flush=True)
        else:
            print(f"Telegram notify failed: {data.get('description') or data}", flush=True)
    except Exception as err:
        print(f"Telegram notify failed: {err}", flush=True)


def load_seed() -> dict[str, Any]:
    script = (
        "const fs=require('fs');const vm=require('vm');const ctx={window:{}};"
        "vm.runInNewContext(fs.readFileSync(process.env.SEED_PATH,'utf8'),ctx);"
        "process.stdout.write(JSON.stringify(ctx.window.AF_SEED));"
    )
    raw = subprocess.check_output(["node", "-e", script], env={**os.environ, "SEED_PATH": str(SEED_PATH)})
    return json.loads(raw)


def js_str(value: str) -> str:
    return json.dumps(str(value), ensure_ascii=False)


def format_class(item: dict[str, str]) -> str:
    parts = [f"{key}: {js_str(item[key])}" for key in CLASS_FIELDS if item.get(key)]
    return "        { " + ", ".join(parts) + " }"


def gym_block_span(src: str, gym_id: str) -> tuple[int, int]:
    needle = f'id: "{gym_id}"'
    found = src.find(needle)
    if found < 0:
        raise SystemExit(f"Gym {gym_id} is missing from {SEED_PATH}")
    start = src.rfind("    {", 0, found)
    if start < 0:
        raise SystemExit(f"Could not find gym object for {gym_id}")
    depth = 0
    for index, char in enumerate(src[start:], start):
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return start, index + 1
    raise SystemExit(f"Unclosed gym object for {gym_id}")


def replace_bracket_array(block: str, key: str, inner: str) -> str:
    marker = f"{key}:"
    key_at = block.find(marker)
    if key_at < 0:
        raise SystemExit(f"Missing {key} array")
    open_at = block.find("[", key_at)
    depth = 0
    for index, char in enumerate(block[open_at:], open_at):
        if char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return block[:open_at] + "[\n" + inner + "\n      ]" + block[index + 1 :]
    raise SystemExit(f"Unclosed {key} array")


def upsert_field(block: str, key: str, rendered: str) -> str:
    if re.search(rf"{key}:\s*", block):
        if rendered.startswith('"') or rendered.startswith("'"):
            return re.sub(rf'{key}:\s*"[^"]*"', f"{key}: {rendered}", block, count=1)
        return re.sub(rf"{key}:\s*[^,\n]+", f"{key}: {rendered}", block, count=1)
    return re.sub(r"\n(\s*)(notes:|classes:)", rf"\n\1{key}: {rendered},\n\1\2", block, count=1)


def write_gym(src: str, gym_id: str, classes: list[dict[str, str]], schedule_rev: int, booking_url: str | None, booking_note: str | None) -> str:
    start, end = gym_block_span(src, gym_id)
    block = src[start:end]
    block = upsert_field(block, "scheduleRev", str(schedule_rev))
    if booking_url:
        block = upsert_field(block, "bookingUrl", js_str(booking_url))
    if booking_note:
        block = upsert_field(block, "bookingNote", js_str(booking_note))
    inner = ",\n".join(format_class(item) for item in classes)
    block = replace_bracket_array(block, "classes", inner)
    return src[:start] + block + src[end:]


def strip_coach(name: str) -> str:
    return re.sub(r"^(coach|instructor)\s+", "", name.strip(), flags=re.I).strip()


def pretty_name(name: str) -> str:
    cleaned = GYM_SUFFIX.sub("", name).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if cleaned.isupper() and any(char.isalpha() for char in cleaned):
        words = []
        for word in cleaned.split(" "):
            words.append(word if word in KEEP_NAME else word.title())
        cleaned = " ".join(words)
    cleaned = cleaned.replace("BodyCombat", "Body Combat").replace("BodyPump", "Body Pump")
    cleaned = cleaned.replace("Cardio/Kickboxing", "Cardio / Kickboxing")
    return cleaned


def norm_name(name: str) -> str:
    text = pretty_name(name).lower().replace("&", " and ")
    text = re.sub(r"bodycombat", "body combat", text)
    text = re.sub(r"bodypump", "body pump", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\bclass\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def add_minutes(hhmm: str, minutes: int) -> str:
    hours, mins = [int(part) for part in hhmm.split(":")]
    total = hours * 60 + mins + minutes
    return f"{(total // 60) % 24:02d}:{total % 60:02d}"


def to_hhmm(value: str) -> str:
    text = (value or "").strip()
    match = TIME_LINE.match(text)
    if match:
        hours, minutes = [int(part) for part in match.group(1).split(":")]
        suffix = match.group(2)
        if suffix == "PM" and hours != 12:
            hours += 12
        if suffix == "AM" and hours == 12:
            hours = 0
        return f"{hours:02d}:{minutes:02d}"
    return text[:5]


def parse_wl_text(text: str) -> list[dict[str, str]]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    sessions: list[dict[str, str]] = []
    current_day = ""
    current_date = ""
    index = 0
    while index < len(lines):
        line = lines[index]
        dated = DATE_LINE.match(line)
        if dated:
            current_day = DAY_FROM_LONG[dated.group(1).lower()]
            current_date = f"{dated.group(4)}-{MONTHS[dated.group(2)]:02d}-{int(dated.group(3)):02d}"
            index += 1
            continue
        timed = TIME_LINE.match(line)
        if timed and current_date:
            start = to_hhmm(line)
            index += 1
            duration = 60
            if index < len(lines) and DUR_LINE.match(lines[index]):
                duration = int(DUR_LINE.match(lines[index]).group(1))
                index += 1
            while index < len(lines) and _skip_meta(lines[index]):
                index += 1
            if index >= len(lines) or DATE_LINE.match(lines[index]) or TIME_LINE.match(lines[index]):
                continue
            title = lines[index]
            index += 1
            while index < len(lines) and _skip_meta(lines[index]):
                index += 1
            instructor = ""
            if index < len(lines) and not DATE_LINE.match(lines[index]) and not TIME_LINE.match(lines[index]) and not DUR_LINE.match(lines[index]) and not _skip_meta(lines[index]):
                instructor = lines[index]
                index += 1
            if "45" in title and duration == 60:
                duration = 45
            sessions.append(
                {
                    "date": current_date,
                    "day": current_day,
                    "start": start,
                    "end": add_minutes(start, duration),
                    "name": pretty_name(title),
                    "instructor": strip_coach(instructor),
                }
            )
            continue
        index += 1
    return sessions


def _skip_meta(line: str) -> bool:
    lowered = line.strip().lower()
    if lowered in SKIP_LINES or SPOTS_LINE.search(line):
        return True
    if lowered.startswith("gx "):
        return True
    if re.fullmatch(r"\d+", line.strip()):
        return True
    return False


def standing_weekly(sessions: list[dict[str, str]]) -> list[dict[str, str]]:
    dates_by_day: dict[str, set[str]] = defaultdict(set)
    groups: dict[tuple[str, str, str], list[dict[str, str]]] = defaultdict(list)
    for session in sessions:
        dates_by_day[session["day"]].add(session["date"])
        groups[(session["day"], session["start"], norm_name(session["name"]))].append(session)
    standing: list[dict[str, str]] = []
    for items in groups.values():
        dates = {item["date"] for item in items}
        weekday_dates = dates_by_day[items[0]["day"]]
        if len(dates) >= 2 or dates == weekday_dates:
            standing.append(sorted(items, key=lambda item: item["date"])[-1])
    standing.sort(key=lambda item: (DAY_ORDER.index(item["day"]), item["start"], item["name"]))
    return standing


def gym_prefix(gym: dict[str, Any]) -> str:
    for item in gym.get("classes") or []:
        class_id = str(item.get("id") or "")
        if "-" in class_id:
            return class_id.split("-", 1)[0]
    return str(gym.get("id") or "gym")[:2]


def slug(name: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", pretty_name(name).lower()).strip("-")
    parts = [part for part in text.split("-") if part][:2]
    return "-".join(parts) or "class"


def class_id(prefix: str, item: dict[str, str], used: set[str]) -> str:
    hhmm = item["start"].replace(":", "")
    candidate = f"{prefix}-{item['day']}-{hhmm}-{slug(item['name'])}"
    base = candidate
    n = 2
    while candidate in used:
        candidate = f"{base}-{n}"
        n += 1
    used.add(candidate)
    return candidate


def match_seed(seed_classes: list[dict[str, Any]], live: dict[str, str], used: set[int]) -> dict[str, Any] | None:
    def pick(pred) -> dict[str, Any] | None:
        hits = [item for index, item in enumerate(seed_classes) if index not in used and pred(item)]
        if len(hits) == 1:
            return hits[0]
        return None

    exact = pick(lambda item: item.get("day") == live["day"] and (item.get("start") or "")[:5] == live["start"] and norm_name(item.get("name") or "") == norm_name(live["name"]))
    if exact:
        used.add(seed_classes.index(exact))
        return exact
    by_start = pick(lambda item: item.get("day") == live["day"] and (item.get("start") or "")[:5] == live["start"])
    if by_start:
        used.add(seed_classes.index(by_start))
        return by_start
    by_name = pick(lambda item: item.get("day") == live["day"] and norm_name(item.get("name") or "") == norm_name(live["name"]))
    if by_name:
        used.add(seed_classes.index(by_name))
        return by_name
    return None


def merge_classes(gym: dict[str, Any], live_sessions: list[dict[str, str]]) -> list[dict[str, str]]:
    standing = standing_weekly(live_sessions)
    seed_classes = list(gym.get("classes") or [])
    used: set[int] = set()
    merged: list[dict[str, str]] = []
    prefix = gym_prefix(gym)
    used_ids: set[str] = set()
    for live in standing:
        seed = match_seed(seed_classes, live, used)
        name = seed.get("name") if seed and norm_name(seed.get("name") or "") == norm_name(live["name"]) else live["name"]
        instructor = live.get("instructor") or (seed.get("instructor") if seed else "") or ""
        end = live["end"] or add_minutes(live["start"], 60)
        seed_end = str((seed or {}).get("end") or "")[:5]
        if seed and seed_end and str((seed.get("start") or ""))[:5] == live["start"] and end == add_minutes(live["start"], 60) and seed_end != end:
            end = seed_end
        item = {
            "id": str(seed.get("id") if seed else "") or class_id(prefix, live, used_ids),
            "day": live["day"],
            "name": name or live["name"],
            "start": live["start"],
            "end": end,
        }
        if seed and seed.get("id"):
            used_ids.add(str(seed["id"]))
        if instructor:
            item["instructor"] = instructor
        if seed:
            for extra in ("level", "from", "note"):
                if seed.get(extra):
                    item[extra] = str(seed[extra])
        merged.append(item)
    merged.sort(key=lambda item: (DAY_ORDER.index(item["day"]), item["start"], item["name"]))
    return merged


def signature(classes: list[dict[str, Any]]) -> list[tuple[str, str, str, str, str]]:
    rows = []
    for item in classes:
        rows.append(
            (
                str(item.get("day") or ""),
                str(item.get("start") or "")[:5],
                str(item.get("end") or "")[:5],
                norm_name(str(item.get("name") or "")),
                strip_coach(str(item.get("instructor") or "")).lower(),
            )
        )
    return sorted(rows)


def fetch_fly_sessions() -> dict[str, list[dict[str, str]]]:
    payload = http_json(f"{FLY_BASE}/api/classes")
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for raw in payload.get("classes") or []:
        if raw.get("is_cancelled") or raw.get("status") == "CANCELLED":
            continue
        club = str(raw.get("club_code") or "").strip()
        if not club:
            continue
        day = DAY_FROM_LONG.get(str(raw.get("day_of_week") or "").strip().lower())
        start = str(raw.get("start_time") or "")[:5]
        end = str(raw.get("end_time") or "")[:5]
        date = str(raw.get("class_date") or "")
        title = pretty_name(str(raw.get("title") or ""))
        if not (club and day and start and date and title):
            continue
        grouped[club].append(
            {
                "date": date,
                "day": day,
                "start": start,
                "end": end or add_minutes(start, 60),
                "name": title,
                "instructor": strip_coach(str(raw.get("instructor") or "")),
            }
        )
    return grouped


def _wait_dates(page, minimum: int = 6) -> None:
    try:
        page.wait_for_function(
            """min => (document.body.innerText.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun), /g) || []).length >= min""",
            arg=minimum,
            timeout=20000,
        )
    except Exception:
        page.wait_for_timeout(2000)


def scrape_wellnessliving(url: str) -> list[dict[str, str]]:
    from playwright.sync_api import sync_playwright

    sessions: list[dict[str, str]] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_default_timeout(60000)
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_function("() => /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), /.test(document.body.innerText)", timeout=45000)
        page.evaluate(WL_EXTRACT_JS)
        _wait_dates(page)
        first = page.evaluate(WL_EXTRACT_JS)
        sessions.extend(parse_wl_text(first.get("text") or ""))
        previous = first.get("range") or ""
        page.evaluate(WL_NEXT_JS)
        try:
            page.wait_for_function(
                """prev => {
                  const button = [...document.querySelectorAll('button')].find(item => /[A-Z][a-z]{2} \\d{1,2}\\s*[–-]/.test(item.innerText || ''));
                  return button && button.innerText.trim() && button.innerText.trim() !== prev;
                }""",
                arg=previous,
                timeout=20000,
            )
        except Exception:
            page.wait_for_timeout(2500)
        _wait_dates(page)
        second = page.evaluate(WL_EXTRACT_JS)
        sessions.extend(parse_wl_text(second.get("text") or ""))
        browser.close()
    if not sessions:
        raise RuntimeError("no classes parsed")
    weeks = {datetime.fromisoformat(item["date"]).isocalendar()[:2] for item in sessions if item.get("date")}
    if len(weeks) < 2:
        raise RuntimeError(f"only {len(weeks)} week of data")
    return sessions


def describe_changes(old: list[dict[str, Any]], new: list[dict[str, str]]) -> str:
    old_map = {(row[0], row[1], row[3]): row for row in signature(old)}
    new_map = {(row[0], row[1], row[3]): row for row in signature(new)}
    lines = []
    for key in sorted(set(old_map) - set(new_map)):
        lines.append(f"- removed {key[0]} {key[1]} {key[2]}")
    for key in sorted(set(new_map) - set(old_map)):
        lines.append(f"+ added {key[0]} {key[1]} {key[2]}")
    for key in sorted(set(old_map) & set(new_map)):
        if old_map[key] != new_map[key]:
            lines.append(f"~ updated {key[0]} {key[1]} {key[2]}")
    return "\n".join(lines) or "- class list changed"


def report_text(detail: str) -> str:
    return (
        "课表检查已执行\n"
        f"时间: {sgt_now():%a %d %b %H:%M SGT}\n"
        f"触发: {trigger_label()}\n"
        f"{detail.strip()}"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Print diffs without writing data/schedules.js")
    parser.add_argument("--fly-only", action="store_true")
    parser.add_argument("--wl-only", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def self_test() -> None:
    sample = """
Time Zone:
Singapore Time - Singapore
Today
Day
Week
Month
Nov 18 – 24, 2026
Filter
Pilates (MB)
1
Wed, Nov 18, 2026 (Today)
6:00 PM
60 min
Pilates (MB)
Levian
GX AREA
4 spots left of 7
Book now
7:00 PM
60 min
BOXING CLASS (MB)
Rossufyan
GX AREA
Special Instructions
Book now
Fri, Nov 20, 2026
8:00 PM
60 min
HYROX (MB)
Andy
GX AREA
Sat, Nov 21, 2026
1:30 PM
60 min
HIIT (MB)
Jerome
GX AREA
"""
    parsed = parse_wl_text(sample)
    assert [(item["day"], item["start"], item["name"], item["instructor"]) for item in parsed] == [
        ("wed", "18:00", "Pilates", "Levian"),
        ("wed", "19:00", "Boxing Class", "Rossufyan"),
        ("fri", "20:00", "HYROX", "Andy"),
        ("sat", "13:30", "HIIT", "Jerome"),
    ]
    assert pretty_name("Yoga - Dh") == "Yoga"
    assert pretty_name("Zumba Tampines") == "Zumba"
    print("self-test ok", flush=True)


def main() -> int:
    args = parse_args()
    if args.self_test:
        self_test()
        return 0

    seed = load_seed()
    gyms = {gym["id"]: gym for gym in seed.get("gyms") or []}
    src = SEED_PATH.read_text(encoding="utf-8")
    changed: list[str] = []
    notes: list[str] = []
    errors: list[str] = []

    if not args.wl_only:
        try:
            fly = fetch_fly_sessions()
        except Exception as err:
            errors.append(f"fly.dev: {err}")
            fly = {}
        for club, sessions in sorted(fly.items()):
            gym = gyms.get(club)
            if not gym:
                notes.append(f"{club}: on booking hub, not in app (skipped)")
                continue
            merged = merge_classes(gym, sessions)
            if signature(gym.get("classes") or []) == signature(merged):
                notes.append(f"{gym['name']}: unchanged")
                continue
            next_rev = int(gym.get("scheduleRev") or 0) + 1
            diff = describe_changes(gym.get("classes") or [], merged)
            notes.append(f"{gym['name']}: updated\n{diff}")
            if not args.dry_run:
                src = write_gym(
                    src,
                    club,
                    merged,
                    next_rev,
                    "https://af-class-booking.fly.dev",
                    gym.get("bookingNote") or "Book online.",
                )
            changed.append(gym["name"])

    if not args.fly_only:
        wl_gyms = [
            gym
            for gym in seed.get("gyms") or []
            if "wellnessliving.com" in str(gym.get("bookingUrl") or "")
        ]
        try:
            from playwright.sync_api import sync_playwright  # noqa: F401
        except ImportError:
            errors.append("playwright is not installed (needed for WellnessLiving)")
            wl_gyms = []
        for gym in wl_gyms:
            try:
                sessions = scrape_wellnessliving(str(gym["bookingUrl"]))
            except Exception as err:
                notes.append(f"{gym['name']}: skipped ({err})")
                continue
            merged = merge_classes(gym, sessions)
            if signature(gym.get("classes") or []) == signature(merged):
                notes.append(f"{gym['name']}: unchanged")
                continue
            next_rev = int(gym.get("scheduleRev") or 0) + 1
            diff = describe_changes(gym.get("classes") or [], merged)
            notes.append(f"{gym['name']}: updated\n{diff}")
            if not args.dry_run:
                src = write_gym(src, gym["id"], merged, next_rev, None, None)
            changed.append(gym["name"])

    if not args.dry_run and changed:
        SEED_PATH.write_text(src, encoding="utf-8")

    if errors:
        detail = "结果: 检查时出错\n" + "\n".join(f"- {item}" for item in errors)
        if notes:
            detail += "\n" + "\n".join(notes)
        print(detail, flush=True)
        telegram_send(report_text(detail))
        return 1

    if changed:
        detail = "结果: 发现课表变化，已更新 GitHub Pages 种子文件\n" + "\n".join(notes)
        if args.dry_run:
            detail = "结果: 发现课表变化（dry-run，未写入）\n" + "\n".join(notes)
    else:
        detail = "结果: 没有需要更新的常规课表\n" + "\n".join(notes)
    print(detail, flush=True)
    telegram_send(report_text(detail))
    return 0


if __name__ == "__main__":
    sys.exit(main())
