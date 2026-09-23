(() => {
  const STORAGE_KEY = "af-class-schedule-v1";
  const TZ = "Asia/Singapore";
  const DAYS = [
    { id: "mon", label: "Mon", full: "Monday", js: 1, rrule: "MO" },
    { id: "tue", label: "Tue", full: "Tuesday", js: 2, rrule: "TU" },
    { id: "wed", label: "Wed", full: "Wednesday", js: 3, rrule: "WE" },
    { id: "thu", label: "Thu", full: "Thursday", js: 4, rrule: "TH" },
    { id: "fri", label: "Fri", full: "Friday", js: 5, rrule: "FR" },
    { id: "sat", label: "Sat", full: "Saturday", js: 6, rrule: "SA" },
    { id: "sun", label: "Sun", full: "Sunday", js: 0, rrule: "SU" }
  ];
  const CALENDAR_NAME = "Class Timetable";
  const DAY_ALIAS = {
    mon: "mon", monday: "mon", "周一": "mon", "星期一": "mon", "一": "mon",
    tue: "tue", tues: "tue", tuesday: "tue", "周二": "tue", "星期二": "tue", "二": "tue",
    wed: "wed", wednesday: "wed", "周三": "wed", "星期三": "wed", "三": "wed",
    thu: "thu", thur: "thu", thurs: "thu", thursday: "thu", "周四": "thu", "星期四": "thu", "四": "thu",
    fri: "fri", friday: "fri", "周五": "fri", "星期五": "fri", "五": "fri",
    sat: "sat", saturday: "sat", "周六": "sat", "星期六": "sat", "六": "sat",
    sun: "sun", sunday: "sun", "周日": "sun", "星期日": "sun", "日": "sun", "天": "sun"
  };
  const REGIONS = { east: "East", west: "West", central: "Central", south: "South", north: "North" };
  const KINDS = [
    { id: "all", label: "All", sticker: "wave" },
    { id: "yoga", label: "Yoga / Stretch", sticker: "stretch" },
    { id: "pilates", label: "Pilates", sticker: "pilates" },
    { id: "combat", label: "Combat", sticker: "lift" },
    { id: "strength", label: "Strength", sticker: "kettle" },
    { id: "cardio", label: "Cardio", sticker: "run" },
    { id: "dance", label: "Dance", sticker: "music" },
    { id: "cycle", label: "Cycling", sticker: "hydrate" }
  ];

  const appEl = document.getElementById("app");
  const seed = structuredClone(window.AF_SEED);
  let searchTimer = 0;
  const state = {
    data: loadData(),
    view: "day",
    day: todayId(),
    gymId: null,
    gymFilters: [],
    kind: "all",
    query: "",
    modal: null,
    toast: "",
    expandedGym: null
  };

  function todayId() {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      weekday: "short"
    }).format(new Date());
    const map = { Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat" };
    return map[weekday] || "mon";
  }

  function nowMinutes() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === "hour").value);
    const minute = Number(parts.find((part) => part.type === "minute").value);
    return hour * 60 + minute;
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(seed);
      const parsed = JSON.parse(raw);
      if (!parsed?.gyms) return structuredClone(seed);
      return mergeSeedBooking(parsed);
    } catch {
      return structuredClone(seed);
    }
  }

  function isWaBookingLabel(label) {
    return /^(预约|book)$/i.test(String(label || "").trim());
  }

  function mergeSeedBooking(data) {
    const existingIds = new Set(data.gyms.map((gym) => gym.id));
    for (const seeded of seed.gyms) {
      if (!existingIds.has(seeded.id)) data.gyms.push(structuredClone(seeded));
    }
    const fromSeed = new Map(seed.gyms.map((gym) => [gym.id, gym]));
    for (const gym of data.gyms) {
      const seeded = fromSeed.get(gym.id);
      if (!seeded) continue;
      if (seeded.color) gym.color = seeded.color;
      if (seeded.bookingUrl && !gym.bookingUrl) {
        gym.bookingUrl = seeded.bookingUrl;
        gym.bookingNote = seeded.bookingNote;
        if (seeded.whatsappLabel) gym.whatsappLabel = seeded.whatsappLabel;
      }
      if (seeded.whatsapp) {
        if (!gym.whatsapp) gym.whatsapp = seeded.whatsapp;
        if (isWaBookingLabel(seeded.whatsappLabel)) {
          gym.whatsapp = seeded.whatsapp;
          gym.whatsappLabel = "Book";
          if (seeded.bookingNote) gym.bookingNote = seeded.bookingNote;
        }
      }
      if (gym.whatsappLabel === "预约") gym.whatsappLabel = "Book";
    }
    return data;
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }

  function isDirty() {
    return JSON.stringify(state.data) !== JSON.stringify(seed);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
    ));
  }

  function slug(text) {
    return String(text || "class")
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "class";
  }

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function toMinutes(hhmm) {
    const [h, m] = String(hhmm || "00:00").split(":").map(Number);
    return h * 60 + (m || 0);
  }

  function durationLabel(start, end) {
    const mins = toMinutes(end) - toMinutes(start);
    return mins > 0 ? `${mins} min` : "";
  }

  function dayFull(id) {
    return DAYS.find((day) => day.id === id)?.full || id;
  }

  function classKind(name) {
    const n = String(name || "").toLowerCase();
    if (/pilates/.test(n)) return "pilates";
    if (/yoga|yin|stretch|mobility|myofascial|meditat|sound|yogalate|release/.test(n)) return "yoga";
    if (/combat|boxing|kickbox|muay|bodycombat/.test(n)) return "combat";
    if (/pump|strength|bar |core|hyrox|power|abt|abs|kettle|upper/.test(n)) return "strength";
    if (/zumba|dance|kpop|choreography|bounce/.test(n)) return "dance";
    if (/cycl|spin/.test(n)) return "cycle";
    if (/hiit|cardio|circuit|functional|attack|run|hybrid|fundamental/.test(n)) return "cardio";
    return "other";
  }

  function kindLabel(kind) {
    return KINDS.find((item) => item.id === kind)?.label || "Other";
  }

  function gymById(id) {
    return state.data.gyms.find((gym) => gym.id === id);
  }

  function filteredGyms() {
    if (!state.gymFilters.length) return state.data.gyms;
    return state.data.gyms.filter((gym) => state.gymFilters.includes(gym.id));
  }

  function matchesQuery(gym, item) {
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    return [item.name, item.instructor, item.note, gym.name].filter(Boolean).join(" ").toLowerCase().includes(q);
  }

  function matchesKind(item) {
    if (state.kind === "all") return true;
    return classKind(item.name) === state.kind;
  }

  function timedStatus(item) {
    if (state.day !== todayId()) return "";
    const now = nowMinutes();
    const start = toMinutes(item.start);
    const end = toMinutes(item.end);
    if (now >= start && now < end) return "live";
    if (start - now > 0 && start - now <= 60) return "soon";
    return "";
  }

  function toast(message) {
    state.toast = message;
    render();
    setTimeout(() => {
      if (state.toast === message) {
        state.toast = "";
        render();
      }
    }, 2200);
  }

  function allClassesForDay(dayId) {
    const rows = [];
    for (const gym of filteredGyms()) {
      for (const item of gym.classes || []) {
        if (item.day !== dayId) continue;
        if (!matchesQuery(gym, item) || !matchesKind(item)) continue;
        rows.push({ gym, item });
      }
    }
    rows.sort((a, b) => toMinutes(a.item.start) - toMinutes(b.item.start) || a.gym.name.localeCompare(b.gym.name));
    return rows;
  }

  function dayEnglish(id) {
    return {
      mon: "Monday",
      tue: "Tuesday",
      wed: "Wednesday",
      thu: "Thursday",
      fri: "Friday",
      sat: "Saturday",
      sun: "Sunday"
    }[id] || id;
  }

  function waMemberBlock() {
    return [
      "Name: Elsie",
      "Home Club: Wheelock Place",
      "Key Fob: D.A.",
      "",
      "Thank you and have a good day! :)"
    ].join("\n");
  }

  function waLink(gym, item) {
    if (!gym.whatsapp) return "";
    const number = String(gym.whatsapp).replace(/\D/g, "");
    const local = number.length === 8 ? `65${number}` : number;
    const text = item
      ? [
          "Hi there! Can you please help me book below class:",
          `Class Name: ${item.name}`,
          `Gym: ${gym.name}`,
          `Day: ${dayEnglish(item.day)}`,
          `Time: ${item.start}`,
          waMemberBlock()
        ].join("\n")
      : [
          `Hi there! Can you please help me enquire about group classes at ${gym.name}?`,
          waMemberBlock()
        ].join("\n");
    return `https://wa.me/${local}?text=${encodeURIComponent(text)}`;
  }

  function bookLink(gym) {
    return String(gym.bookingUrl || "").trim();
  }

  function primaryBookHref(gym, item) {
    return bookLink(gym) || (isWaBookingLabel(gym.whatsappLabel) ? waLink(gym, item) : "");
  }

  function bookLinksHtml(gym, item, variant) {
    const href = primaryBookHref(gym, item);
    const wa = waLink(gym, item);
    const cls = variant === "button" ? "btn primary" : "wa-link";
    const parts = [];
    if (href) {
      parts.push(`<a class="${cls}" href="${escapeHtml(href)}" target="_blank" rel="noopener">Book</a>`);
    }
    if (variant === "button" && wa && bookLink(gym)) {
      parts.push(`<a class="btn ghost" href="${escapeHtml(wa)}" target="_blank" rel="noopener">${escapeHtml(gym.whatsappLabel || "WhatsApp")}</a>`);
    }
    return parts.join("");
  }

  function singaporeYmd(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function addDaysYmd(ymd, days) {
    const [year, month, day] = ymd.split("-").map(Number);
    const utc = new Date(Date.UTC(year, month - 1, day));
    utc.setUTCDate(utc.getUTCDate() + days);
    return utc.toISOString().slice(0, 10);
  }

  function nextYmdForDay(dayId) {
    const today = singaporeYmd();
    const todayJs = DAYS.find((day) => day.id === todayId())?.js ?? 1;
    const want = DAYS.find((day) => day.id === dayId)?.js ?? 1;
    return addDaysYmd(today, (want - todayJs + 7) % 7);
  }

  function compactStamp(ymd, hhmm) {
    return `${ymd.replace(/-/g, "")}T${String(hhmm).replace(":", "")}00`;
  }

  function eventTitle(gym, item) {
    return `${item.name} · ${gym.name}`;
  }

  function eventLocation(gym) {
    return `Anytime Fitness ${gym.name}`;
  }

  function eventDetails(gym, item) {
    return [
      item.instructor ? `Coach: ${item.instructor}` : "",
      item.note ? item.note : "",
      gym.bookingNote || "",
      `Every ${dayFull(item.day)} ${item.start}–${item.end}`
    ].filter(Boolean).join("\n");
  }

  function googleCalUrl(gym, item) {
    const ymd = nextYmdForDay(item.day);
    const rrule = DAYS.find((day) => day.id === item.day)?.rrule || "MO";
    const params = new URLSearchParams({
      text: eventTitle(gym, item),
      dates: `${compactStamp(ymd, item.start)}/${compactStamp(ymd, item.end)}`,
      ctz: TZ,
      location: eventLocation(gym),
      details: eventDetails(gym, item),
      recur: `RRULE:FREQ=WEEKLY;BYDAY=${rrule}`
    });
    return `https://calendar.google.com/calendar/u/0/r/eventedit?${params.toString()}`;
  }

  function icsEscape(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  function icsFold(line) {
    let rest = line;
    const lines = [];
    while (rest.length > 73) {
      lines.push(rest.slice(0, 73));
      rest = ` ${rest.slice(73)}`;
    }
    lines.push(rest);
    return lines.join("\r\n");
  }

  function icsStamp(date = new Date()) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function veventFor(gym, item) {
    const ymd = nextYmdForDay(item.day);
    const rrule = DAYS.find((day) => day.id === item.day)?.rrule || "MO";
    return [
      "BEGIN:VEVENT",
      `UID:af-${gym.id}-${item.id}@ziqiqielsie.github.io`,
      `DTSTAMP:${icsStamp()}`,
      `DTSTART;TZID=Asia/Singapore:${compactStamp(ymd, item.start)}`,
      `DTEND;TZID=Asia/Singapore:${compactStamp(ymd, item.end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${rrule}`,
      icsFold(`SUMMARY:${icsEscape(eventTitle(gym, item))}`),
      icsFold(`LOCATION:${icsEscape(eventLocation(gym))}`),
      icsFold(`DESCRIPTION:${icsEscape(eventDetails(gym, item))}`),
      "END:VEVENT"
    ].join("\r\n");
  }

  function buildIcs(rows) {
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//AF Class Schedule//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${CALENDAR_NAME}`,
      "X-WR-TIMEZONE:Asia/Singapore",
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Singapore",
      "TZURL:http://tzurl.org/zoneinfo-outlook/Asia/Singapore",
      "X-LIC-LOCATION:Asia/Singapore",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:+0800",
      "TZOFFSETTO:+0800",
      "TZNAME:+08",
      "DTSTART:19700101T000000",
      "END:STANDARD",
      "END:VTIMEZONE",
      ...rows.map(({ gym, item }) => veventFor(gym, item)),
      "END:VCALENDAR",
      ""
    ].join("\r\n");
  }

  function downloadIcs(filename, body) {
    const blob = new Blob([body], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function addToClassTimetable(rows) {
    if (!rows.length) {
      toast("No classes to add");
      return;
    }
    if (rows.length === 1) {
      window.open(googleCalUrl(rows[0].gym, rows[0].item), "_blank", "noopener");
      toast("Choose the Class Timetable calendar before saving");
      return;
    }
    downloadIcs(`${CALENDAR_NAME}.ics`, buildIcs(rows));
    window.open("https://calendar.google.com/calendar/u/0/r/settings/export", "_blank", "noopener");
    toast("Import the downloaded file and pick Class Timetable");
  }

  function gymClassRows(gym) {
    if (!gym) return [];
    return [...(gym.classes || [])]
      .filter((item) => matchesQuery(gym, item) && matchesKind(item))
      .sort((a, b) => DAYS.findIndex((day) => day.id === a.day) - DAYS.findIndex((day) => day.id === b.day) || toMinutes(a.start) - toMinutes(b.start))
      .map((item) => ({ gym, item }));
  }

  function render() {
    appEl.innerHTML = `
      ${renderHeader()}
      ${renderTabs()}
      ${state.view === "manage" ? renderManage() : renderBrowse()}
      ${state.modal ? renderModal() : ""}
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
      <input class="hidden-file" id="import-file" type="file" accept="application/json" />
    `;
    bind();
  }

  function stickerSrc(name) {
    return `./img/stickers/${name}.jpg`;
  }

  function kindSticker(kind) {
    return KINDS.find((item) => item.id === kind)?.sticker || "wink";
  }

  function emptyHtml(message, pose) {
    const sticker = pose === "sit" ? "wink" : "bath";
    return `
      <div class="empty card">
        <img class="lulu-empty-img" src="${stickerSrc(sticker)}" alt="Lulu the capybara">
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  function renderHeader() {
    const today = dayFull(todayId());
    return `
      <header class="hero">
        <img class="lulu-hero" src="./img/lulu-sheet.jpg" alt="Gym Time Lulu stickers">
        <div class="hero-copy">
          <div class="hero-top">
            <div class="logo">
              <span class="logo-mark"><img src="${stickerSrc("wave")}" alt=""></span>
              Lulu Timetable
            </div>
            <div class="top-actions">
              <button class="btn ${state.view === "manage" ? "primary" : ""}" data-action="toggle-manage">
                ${state.view === "manage" ? "Done" : "Edit timetable"}
              </button>
            </div>
          </div>
          <h1>Group Classes</h1>
          <div class="subtitle">Gym Time · Today is ${today} · Singapore time · ${state.data.gyms.length} gyms</div>
        </div>
      </header>
    `;
  }

  function renderTabs() {
    if (state.view === "manage") return "";
    return `
      <nav class="tabs">
        <button data-view="day" class="${state.view === "day" ? "active" : ""}">By day</button>
        <button data-view="gym" class="${state.view === "gym" ? "active" : ""}">By gym</button>
      </nav>
    `;
  }

  function renderBrowse() {
    return `
      <div class="search"><input id="q" type="search" placeholder="Search classes, coaches, or gyms 🍊" value="${escapeHtml(state.query)}" /></div>
      ${state.view === "day" ? renderGymChips() : ""}
      ${renderKindChips()}
      ${state.view === "day" ? renderDayView() : renderGymView()}
    `;
  }

  function renderGymChips() {
    const chips = [`<button class="chip ${state.gymFilters.length === 0 ? "active" : ""}" data-gym-filter="all">All</button>`]
      .concat(state.data.gyms.map((gym) => `
        <button class="chip ${state.gymFilters.includes(gym.id) ? "active" : ""}" data-gym-filter="${escapeHtml(gym.id)}" style="--chip:${gym.color}">
          ${escapeHtml(gym.name)}
        </button>
      `));
    return `<div class="chip-row">${chips.join("")}</div>`;
  }

  function renderKindChips() {
    return `<div class="chip-row kind-row">${KINDS.map((kind) => `
      <button class="chip ${state.kind === kind.id ? "active" : ""}" data-kind="${kind.id}">
        <img src="${stickerSrc(kind.sticker)}" alt="">
        ${kind.label}
      </button>
    `).join("")}</div>`;
  }

  function renderDayView() {
    const rows = allClassesForDay(state.day);
    return `
      <div class="chip-row day-row">
        ${DAYS.map((day) => `
          <button class="chip ${state.day === day.id ? "active" : ""}" data-day="${day.id}">
            ${day.label}
            ${day.id === todayId() ? "<small>today</small>" : ""}
          </button>
        `).join("")}
      </div>
      <div class="meta-row">
        <span>${dayFull(state.day)} · ${rows.length} class${rows.length === 1 ? "" : "es"}</span>
        <span class="meta-actions">
          ${isDirty() ? `<span class="pill">Local edits</span>` : ""}
          ${rows.length ? `<button type="button" class="btn" data-cal-day>Add to Class Timetable</button>` : ""}
        </span>
      </div>
      <div class="list">
        ${rows.length ? rows.map(renderClassCard).join("") : emptyHtml("Lulu is in the onsen today — no classes match these filters.")}
      </div>
    `;
  }

  function renderClassCard({ gym, item }) {
    const status = timedStatus(item);
    const kind = classKind(item.name);
    const statusHtml = status === "live" ? `<div class="live">Live</div>` : status === "soon" ? `<div class="soon">Soon</div>` : "";
    return `
      <article class="card class-card" style="--gym-color:${gym.color}">
        <div class="time">${escapeHtml(item.start)}<span>${escapeHtml(item.end)}</span><span>${escapeHtml(durationLabel(item.start, item.end))}${statusHtml}</span></div>
        <div>
          <div class="class-name">${escapeHtml(item.name)}</div>
          <div class="class-meta">
            ${escapeHtml(gym.name)}
            ${item.instructor ? ` · ${escapeHtml(item.instructor)}` : ""}
            ${item.note ? ` · ${escapeHtml(item.note)}` : ""}
          </div>
          <div class="card-actions">
            ${bookLinksHtml(gym, item)}
            <button type="button" class="wa-link" data-cal-class="${escapeHtml(gym.id)}::${escapeHtml(item.id)}">Add to calendar</button>
          </div>
        </div>
        <div class="kind">
          <img src="${stickerSrc(kindSticker(kind))}" alt="">
          <span>${escapeHtml(kindLabel(kind))}</span>
        </div>
      </article>
    `;
  }

  function renderGymView() {
    const gyms = filteredGyms();
    const selected = state.gymId && gyms.some((gym) => gym.id === state.gymId) ? state.gymId : gyms[0]?.id;
    state.gymId = selected || null;
    const gym = gymById(state.gymId);
    if (!gym) return emptyHtml("No gyms yet. Add one in Edit timetable.", "sit");
    return `
      <div class="chip-row">
        ${gyms.map((item) => `
          <button class="chip ${item.id === gym.id ? "active" : ""}" data-select-gym="${item.id}" style="--chip:${item.color}">${escapeHtml(item.name)}</button>
        `).join("")}
      </div>
      <div class="gym-head">
        <div>
          <h2 style="margin:0">${escapeHtml(gym.name)}</h2>
          <div class="subtitle">${REGIONS[gym.region] || ""} · ${(gym.classes || []).length} class${(gym.classes || []).length === 1 ? "" : "es"}${gym.bookingNote ? ` · ${escapeHtml(gym.bookingNote)}` : ""}</div>
        </div>
        <div class="mini-actions">
          ${bookLinksHtml(gym, null, "button")}
          <button type="button" class="btn" data-cal-gym="${escapeHtml(gym.id)}">Add week to calendar</button>
        </div>
      </div>
      ${gym.notes ? `<p class="hint">${escapeHtml(gym.notes)}</p>` : ""}
      ${DAYS.map((day) => {
        const items = (gym.classes || [])
          .filter((item) => item.day === day.id && matchesQuery(gym, item) && matchesKind(item))
          .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
        if (!items.length) return "";
        return `
          <div class="day-label">${day.full}${day.id === todayId() ? " · today" : ""}</div>
          <div class="list">${items.map((item) => renderClassCard({ gym, item })).join("")}</div>
        `;
      }).join("") || emptyHtml("No classes match these filters at this gym.")}
    `;
  }

  function renderManage() {
    return `
      <div class="manage-toolbar">
        <button class="btn primary" data-action="add-gym">Add gym</button>
        <button class="btn" data-action="export">Export JSON</button>
        <button class="btn" data-action="import">Import / replace timetable</button>
        <button class="btn" data-action="reset">Restore original</button>
      </div>
      <p class="hint">Edits stay in this browser. Export JSON to keep a backup or move phones. You can also paste the export into <code>data/schedules.js</code> as the new default timetable.</p>
      ${isDirty() ? `<div class="meta-row"><span class="pill">Local edits not written back to the default file</span></div>` : ""}
      ${state.data.gyms.map(renderGymManage).join("") || emptyHtml("No gyms yet.", "sit")}
    `;
  }

  function renderGymManage(gym) {
    const open = state.expandedGym === gym.id;
    const classes = [...(gym.classes || [])].sort((a, b) => DAYS.findIndex((d) => d.id === a.day) - DAYS.findIndex((d) => d.id === b.day) || toMinutes(a.start) - toMinutes(b.start));
    return `
      <section class="card gym-manage" style="--gym-color:${gym.color}">
        <div class="gym-manage-head">
          <div>
            <div class="class-name">${escapeHtml(gym.name)}</div>
            <div class="class-meta">${REGIONS[gym.region] || "Unassigned"} · ${classes.length} class${classes.length === 1 ? "" : "es"}${gym.whatsapp ? ` · ${escapeHtml(gym.whatsapp)}` : ""}</div>
          </div>
          <div class="mini-actions">
            <button class="btn" data-expand="${gym.id}">${open ? "Collapse" : "Classes"}</button>
            <button class="btn" data-edit-gym="${gym.id}">Edit gym</button>
            <button class="btn" data-add-class="${gym.id}">Add class</button>
            <button class="btn" data-bulk="${gym.id}">Bulk / replace</button>
            <button class="btn danger" data-delete-gym="${gym.id}">Delete gym</button>
          </div>
        </div>
        ${open ? classes.map((item) => `
          <div class="class-edit-row">
            <div>
              <strong>${escapeHtml(dayFull(item.day))} ${escapeHtml(item.start)}–${escapeHtml(item.end)}</strong>
              <div class="class-meta">${escapeHtml(item.name)}${item.instructor ? ` · ${escapeHtml(item.instructor)}` : ""}</div>
            </div>
            <div class="mini-actions">
              <button class="btn" data-edit-class="${gym.id}::${item.id}">Edit</button>
              <button class="btn danger" data-delete-class="${gym.id}::${item.id}">Delete</button>
            </div>
          </div>
        `).join("") || `<div class="hint" style="margin-top:10px">This gym has no classes yet.</div>` : ""}
      </section>
    `;
  }

  function renderModal() {
    const modal = state.modal;
    if (modal.type === "gym") return renderGymModal(modal);
    if (modal.type === "class") return renderClassModal(modal);
    if (modal.type === "bulk") return renderBulkModal(modal);
    return "";
  }

  function renderGymModal(modal) {
    const gym = modal.gym;
    return `
      <div class="modal-backdrop" data-close-modal>
        <form class="modal" id="gym-form">
          <h3>${gym.id ? "Edit gym" : "Add gym"}</h3>
          <div class="fields">
            <div class="field"><label>Gym name</label><input name="name" required value="${escapeHtml(gym.name || "")}" /></div>
            <div class="two">
              <div class="field">
                <label>Region</label>
                <select name="region">
                  ${Object.entries(REGIONS).map(([id, label]) => `<option value="${id}" ${gym.region === id ? "selected" : ""}>${label}</option>`).join("")}
                </select>
              </div>
              <div class="field"><label>Colour</label><input name="color" type="color" value="${escapeHtml(gym.color || "#f4a261")}" /></div>
            </div>
            <div class="two">
              <div class="field"><label>WhatsApp (8-digit Singapore number)</label><input name="whatsapp" inputmode="numeric" value="${escapeHtml(gym.whatsapp || "")}" /></div>
              <div class="field"><label>Button label</label><input name="whatsappLabel" value="${escapeHtml(gym.whatsappLabel || "Book")}" /></div>
            </div>
            <div class="field"><label>Booking page URL</label><input name="bookingUrl" type="url" placeholder="https://" value="${escapeHtml(gym.bookingUrl || "")}" /></div>
            <div class="field"><label>Booking note</label><input name="bookingNote" value="${escapeHtml(gym.bookingNote || "")}" /></div>
            <div class="field"><label>Notes</label><textarea name="notes" rows="3">${escapeHtml(gym.notes || "")}</textarea></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn ghost" data-close-modal>Cancel</button>
            <button class="btn primary" type="submit">Save</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderClassModal(modal) {
    const item = modal.item;
    return `
      <div class="modal-backdrop" data-close-modal>
        <form class="modal" id="class-form">
          <h3>${item.id ? "Edit class" : "Add class"}</h3>
          <div class="fields">
            <div class="field">
              <label>Day</label>
              <select name="day">${DAYS.map((day) => `<option value="${day.id}" ${item.day === day.id ? "selected" : ""}>${day.full}</option>`).join("")}</select>
            </div>
            <div class="field"><label>Class name</label><input name="name" required value="${escapeHtml(item.name || "")}" /></div>
            <div class="two">
              <div class="field"><label>Start</label><input name="start" type="time" required value="${escapeHtml(item.start || "19:00")}" /></div>
              <div class="field"><label>End</label><input name="end" type="time" required value="${escapeHtml(item.end || "20:00")}" /></div>
            </div>
            <div class="two">
              <div class="field"><label>Coach</label><input name="instructor" value="${escapeHtml(item.instructor || "")}" /></div>
              <div class="field"><label>Note</label><input name="note" value="${escapeHtml(item.note || "")}" /></div>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn ghost" data-close-modal>Cancel</button>
            <button class="btn primary" type="submit">Save</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderBulkModal(modal) {
    return `
      <div class="modal-backdrop" data-close-modal>
        <form class="modal" id="bulk-form">
          <h3>Bulk add / replace classes</h3>
          <p class="hint">One class per line, for example:<br>Mon 19:00-20:00 Yoga<br>Tue 7:00pm-8:00pm HIIT | Shaun<br>Replace clears this gym's current classes first.</p>
          <div class="fields">
            <div class="field">
              <label>Mode</label>
              <select name="mode">
                <option value="append">Append to current timetable</option>
                <option value="replace">Replace entire timetable</option>
              </select>
            </div>
            <div class="field"><label>Class list</label><textarea name="text" rows="10" required placeholder="Wed 18:30-19:30 Pilates | Levian"></textarea></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn ghost" data-close-modal>Cancel</button>
            <button class="btn primary" type="submit">Save</button>
          </div>
        </form>
      </div>
    `;
  }

  function bind() {
    appEl.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.view = btn.dataset.view;
        render();
      });
    });
    const manageBtn = appEl.querySelector("[data-action='toggle-manage']");
    if (manageBtn) {
      manageBtn.addEventListener("click", () => {
        state.view = state.view === "manage" ? "day" : "manage";
        render();
      });
    }
    const q = appEl.querySelector("#q");
    if (q) {
      q.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          state.query = q.value;
          renderKeepFocus(q);
        }, 160);
      });
    }
    appEl.querySelectorAll("[data-gym-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.gymFilter;
        if (id === "all") state.gymFilters = [];
        else if (state.gymFilters.includes(id)) state.gymFilters = state.gymFilters.filter((item) => item !== id);
        else state.gymFilters = [...state.gymFilters, id];
        render();
      });
    });
    appEl.querySelectorAll("[data-kind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.kind = btn.dataset.kind;
        render();
      });
    });
    appEl.querySelectorAll("[data-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.day = btn.dataset.day;
        render();
      });
    });
    appEl.querySelectorAll("[data-select-gym]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.gymId = btn.dataset.selectGym;
        render();
      });
    });
    appEl.querySelectorAll("[data-cal-class]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [gymId, classId] = btn.dataset.calClass.split("::");
        const gym = gymById(gymId);
        const item = gym?.classes?.find((cls) => cls.id === classId);
        if (gym && item) addToClassTimetable([{ gym, item }]);
      });
    });
    const calDay = appEl.querySelector("[data-cal-day]");
    if (calDay) {
      calDay.addEventListener("click", () => addToClassTimetable(allClassesForDay(state.day)));
    }
    const calGym = appEl.querySelector("[data-cal-gym]");
    if (calGym) {
      calGym.addEventListener("click", () => addToClassTimetable(gymClassRows(gymById(calGym.dataset.calGym))));
    }
    bindManage();
    bindModal();
  }

  function renderKeepFocus(oldInput) {
    const start = oldInput.selectionStart;
    const end = oldInput.selectionEnd;
    render();
    const next = appEl.querySelector("#q");
    if (next) {
      next.focus();
      next.setSelectionRange(start, end);
    }
  }

  function bindManage() {
    const file = appEl.querySelector("#import-file");
    const action = (name, fn) => {
      const btn = appEl.querySelector(`[data-action='${name}']`);
      if (btn) btn.addEventListener("click", fn);
    };
    action("add-gym", () => {
      state.modal = { type: "gym", gym: { name: "", region: "east", color: "#f4a261", whatsapp: "", whatsappLabel: "Book", bookingUrl: "", bookingNote: "", notes: "", classes: [] } };
      render();
    });
    action("export", exportJson);
    action("import", () => file && file.click());
    action("reset", () => {
      if (!confirm("Restore the original poster timetable? Local edits will be lost.")) return;
      state.data = structuredClone(seed);
      persist();
      toast("Original timetable restored");
      render();
    });
    if (file) {
      file.addEventListener("change", async () => {
        const picked = file.files?.[0];
        if (!picked) return;
        try {
          const parsed = JSON.parse(await picked.text());
          if (!parsed?.gyms) throw new Error("missing gyms");
          if (!confirm("Import will replace the current timetable. Continue?")) return;
          state.data = parsed;
          persist();
          toast("Timetable imported");
          render();
        } catch {
          toast("Invalid JSON");
        }
        file.value = "";
      });
    }
    appEl.querySelectorAll("[data-expand]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.expandedGym = state.expandedGym === btn.dataset.expand ? null : btn.dataset.expand;
        render();
      });
    });
    appEl.querySelectorAll("[data-edit-gym]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.modal = { type: "gym", gym: { ...gymById(btn.dataset.editGym) } };
        render();
      });
    });
    appEl.querySelectorAll("[data-add-class]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.expandedGym = btn.dataset.addClass;
        state.modal = { type: "class", gymId: btn.dataset.addClass, item: { day: state.day, name: "", start: "19:00", end: "20:00" } };
        render();
      });
    });
    appEl.querySelectorAll("[data-bulk]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.modal = { type: "bulk", gymId: btn.dataset.bulk };
        render();
      });
    });
    appEl.querySelectorAll("[data-delete-gym]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const gym = gymById(btn.dataset.deleteGym);
        if (!confirm(`Delete ${gym.name} and all of its classes?`)) return;
        state.data.gyms = state.data.gyms.filter((item) => item.id !== gym.id);
        persist();
        toast("Gym deleted");
        render();
      });
    });
    appEl.querySelectorAll("[data-edit-class]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [gymId, classId] = btn.dataset.editClass.split("::");
        const gym = gymById(gymId);
        const item = gym.classes.find((cls) => cls.id === classId);
        state.modal = { type: "class", gymId, item: { ...item } };
        render();
      });
    });
    appEl.querySelectorAll("[data-delete-class]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [gymId, classId] = btn.dataset.deleteClass.split("::");
        const gym = gymById(gymId);
        gym.classes = gym.classes.filter((cls) => cls.id !== classId);
        persist();
        toast("Class deleted");
        render();
      });
    });
  }

  function bindModal() {
    appEl.querySelectorAll("[data-close-modal]").forEach((el) => {
      el.addEventListener("click", (event) => {
        if (event.currentTarget === event.target) {
          state.modal = null;
          render();
        }
      });
    });
    const gymForm = appEl.querySelector("#gym-form");
    if (gymForm) {
      gymForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = new FormData(gymForm);
        const payload = Object.fromEntries(form.entries());
        if (state.modal.gym.id) {
          Object.assign(gymById(state.modal.gym.id), payload);
        } else {
          const gym = {
            id: uid("gym"),
            classes: [],
            ...payload
          };
          state.data.gyms.push(gym);
          state.expandedGym = gym.id;
        }
        persist();
        state.modal = null;
        toast("Gym saved");
        render();
      });
    }
    const classForm = appEl.querySelector("#class-form");
    if (classForm) {
      classForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = Object.fromEntries(new FormData(classForm).entries());
        const gym = gymById(state.modal.gymId);
        if (state.modal.item.id) {
          Object.assign(gym.classes.find((cls) => cls.id === state.modal.item.id), form);
        } else {
          gym.classes.push({
            id: uid(`${gym.id}-${form.day}-${String(form.start).replace(":", "")}-${slug(form.name)}`),
            ...form
          });
        }
        persist();
        state.modal = null;
        toast("Class saved");
        render();
      });
    }
    const bulkForm = appEl.querySelector("#bulk-form");
    if (bulkForm) {
      bulkForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = Object.fromEntries(new FormData(bulkForm).entries());
        const gym = gymById(state.modal.gymId);
        const parsed = parseBulk(form.text);
        if (!parsed.length) {
          toast("No valid classes found");
          return;
        }
        if (form.mode === "replace") gym.classes = [];
        parsed.forEach((item) => gym.classes.push({ id: uid(`${gym.id}-${item.day}`), ...item }));
        persist();
        state.expandedGym = gym.id;
        state.modal = null;
        toast(`${form.mode === "replace" ? "Replaced" : "Added"} ${parsed.length} class${parsed.length === 1 ? "" : "es"}`);
        render();
      });
    }
  }

  function parseTimeToken(token) {
    const raw = token.trim().toLowerCase().replace(/\s+/g, "");
    const ampm = raw.match(/(\d{1,2})(?:[:.](\d{2}))?(am|pm)/);
    if (ampm) {
      let hour = Number(ampm[1]);
      const minute = Number(ampm[2] || 0);
      if (ampm[3] === "pm" && hour < 12) hour += 12;
      if (ampm[3] === "am" && hour === 12) hour = 0;
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
    const hhmm = raw.match(/^(\d{1,2})[:.](\d{2})$/);
    if (hhmm) return `${String(Number(hhmm[1])).padStart(2, "0")}:${hhmm[2]}`;
    return "";
  }

  function parseBulk(text) {
    return text.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const instructorSplit = line.split("|");
      const instructor = (instructorSplit[1] || "").trim();
      const left = instructorSplit[0].trim();
      const parts = left.split(/\s+/);
      const day = DAY_ALIAS[parts[0].toLowerCase()];
      if (!day) return null;
      const rest = parts.slice(1).join(" ");
      const range = rest.match(/([0-9apm.:]+)\s*[-–~到至]\s*([0-9apm.:]+)\s+(.*)/i) || rest.match(/([0-9apm.:]+)\s+([0-9apm.:]+)\s+(.*)/i);
      if (!range) return null;
      const start = parseTimeToken(range[1]);
      const end = parseTimeToken(range[2]);
      const name = range[3].trim();
      if (!start || !end || !name) return null;
      return { day, start, end, name, instructor };
    }).filter(Boolean);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "af-schedules.json";
    a.click();
    URL.revokeObjectURL(url);
    toast("JSON exported");
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  render();
})();
