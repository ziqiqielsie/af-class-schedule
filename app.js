(() => {
  const STORAGE_KEY = "af-class-schedule-v1";
  const TZ = "Asia/Singapore";
  const DAYS = [
    { id: "mon", label: "一", full: "周一", js: 1, rrule: "MO" },
    { id: "tue", label: "二", full: "周二", js: 2, rrule: "TU" },
    { id: "wed", label: "三", full: "周三", js: 3, rrule: "WE" },
    { id: "thu", label: "四", full: "周四", js: 4, rrule: "TH" },
    { id: "fri", label: "五", full: "周五", js: 5, rrule: "FR" },
    { id: "sat", label: "六", full: "周六", js: 6, rrule: "SA" },
    { id: "sun", label: "日", full: "周日", js: 0, rrule: "SU" }
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
  const REGIONS = { east: "东部", west: "西部", central: "中部", south: "南部" };
  const KINDS = [
    { id: "all", label: "全部" },
    { id: "mind", label: "瑜伽拉伸" },
    { id: "combat", label: "搏击" },
    { id: "strength", label: "力量" },
    { id: "cardio", label: "有氧" },
    { id: "dance", label: "舞蹈" },
    { id: "cycle", label: "单车" }
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

  function mergeSeedBooking(data) {
    const existingIds = new Set(data.gyms.map((gym) => gym.id));
    for (const seeded of seed.gyms) {
      if (!existingIds.has(seeded.id)) data.gyms.push(structuredClone(seeded));
    }
    const fromSeed = new Map(seed.gyms.map((gym) => [gym.id, gym]));
    for (const gym of data.gyms) {
      const seeded = fromSeed.get(gym.id);
      if (!seeded) continue;
      if (seeded.bookingUrl && !gym.bookingUrl) {
        gym.bookingUrl = seeded.bookingUrl;
        gym.bookingNote = seeded.bookingNote;
        if (seeded.whatsappLabel) gym.whatsappLabel = seeded.whatsappLabel;
      }
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
    return mins > 0 ? `${mins} 分钟` : "";
  }

  function dayFull(id) {
    return DAYS.find((day) => day.id === id)?.full || id;
  }

  function classKind(name) {
    const n = String(name || "").toLowerCase();
    if (/yoga|yin|stretch|pilates|mobility|myofascial|meditat|sound|yogalate|release/.test(n)) return "mind";
    if (/combat|boxing|kickbox|muay|bodycombat/.test(n)) return "combat";
    if (/pump|strength|bar |core|hyrox|power|abt/.test(n)) return "strength";
    if (/zumba|dance|kpop|choreography|bounce/.test(n)) return "dance";
    if (/cycl/.test(n)) return "cycle";
    if (/hiit|cardio|circuit|functional|attack|run|hybrid/.test(n)) return "cardio";
    return "other";
  }

  function kindLabel(kind) {
    return KINDS.find((item) => item.id === kind)?.label || "其他";
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

  function waLink(gym, item) {
    if (!gym.whatsapp) return "";
    const number = String(gym.whatsapp).replace(/\D/g, "");
    const local = number.length === 8 ? `65${number}` : number;
    const text = item
      ? `你好，想预约 ${gym.name} ${dayFull(item.day)} ${item.start} ${item.name}`
      : `你好，想咨询 ${gym.name} 团课`;
    return `https://wa.me/${local}?text=${encodeURIComponent(text)}`;
  }

  function bookLink(gym) {
    return String(gym.bookingUrl || "").trim();
  }

  function primaryBookHref(gym, item) {
    return bookLink(gym) || (gym.whatsappLabel === "预约" ? waLink(gym, item) : "");
  }

  function bookLinksHtml(gym, item, variant) {
    const href = primaryBookHref(gym, item);
    const wa = waLink(gym, item);
    const cls = variant === "button" ? "btn primary" : "wa-link";
    const parts = [];
    if (href) {
      parts.push(`<a class="${cls}" href="${escapeHtml(href)}" target="_blank" rel="noopener">预约</a>`);
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
      item.instructor ? `教练：${item.instructor}` : "",
      item.note ? item.note : "",
      gym.bookingNote || "",
      `每周${dayFull(item.day)} ${item.start}–${item.end}`
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
      toast("没有可添加的课");
      return;
    }
    if (rows.length === 1) {
      window.open(googleCalUrl(rows[0].gym, rows[0].item), "_blank", "noopener");
      toast("保存前把日历选成 Class Timetable");
      return;
    }
    downloadIcs(`${CALENDAR_NAME}.ics`, buildIcs(rows));
    window.open("https://calendar.google.com/calendar/u/0/r/settings/export", "_blank", "noopener");
    toast("请导入刚下载的文件，日历选 Class Timetable");
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

  function renderHeader() {
    const today = dayFull(todayId());
    return `
      <header class="topbar">
        <div class="brand">
          <div class="logo"><span class="logo-mark">AF</span> Anytime Fitness</div>
          <h1>团课课表</h1>
          <div class="subtitle">今天是${today} · 新加坡时间 · ${state.data.gyms.length} 家门店</div>
        </div>
        <div class="top-actions">
          <button class="btn ${state.view === "manage" ? "primary" : ""}" data-action="toggle-manage">
            ${state.view === "manage" ? "完成" : "编辑课表"}
          </button>
        </div>
      </header>
    `;
  }

  function renderTabs() {
    if (state.view === "manage") return "";
    return `
      <nav class="tabs">
        <button data-view="day" class="${state.view === "day" ? "active" : ""}">按星期</button>
        <button data-view="gym" class="${state.view === "gym" ? "active" : ""}">按门店</button>
      </nav>
    `;
  }

  function renderBrowse() {
    return `
      <div class="search"><input id="q" type="search" placeholder="搜课程、教练或门店" value="${escapeHtml(state.query)}" /></div>
      ${state.view === "day" ? renderGymChips() : ""}
      ${renderKindChips()}
      ${state.view === "day" ? renderDayView() : renderGymView()}
    `;
  }

  function renderGymChips() {
    const chips = [`<button class="chip ${state.gymFilters.length === 0 ? "active" : ""}" data-gym-filter="all">全部</button>`]
      .concat(state.data.gyms.map((gym) => `
        <button class="chip ${state.gymFilters.includes(gym.id) ? "active" : ""}" data-gym-filter="${escapeHtml(gym.id)}" style="--chip:${gym.color}">
          ${escapeHtml(gym.name)}
        </button>
      `));
    return `<div class="chip-row">${chips.join("")}</div>`;
  }

  function renderKindChips() {
    return `<div class="chip-row">${KINDS.map((kind) => `
      <button class="chip ${state.kind === kind.id ? "active" : ""}" data-kind="${kind.id}">${kind.label}</button>
    `).join("")}</div>`;
  }

  function renderDayView() {
    const rows = allClassesForDay(state.day);
    return `
      <div class="chip-row day-row">
        ${DAYS.map((day) => `
          <button class="chip ${state.day === day.id ? "active" : ""}" data-day="${day.id}">
            ${day.label}
            ${day.id === todayId() ? "<small>今天</small>" : ""}
          </button>
        `).join("")}
      </div>
      <div class="meta-row">
        <span>${dayFull(state.day)} · ${rows.length} 节课</span>
        <span class="meta-actions">
          ${isDirty() ? `<span class="pill">已有本地修改</span>` : ""}
          ${rows.length ? `<button type="button" class="btn" data-cal-day>加入 Class Timetable</button>` : ""}
        </span>
      </div>
      <div class="list">
        ${rows.length ? rows.map(renderClassCard).join("") : `<div class="empty card">这天没有符合筛选的团课。</div>`}
      </div>
    `;
  }

  function renderClassCard({ gym, item }) {
    const status = timedStatus(item);
    const statusHtml = status === "live" ? `<div class="live">进行中</div>` : status === "soon" ? `<div class="soon">即将开始</div>` : "";
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
            <button type="button" class="wa-link" data-cal-class="${escapeHtml(gym.id)}::${escapeHtml(item.id)}">加入日历</button>
          </div>
        </div>
        <div class="kind">${escapeHtml(kindLabel(classKind(item.name)))}</div>
      </article>
    `;
  }

  function renderGymView() {
    const gyms = filteredGyms();
    const selected = state.gymId && gyms.some((gym) => gym.id === state.gymId) ? state.gymId : gyms[0]?.id;
    state.gymId = selected || null;
    const gym = gymById(state.gymId);
    if (!gym) return `<div class="empty card">还没有门店。去「编辑课表」添加一家吧。</div>`;
    return `
      <div class="chip-row">
        ${gyms.map((item) => `
          <button class="chip ${item.id === gym.id ? "active" : ""}" data-select-gym="${item.id}" style="--chip:${item.color}">${escapeHtml(item.name)}</button>
        `).join("")}
      </div>
      <div class="gym-head">
        <div>
          <h2 style="margin:0">${escapeHtml(gym.name)}</h2>
          <div class="subtitle">${REGIONS[gym.region] || ""} · ${(gym.classes || []).length} 节课${gym.bookingNote ? ` · ${escapeHtml(gym.bookingNote)}` : ""}</div>
        </div>
        <div class="mini-actions">
          ${bookLinksHtml(gym, null, "button")}
          <button type="button" class="btn" data-cal-gym="${escapeHtml(gym.id)}">整周加入日历</button>
        </div>
      </div>
      ${gym.notes ? `<p class="hint">${escapeHtml(gym.notes)}</p>` : ""}
      ${DAYS.map((day) => {
        const items = (gym.classes || [])
          .filter((item) => item.day === day.id && matchesQuery(gym, item) && matchesKind(item))
          .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
        if (!items.length) return "";
        return `
          <div class="day-label">${day.full}${day.id === todayId() ? " · 今天" : ""}</div>
          <div class="list">${items.map((item) => renderClassCard({ gym, item })).join("")}</div>
        `;
      }).join("") || `<div class="empty card">这家店暂时没有符合筛选的课。</div>`}
    `;
  }

  function renderManage() {
    return `
      <div class="manage-toolbar">
        <button class="btn primary" data-action="add-gym">添加门店</button>
        <button class="btn" data-action="export">导出 JSON</button>
        <button class="btn" data-action="import">导入 / 替换全部课表</button>
        <button class="btn" data-action="reset">恢复原始课表</button>
      </div>
      <p class="hint">改动会保存在这台设备的浏览器里。想长期保留或换手机用，请先导出 JSON；也可以把导出内容贴进 <code>data/schedules.js</code> 作为新的默认课表。</p>
      ${isDirty() ? `<div class="meta-row"><span class="pill">已有本地修改，尚未写回默认文件</span></div>` : ""}
      ${state.data.gyms.map(renderGymManage).join("") || `<div class="empty card">还没有门店。</div>`}
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
            <div class="class-meta">${REGIONS[gym.region] || "未分区"} · ${classes.length} 节课${gym.whatsapp ? ` · ${escapeHtml(gym.whatsapp)}` : ""}</div>
          </div>
          <div class="mini-actions">
            <button class="btn" data-expand="${gym.id}">${open ? "收起" : "课程"}</button>
            <button class="btn" data-edit-gym="${gym.id}">编辑门店</button>
            <button class="btn" data-add-class="${gym.id}">加一节课</button>
            <button class="btn" data-bulk="${gym.id}">批量/替换</button>
            <button class="btn danger" data-delete-gym="${gym.id}">删除门店</button>
          </div>
        </div>
        ${open ? classes.map((item) => `
          <div class="class-edit-row">
            <div>
              <strong>${escapeHtml(dayFull(item.day))} ${escapeHtml(item.start)}–${escapeHtml(item.end)}</strong>
              <div class="class-meta">${escapeHtml(item.name)}${item.instructor ? ` · ${escapeHtml(item.instructor)}` : ""}</div>
            </div>
            <div class="mini-actions">
              <button class="btn" data-edit-class="${gym.id}::${item.id}">改</button>
              <button class="btn danger" data-delete-class="${gym.id}::${item.id}">删</button>
            </div>
          </div>
        `).join("") || `<div class="hint" style="margin-top:10px">这家店还没有课。</div>` : ""}
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
          <h3>${gym.id ? "编辑门店" : "添加门店"}</h3>
          <div class="fields">
            <div class="field"><label>门店名</label><input name="name" required value="${escapeHtml(gym.name || "")}" /></div>
            <div class="two">
              <div class="field">
                <label>区域</label>
                <select name="region">
                  ${Object.entries(REGIONS).map(([id, label]) => `<option value="${id}" ${gym.region === id ? "selected" : ""}>${label}</option>`).join("")}
                </select>
              </div>
              <div class="field"><label>颜色</label><input name="color" type="color" value="${escapeHtml(gym.color || "#8b5cf6")}" /></div>
            </div>
            <div class="two">
              <div class="field"><label>WhatsApp（8 位新加坡号码）</label><input name="whatsapp" inputmode="numeric" value="${escapeHtml(gym.whatsapp || "")}" /></div>
              <div class="field"><label>按钮文字</label><input name="whatsappLabel" value="${escapeHtml(gym.whatsappLabel || "预约")}" /></div>
            </div>
            <div class="field"><label>预约网页链接</label><input name="bookingUrl" type="url" placeholder="https://" value="${escapeHtml(gym.bookingUrl || "")}" /></div>
            <div class="field"><label>预约说明</label><input name="bookingNote" value="${escapeHtml(gym.bookingNote || "")}" /></div>
            <div class="field"><label>备注</label><textarea name="notes" rows="3">${escapeHtml(gym.notes || "")}</textarea></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn ghost" data-close-modal>取消</button>
            <button class="btn primary" type="submit">保存</button>
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
          <h3>${item.id ? "编辑课程" : "加一节课"}</h3>
          <div class="fields">
            <div class="field">
              <label>星期</label>
              <select name="day">${DAYS.map((day) => `<option value="${day.id}" ${item.day === day.id ? "selected" : ""}>${day.full}</option>`).join("")}</select>
            </div>
            <div class="field"><label>课程名</label><input name="name" required value="${escapeHtml(item.name || "")}" /></div>
            <div class="two">
              <div class="field"><label>开始</label><input name="start" type="time" required value="${escapeHtml(item.start || "19:00")}" /></div>
              <div class="field"><label>结束</label><input name="end" type="time" required value="${escapeHtml(item.end || "20:00")}" /></div>
            </div>
            <div class="two">
              <div class="field"><label>教练</label><input name="instructor" value="${escapeHtml(item.instructor || "")}" /></div>
              <div class="field"><label>备注</label><input name="note" value="${escapeHtml(item.note || "")}" /></div>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn ghost" data-close-modal>取消</button>
            <button class="btn primary" type="submit">保存</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderBulkModal(modal) {
    return `
      <div class="modal-backdrop" data-close-modal>
        <form class="modal" id="bulk-form">
          <h3>批量添加 / 替换课表</h3>
          <p class="hint">每行一节课，例如：<br>周一 19:00-20:00 Yoga<br>Tue 7:00pm-8:00pm HIIT | Shaun<br>选择「替换」会先清空这家店的现有课程。</p>
          <div class="fields">
            <div class="field">
              <label>写入方式</label>
              <select name="mode">
                <option value="append">追加到现有课表</option>
                <option value="replace">替换整份课表</option>
              </select>
            </div>
            <div class="field"><label>课程列表</label><textarea name="text" rows="10" required placeholder="Wed 18:30-19:30 Pilates | Levian"></textarea></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn ghost" data-close-modal>取消</button>
            <button class="btn primary" type="submit">写入</button>
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
      state.modal = { type: "gym", gym: { name: "", region: "east", color: "#8b5cf6", whatsapp: "", whatsappLabel: "预约", bookingUrl: "", bookingNote: "", notes: "", classes: [] } };
      render();
    });
    action("export", exportJson);
    action("import", () => file && file.click());
    action("reset", () => {
      if (!confirm("恢复成最初从海报录入的课表？本地修改会丢掉。")) return;
      state.data = structuredClone(seed);
      persist();
      toast("已恢复原始课表");
      render();
    });
    if (file) {
      file.addEventListener("change", async () => {
        const picked = file.files?.[0];
        if (!picked) return;
        try {
          const parsed = JSON.parse(await picked.text());
          if (!parsed?.gyms) throw new Error("missing gyms");
          if (!confirm("导入会替换当前全部课表，确定吗？")) return;
          state.data = parsed;
          persist();
          toast("已导入课表");
          render();
        } catch {
          toast("JSON 格式不对");
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
        if (!confirm(`删除 ${gym.name} 及其全部课程？`)) return;
        state.data.gyms = state.data.gyms.filter((item) => item.id !== gym.id);
        persist();
        toast("已删除门店");
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
        toast("已删除课程");
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
        toast("门店已保存");
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
        toast("课程已保存");
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
          toast("没有读到有效课程");
          return;
        }
        if (form.mode === "replace") gym.classes = [];
        parsed.forEach((item) => gym.classes.push({ id: uid(`${gym.id}-${item.day}`), ...item }));
        persist();
        state.expandedGym = gym.id;
        state.modal = null;
        toast(`${form.mode === "replace" ? "已替换" : "已追加"} ${parsed.length} 节课`);
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
    toast("已导出 JSON");
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  render();
})();
