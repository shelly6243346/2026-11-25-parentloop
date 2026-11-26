/* ParentLoop care board. Sample data only. Note extraction is a fixed set of rules. */
(function (factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.ParentLoop = api;
    var root = document.getElementById("app");
    if (root) api.mount(root);
  }
})(function () {
  "use strict";

  var STORAGE_KEY = "parentloop.demo.v1";
  var PEOPLE = {
    amy: { id: "amy", name: "Amy", role: "Eldest daughter", phone: "(415) 555-0101", tel: "+14155550101", color: "#0e6b5c" },
    ben: { id: "ben", name: "Ben", role: "Son", phone: "(415) 555-0108", tel: "+14155550108", color: "#8a6232" },
    chloe: { id: "chloe", name: "Chloe", role: "Youngest daughter", phone: "(415) 555-0114", tel: "+14155550114", color: "#9c3b2e" }
  };
  var VIEWS = ["today", "profile", "meds", "calendar", "tasks", "notes", "digest"];
  var SLOT_END = { morning: 11, breakfast: 11, dinner: 20, bedtime: 23.5 };
  var SAMPLE_NOTE = [
    "South Bay Endocrine — sample visit note for Grandma Wang",
    "Dr. Priya Shah",
    "",
    "1. Increase metformin from 500 mg twice daily to 500 mg at breakfast and 1000 mg at dinner, starting tomorrow. Recheck A1C in 3 months.",
    "2. Continue lisinopril 10 mg every morning. Hold the dose and call the clinic if systolic blood pressure is under 100.",
    "3. Stop ibuprofen for knee pain. Use acetaminophen 500 mg as needed, no more than 3 times a day.",
    "4. Home tasks: check blood pressure every morning and log it. Weigh once a week. Call the clinic if fasting glucose stays above 180 for three days.",
    "5. Next appointment: follow up in 6 weeks with endocrinology, and get labs one week before. Amy should bring the glucose log.",
    "6. Request a 90-day refill of atorvastatin. About 10 days of tablets are left."
  ].join("\n");

  var state = null;
  var root = null;
  var weekOffset = 0;
  var saveFailed = false;
  var pendingFocus = null;
  var toastTimer = 0;
  var mounted = false;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function iso(date) {
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return date.getFullYear() + "-" + month + "-" + day;
  }

  function parseIso(key) {
    var parts = String(key).split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function addDays(date, count) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
  }

  function startOfWeek(date) {
    var copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var day = copy.getDay();
    var delta = day === 0 ? -6 : 1 - day;
    copy.setDate(copy.getDate() + delta);
    return copy;
  }

  function weekDays(date) {
    var start = startOfWeek(date);
    var days = [];
    for (var i = 0; i < 7; i++) {
      var current = addDays(start, i);
      days.push({
        date: current,
        key: iso(current),
        weekday: i,
        name: current.toLocaleDateString("en-US", { weekday: "short" }),
        longName: current.toLocaleDateString("en-US", { weekday: "long" }),
        label: current.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      });
    }
    return days;
  }

  function formatTime(value) {
    var parts = clockParts(value);
    return parts.clock + " " + parts.suffix;
  }

  function clockParts(value) {
    var bits = String(value || "0:00").split(":");
    var hour = Number(bits[0]);
    var minute = String(Number(bits[1] || 0)).padStart(2, "0");
    return { clock: (hour % 12 || 12) + ":" + minute, suffix: hour >= 12 ? "PM" : "AM" };
  }

  function formatRange(start, end) {
    var a = clockParts(start);
    var b = clockParts(end);
    if (a.suffix === b.suffix) return a.clock + "–" + b.clock + " " + a.suffix;
    return a.clock + " " + a.suffix + "–" + b.clock + " " + b.suffix;
  }

  function formatLong(date) {
    return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  function formatPretty(date) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function toMin(value) {
    var parts = String(value || "0:0").split(":");
    return Number(parts[0]) * 60 + Number(parts[1] || 0);
  }

  function minToTime(mins) {
    var hour = Math.floor(mins / 60);
    var minute = mins % 60;
    return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
  }

  function uid(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-3);
  }

  function personName(id) {
    if (!id || !PEOPLE[id]) return "Unclaimed";
    return PEOPLE[id].name;
  }

  function ownerColor(id) {
    var color = PEOPLE[id] && PEOPLE[id].color;
    return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#0e6b5c";
  }

  function curatedLog() {
    return {
      lisinopril: { morning: "taken" },
      metformin: { breakfast: "taken", dinner: "due" },
      vitamind: { morning: "missed" },
      atorvastatin: { bedtime: "due" }
    };
  }

  function task(id, title, owner, status, due, area) {
    return { id: id, title: title, owner: owner, status: status, due: due, area: area, fromNote: false };
  }

  function createSeed(now) {
    now = now || new Date();
    var key = iso(now);
    var log = {};
    log[key] = curatedLog();
    return {
      version: 1,
      viewer: "amy",
      parent: {
        name: "Grandma Wang",
        legalName: "Mei Lin Wang",
        age: 78,
        dob: "March 14, 1948",
        bloodType: "A+",
        languages: "Mandarin and English",
        address: "418 Cedar Lane, Apt 2, Sunnyvale, CA 94086",
        hospital: "El Camino Hospital (sample)",
        circle: "Amy lives nearby in Sunnyvale. Ben is about 40 minutes away in San Jose. Chloe is in Seattle and covers remote check-ins plus monthly visits.",
        conditions: ["Type 2 diabetes", "Hypertension", "Osteoarthritis in both knees", "Mild memory changes"],
        allergies: ["Penicillin", "Shellfish"],
        insurance: {
          primary: "Medicare Part B (sample)",
          memberId: "SAMPLE-MC-2048",
          supplemental: "Sample Medigap Plan G",
          pharmacyPlan: "Sample Part D",
          pharmacy: "Bay Pharmacy",
          pharmacyPhone: "(650) 555-0160"
        },
        doctors: [
          { name: "Dr. Elena Chen", specialty: "Primary care", clinic: "Cedar Family Medicine", phone: "(650) 555-0142", tel: "+16505550142" },
          { name: "Dr. Marcus Hale", specialty: "Cardiology", clinic: "Bay Heart Clinic", phone: "(650) 555-0177", tel: "+16505550177" },
          { name: "Dr. Priya Shah", specialty: "Endocrinology", clinic: "South Bay Endocrine", phone: "(408) 555-0190", tel: "+14085550190" }
        ],
        contacts: [
          { name: "Amy Wang", relation: "Daughter, eldest", phone: "(415) 555-0101", tel: "+14155550101" },
          { name: "Ben Wang", relation: "Son", phone: "(415) 555-0108", tel: "+14155550108" },
          { name: "Chloe Wang", relation: "Daughter, youngest", phone: "(415) 555-0114", tel: "+14155550114" },
          { name: "Linda Ortega", relation: "Neighbor", phone: "(650) 555-0199", tel: "+16505550199" }
        ]
      },
      meds: [
        { id: "lisinopril", name: "Lisinopril", dose: "10 mg", instructions: "Every morning. Hold and call the clinic if systolic blood pressure is under 100.", slots: ["morning"], refillDays: 18, pharmacy: "Bay Pharmacy", prescriber: "Dr. Elena Chen", prn: false },
        { id: "metformin", name: "Metformin", dose: "500 mg", instructions: "With food at breakfast and dinner.", slots: ["breakfast", "dinner"], refillDays: 6, pharmacy: "Bay Pharmacy", prescriber: "Dr. Priya Shah", prn: false },
        { id: "vitamind", name: "Vitamin D", dose: "1000 IU", instructions: "With breakfast.", slots: ["morning"], refillDays: 40, pharmacy: "Bay Pharmacy", prescriber: "Dr. Elena Chen", prn: false },
        { id: "atorvastatin", name: "Atorvastatin", dose: "20 mg", instructions: "At bedtime.", slots: ["bedtime"], refillDays: 11, pharmacy: "Bay Pharmacy", prescriber: "Dr. Marcus Hale", prn: false, recentMiss: "Sample: the bedtime dose was missed yesterday." },
        { id: "acetaminophen", name: "Acetaminophen", dose: "500 mg", instructions: "As needed for knee pain. No more than 3 times a day.", slots: [], refillDays: null, pharmacy: "Over the counter", prescriber: "Dr. Elena Chen", prn: true }
      ],
      medLog: log,
      events: [
        { id: "e1", title: "Morning visit", kind: "visit", owner: "amy", weekday: 0, start: "09:00", end: "12:00", place: "Home" },
        { id: "e2", title: "Cardiology with Dr. Hale", kind: "appointment", owner: "ben", weekday: 0, start: "10:00", end: "11:00", place: "Bay Heart Clinic" },
        { id: "e3", title: "Pharmacy refill pickup", kind: "visit", owner: "chloe", weekday: 1, start: "16:00", end: "16:40", place: "Bay Pharmacy" },
        { id: "e4", title: "Evening visit", kind: "visit", owner: "chloe", weekday: 1, start: "17:00", end: "20:00", place: "Home" },
        { id: "e5", title: "Afternoon visit", kind: "visit", owner: "ben", weekday: 3, start: "14:00", end: "18:00", place: "Home" },
        { id: "e6", title: "Endocrinology with Dr. Shah", kind: "appointment", owner: "ben", weekday: 3, start: "15:00", end: "16:00", place: "South Bay Endocrine" },
        { id: "e7", title: "Video call", kind: "visit", owner: "amy", weekday: 4, start: "19:00", end: "19:30", place: "Video" },
        { id: "e8", title: "Morning visit", kind: "visit", owner: "ben", weekday: 5, start: "10:00", end: "13:00", place: "Home" },
        { id: "e9", title: "Morning visit", kind: "visit", owner: "chloe", weekday: 5, start: "11:00", end: "14:00", place: "Home" }
      ],
      extraEvents: [],
      tasks: [
        task("t1", "Set up the weekly pill organizer", "amy", "done", "Last week", "Meds"),
        task("t2", "Transfer records to Dr. Chen", "amy", "done", "Last week", "Admin"),
        task("t3", "Pay the pharmacy copay", "amy", "done", "Last week", "Admin"),
        task("t4", "Tell neighbor Linda about the lockbox", "amy", "done", "Last week", "Home"),
        task("t5", "Update the allergy list", "amy", "done", "Last week", "Health"),
        task("t6", "Book endocrinology", "amy", "done", "Last week", "Rides"),
        task("t7", "Buy compression socks", "amy", "done", "Last week", "Home"),
        task("t8", "Install the shower chair", "ben", "done", "Last week", "Home"),
        task("t9", "Drive to last week's lab", "ben", "done", "Last week", "Rides"),
        task("t10", "Pick up vitamin D", "ben", "done", "Last week", "Meds"),
        task("t11", "Cover last Sunday's dinner", "ben", "done", "Last week", "Coverage"),
        task("t12", "Sort the mail and bills", "chloe", "done", "Last week", "Admin"),
        task("t13", "Prep low-sodium soup", "chloe", "done", "Last week", "Home"),
        task("t14", "Post the last dose change in the family chat", "chloe", "done", "Last week", "Admin"),
        task("t15", "Request the metformin refill", "amy", "open", "This week", "Meds"),
        task("t16", "Drive to cardiology on Monday", "ben", "open", "This Monday", "Rides"),
        task("t17", "Cover Wednesday afternoon", "", "open", "Wednesday", "Coverage"),
        task("t18", "Cover Sunday", "", "open", "Sunday", "Coverage"),
        task("t19", "Log blood pressure each morning", "chloe", "open", "This week", "Health"),
        task("t20", "Low-sodium grocery run", "ben", "open", "Saturday", "Home"),
        task("t21", "Photograph the insurance cards", "chloe", "open", "This week", "Admin"),
        task("t22", "Watch fasting glucose and call if it stays over 180", "amy", "open", "Ongoing", "Health")
      ],
      draftNote: "",
      extraction: null,
      ui: { taskFilter: "all" }
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createSeed(new Date());
      var data = JSON.parse(raw);
      if (!data || data.version !== 1 || !data.parent || !Array.isArray(data.meds) || !Array.isArray(data.tasks)) {
        return createSeed(new Date());
      }
      data.extraEvents = data.extraEvents || [];
      data.events = data.events || [];
      data.medLog = data.medLog || {};
      data.draftNote = data.draftNote || "";
      data.extraction = data.extraction || null;
      data.ui = { taskFilter: data.ui && data.ui.taskFilter === "mine" ? "mine" : "all" };
      if (!PEOPLE[data.viewer]) data.viewer = "amy";
      return data;
    } catch (err) {
      return createSeed(new Date());
    }
  }

  function persist() {
    try {
      var copy = JSON.parse(JSON.stringify(state));
      copy.ui = { taskFilter: state.ui && state.ui.taskFilter === "mine" ? "mine" : "all" };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
      saveFailed = false;
      return true;
    } catch (err) {
      saveFailed = true;
      return false;
    }
  }

  function ensureToday(now) {
    var key = iso(now);
    if (!state.medLog[key]) {
      state.medLog[key] = curatedLog();
      return true;
    }
    return false;
  }

  function slotHasPassed(slot, now) {
    var end = SLOT_END[slot];
    if (end == null) return false;
    var hour = now.getHours() + now.getMinutes() / 60;
    return hour >= end;
  }

  function displayStatus(current, medId, slot, now) {
    var key = iso(now);
    var slotMap = current.medLog && current.medLog[key] && current.medLog[key][medId];
    var stored = slotMap && slotMap[slot] ? slotMap[slot] : "due";
    if (stored === "taken" || stored === "missed") return stored;
    if (slotHasPassed(slot, now)) return "missed";
    return "due";
  }

  function slotLabel(slot) {
    if (slot === "breakfast") return "Breakfast";
    if (slot === "dinner") return "Dinner";
    if (slot === "bedtime") return "Bedtime";
    return "Morning";
  }

  function slotGroup(slot) {
    if (slot === "dinner") return "Dinner";
    if (slot === "bedtime") return "Bedtime";
    return "Morning";
  }

  function doseItems(current) {
    var items = [];
    current.meds.forEach(function (med) {
      if (med.stopped) return;
      (med.slots || []).forEach(function (slot) {
        items.push({ med: med, slot: slot, group: slotGroup(slot) });
      });
    });
    var order = { Morning: 0, Dinner: 1, Bedtime: 2 };
    items.sort(function (a, b) {
      if (order[a.group] !== order[b.group]) return order[a.group] - order[b.group];
      return toMin(a.slot === "bedtime" ? "21:00" : "08:00") - toMin("08:00");
    });
    return items;
  }

  function doseSummary(current, now) {
    var counts = { taken: 0, missed: 0, due: 0 };
    doseItems(current).forEach(function (item) {
      counts[displayStatus(current, item.med.id, item.slot, now)] += 1;
    });
    return counts;
  }

  function eventsFor(current, date) {
    var weekday = (date.getDay() + 6) % 7;
    var key = iso(date);
    var weekly = (current.events || []).filter(function (event) {
      return event.weekday === weekday && !event.date;
    });
    var extra = (current.extraEvents || []).filter(function (event) {
      return event.date === key;
    });
    return weekly.concat(extra).sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
  }

  function overlaps(a, b) {
    return toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
  }

  function conflictPairs(events) {
    var pairs = [];
    for (var i = 0; i < events.length; i++) {
      for (var j = i + 1; j < events.length; j++) {
        if (events[i].owner !== events[j].owner && overlaps(events[i], events[j])) {
          pairs.push({
            a: events[i],
            b: events[j],
            start: Math.max(toMin(events[i].start), toMin(events[j].start)),
            end: Math.min(toMin(events[i].end), toMin(events[j].end))
          });
        }
      }
    }
    return pairs;
  }

  function dayStatus(events) {
    if (!events.length) return "uncovered";
    if (conflictPairs(events).length) return "conflict";
    return "covered";
  }

  function bundleNote(events) {
    for (var i = 0; i < events.length; i++) {
      for (var j = i + 1; j < events.length; j++) {
        if (events[i].owner === events[j].owner && overlaps(events[i], events[j])) {
          return personName(events[i].owner) + " has the visit and the appointment in the same window.";
        }
      }
    }
    return "";
  }

  function describeDay(events) {
    var status = dayStatus(events);
    if (status === "uncovered") return { status: status, text: "No sibling is scheduled." };
    if (status === "conflict") {
      var pair = conflictPairs(events)[0];
      var names = personName(pair.a.owner) + " and " + personName(pair.b.owner);
      return {
        status: status,
        text: names + " overlap " + formatTime(minToTime(pair.start)) + "–" + formatTime(minToTime(pair.end)) + "."
      };
    }
    var bundled = bundleNote(events);
    if (bundled) return { status: status, text: bundled };
    var names = [];
    events.forEach(function (event) {
      var name = personName(event.owner);
      if (names.indexOf(name) === -1) names.push(name);
    });
    return { status: status, text: "Covered by " + names.join(" and ") + "." };
  }

  function statusLabel(status) {
    if (status === "conflict") return "Conflict";
    if (status === "uncovered") return "Uncovered";
    return "Covered";
  }

  function balanceModel(current) {
    var rows = ["amy", "ben", "chloe"].map(function (id) {
      return {
        id: id,
        name: PEOPLE[id].name,
        done: current.tasks.filter(function (item) { return item.owner === id && item.status === "done"; }).length,
        open: current.tasks.filter(function (item) { return item.owner === id && item.status === "open"; }).length
      };
    });
    var max = 0;
    rows.forEach(function (row) { if (row.done > max) max = row.done; });
    var leaders = max > 0 ? rows.filter(function (row) { return row.done === max; }) : [];
    var sentence = "No finished tasks yet.";
    if (leaders.length === 1) sentence = leaders[0].name + " has finished the most tasks.";
    if (leaders.length > 1) {
      var names = leaders.map(function (row) { return row.name; });
      var label = names.length === 2 ? names.join(" and ") : names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
      sentence = label + " are tied for the most finished tasks.";
    }
    return { rows: rows, max: max, leaders: leaders, sentence: sentence };
  }

  function refillAlerts(current) {
    return current.meds.filter(function (med) {
      return !med.stopped && med.refillDays != null && med.refillDays <= 10 && !med.refillRequested;
    });
  }

  function weekStats(current, now) {
    var days = weekDays(now);
    var conflicts = 0;
    var gaps = 0;
    days.forEach(function (day) {
      var status = dayStatus(eventsFor(current, day.date));
      if (status === "conflict") conflicts += 1;
      if (status === "uncovered") gaps += 1;
    });
    return { conflicts: conflicts, gaps: gaps, total: conflicts + gaps };
  }

  function chunksFrom(text) {
    return String(text || "")
      .split(/\n+/)
      .reduce(function (list, line) {
        return list.concat(line.split(/(?<=\.)\s+(?=[A-Z])/));
      }, [])
      .map(function (chunk) {
        return chunk
          .replace(/^\s*\d+[\.\)]\s*/, "")
          .replace(/^[-*]\s*/, "")
          .replace(/^home tasks:\s*/i, "")
          .trim();
      })
      .filter(Boolean);
  }

  function classify(chunk) {
    var medWord = /metformin|lisinopril|atorvastatin|acetaminophen|ibuprofen|vitamin d|statin/i;
    var changeWord = /\b(increase|decrease|stop|start|continue|hold|switch)\b/i;
    var doseWord = /\bmg\b|\bas needed\b/i;
    var todoWord = /\b(check|log|weigh|call|bring|request|recheck|monitor|refill)\b/i;
    if (/next appointment|follow-?up|follow up/i.test(chunk)) return "appointment";
    if (medWord.test(chunk) && (changeWord.test(chunk) || doseWord.test(chunk))) return "med";
    if (todoWord.test(chunk)) return "todo";
    return "";
  }

  function extractNote(text) {
    var todos = [];
    var medChanges = [];
    var appointments = [];
    var seen = {};
    chunksFrom(text).forEach(function (chunk) {
      var key = chunk.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      var kind = classify(chunk);
      if (kind === "appointment") appointments.push(chunk);
      else if (kind === "med") medChanges.push(chunk);
      else if (kind === "todo") todos.push(chunk);
    });
    return { todos: todos, medChanges: medChanges, appointments: appointments };
  }

  function buildDigest(current, now) {
    var days = weekDays(now);
    var lines = [];
    lines.push("ParentLoop weekly digest — " + current.parent.name);
    lines.push("Sample data · week of " + days[0].label);
    lines.push("");
    lines.push("Coverage");
    days.forEach(function (day) {
      var events = eventsFor(current, day.date);
      var info = describeDay(events);
      var detail = events.map(function (event) {
        return formatTime(event.start) + " " + event.title + " (" + personName(event.owner) + ")";
      }).join("; ");
      lines.push("- " + day.longName + ": " + statusLabel(info.status).toUpperCase() + " — " + (detail || info.text));
    });
    lines.push("");
    lines.push("Medications today");
    doseItems(current).forEach(function (item) {
      var status = displayStatus(current, item.med.id, item.slot, now);
      lines.push("- " + item.med.name + " " + item.med.dose + " (" + slotLabel(item.slot) + "): " + status);
    });
    current.meds.forEach(function (med) {
      if (med.recentMiss) lines.push("- " + med.recentMiss);
    });
    lines.push("");
    lines.push("Refill reminders");
    current.meds.filter(function (med) { return med.refillDays != null && !med.stopped; })
      .slice()
      .sort(function (a, b) { return a.refillDays - b.refillDays; })
      .forEach(function (med) {
        lines.push("- " + med.name + ": " + med.refillDays + " days left" + (med.refillRequested ? " (refill requested)" : "") + " at " + med.pharmacy);
      });
    var changes = current.meds.filter(function (med) { return med.changeNote || med.stopped; });
    if (changes.length) {
      lines.push("");
      lines.push("Medication notes");
      changes.forEach(function (med) {
        lines.push("- " + (med.stopped ? "Stopped: " : "") + med.name + (med.changeNote ? " — " + med.changeNote : ""));
      });
    }
    var open = current.tasks.filter(function (item) { return item.status === "open"; });
    var balance = balanceModel(current);
    lines.push("");
    lines.push("Open tasks (" + open.length + ")");
    open.forEach(function (item) {
      lines.push("- " + item.title + " — " + personName(item.owner));
    });
    lines.push(balance.sentence + " Finished: " + balance.rows.map(function (row) {
      return row.name + " " + row.done;
    }).join(", ") + ".");
    var gaps = days.filter(function (day) { return dayStatus(eventsFor(current, day.date)) === "uncovered"; });
    var clashes = days.filter(function (day) { return dayStatus(eventsFor(current, day.date)) === "conflict"; });
    if (gaps.length || clashes.length) {
      lines.push("");
      if (gaps.length) lines.push("Open coverage: " + gaps.map(function (day) { return day.longName; }).join(" and ") + ".");
      if (clashes.length) lines.push("Conflicts to settle: " + clashes.map(function (day) { return day.longName; }).join(" and ") + ".");
    }
    var later = (current.extraEvents || []).filter(function (event) {
      return event.fromNote && event.date > days[6].key;
    });
    if (later.length) {
      lines.push("");
      lines.push("Later appointments from notes");
      later.forEach(function (event) {
        lines.push("- " + formatPretty(parseIso(event.date)) + ": " + event.title + " (" + personName(event.owner) + ")");
      });
    }
    lines.push("");
    lines.push("Sample data only. Not a medical record.");
    return lines.join("\n");
  }

  function icon(path) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + "</svg>";
  }

  var ICONS = {
    today: icon('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/>'),
    profile: icon('<circle cx="12" cy="8" r="3"/><path d="M5 19c1.5-3 3.8-4.5 7-4.5S17.5 16 19 19"/>'),
    meds: icon('<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M8 7V6a4 4 0 0 1 8 0v1M12 11v5M9.5 13.5h5"/>'),
    calendar: icon('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 10h16M8 14h2M12 14h2M16 14h0"/>'),
    tasks: icon('<path d="M9 7h11M9 12h11M9 17h11"/><path d="M4.5 7l1.2 1.2L7.5 6M4.5 12l1.2 1.2L7.5 11M4.5 17l1.2 1.2L7.5 16"/>'),
    notes: icon('<path d="M7 3.5h8l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M15 3.5V8h5M8 12h8M8 16h6"/>'),
    digest: icon('<path d="M5 6h14M5 10h14M5 14h9"/><path d="M5 18h6"/>')
  };

  function currentView() {
    var hash = (location.hash || "").replace("#", "");
    if (hash === "emergency") return "profile";
    return VIEWS.indexOf(hash) >= 0 ? hash : "today";
  }

  function pageTitle(view) {
    return {
      today: "Today",
      profile: "Profile",
      meds: "Medications",
      calendar: "Calendar",
      tasks: "Tasks",
      notes: "Note extractor",
      digest: "Weekly digest"
    }[view] || "Today";
  }

  function logoMark() {
    return '<svg class="logo-mark" viewBox="0 0 40 40" width="32" height="32" aria-hidden="true"><rect width="40" height="40" rx="12" fill="#0e6b5c"/><path d="M11.5 25.5c1.2-7.2 5.6-12 10.8-12 5.6 0 8.7 3.6 8.7 8.2 0 4.8-3.4 8.1-7.8 9" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/><circle cx="12.2" cy="25.2" r="2.1" fill="#f3d7a4"/><circle cx="22.2" cy="13.2" r="2.1" fill="#fff"/><circle cx="30.2" cy="21.2" r="2.1" fill="#f3b8a8"/></svg>';
  }

  function viewerOptions(selected) {
    return ["amy", "ben", "chloe"].map(function (id) {
      return '<option value="' + id + '"' + (id === selected ? " selected" : "") + ">" + esc(PEOPLE[id].name) + "</option>";
    }).join("");
  }

  function ownerOptions(selected) {
    var options = [{ id: "", name: "Unclaimed" }].concat(["amy", "ben", "chloe"].map(function (id) {
      return { id: id, name: PEOPLE[id].name };
    }));
    return options.map(function (option) {
      return '<option value="' + option.id + '"' + (option.id === selected ? " selected" : "") + ">" + esc(option.name) + "</option>";
    }).join("");
  }

  function navLink(view, active, label, badge) {
    var current = view === active ? ' aria-current="page" class="nav-link is-active"' : ' class="nav-link"';
    var count = badge ? '<span class="nav-badge">' + badge + "</span>" : "";
    return '<a href="#' + view + '"' + current + ">" + (ICONS[view] || "") + "<span>" + label + "</span>" + count + "</a>";
  }

  function sidebar(view, now) {
    var stats = weekStats(state, now);
    var refills = refillAlerts(state).length;
    var people = ["amy", "ben", "chloe"].map(function (id) {
      var on = state.viewer === id ? " is-on" : "";
      return '<button type="button" class="who' + on + '" data-action="set-viewer" data-who="' + id + '" title="' + esc(PEOPLE[id].name + " · " + PEOPLE[id].role) + '"><span class="avatar" style="background:' + ownerColor(id) + '">' + esc(PEOPLE[id].name.slice(0, 1)) + "</span>" + esc(PEOPLE[id].name) + "</button>";
    }).join("");
    return '<aside class="sidebar"><a class="logo" href="index.html">' + logoMark() + "<span>ParentLoop</span></a><nav class=\"side-nav\" aria-label=\"Care board\">" +
      navLink("today", view, "Today", 0) +
      navLink("profile", view, "Profile", 0) +
      navLink("meds", view, "Medications", refills) +
      navLink("calendar", view, "Calendar", stats.total) +
      navLink("tasks", view, "Tasks", 0) +
      navLink("notes", view, "Note extractor", 0) +
      navLink("digest", view, "Weekly digest", 0) +
      "</nav><div class=\"switcher\"><p>Viewing as</p><div class=\"switcher-row\" role=\"group\" aria-label=\"Demo identity\">" + people + "</div></div><div class=\"side-foot\"><button type=\"button\" class=\"side-action\" data-action=\"emergency-open\">" + ICONS.profile + " Emergency card</button><button type=\"button\" class=\"side-action\" data-action=\"reset-ask\">Reset sample data</button><a href=\"index.html\">Back to website</a></div></aside>";
  }

  function tabbar(view) {
    function tab(hash, label) {
      var on = view === hash ? " is-active" : "";
      return '<a class="' + on.trim() + '" href="#' + hash + '">' + label + "</a>";
    }
    var moreOn = state.ui.more ? " is-active" : "";
    var sheet = state.ui.more ? '<div class="sheet"><a href="#profile">Profile</a><a href="#notes">Note extractor</a><a href="#digest">Weekly digest</a><button type="button" data-action="emergency-open">Emergency card</button><button type="button" data-action="reset-ask">Reset sample data</button><a href="index.html">Back to website</a></div>' : "";
    return sheet + '<nav class="tabbar" aria-label="Mobile">' + tab("today", "Today") + tab("meds", "Meds") + tab("calendar", "Calendar") + tab("tasks", "Tasks") + '<button type="button" class="' + moreOn.trim() + '" data-action="toggle-more">More</button></nav>';
  }

  function meterHtml(model) {
    return '<div class="meter" aria-label="Who is carrying the most">' + model.rows.map(function (row) {
      var width = model.max ? Math.round((row.done / model.max) * 100) : 0;
      var leader = model.leaders.some(function (item) { return item.id === row.id; }) && model.leaders.length === 1;
      return '<div class="meter-row"><span>' + esc(row.name) + '</span><div class="bar" role="img" aria-label="' + esc(row.name) + " finished " + row.done + '"><span style="width:' + width + '%"></span></div><strong>' + row.done + (leader ? " · most" : "") + "</strong></div>";
    }).join("") + "</div>";
  }

  function renderToday(now) {
    var parent = state.parent;
    var days = weekDays(now);
    var counts = doseSummary(state, now);
    var groups = { Morning: "", Dinner: "", Bedtime: "" };
    var shown = {};
    doseItems(state).forEach(function (item) {
      var status = displayStatus(state, item.med.id, item.slot, now);
      var note = "";
      if (item.med.changeNote && !shown[item.med.id]) {
        shown[item.med.id] = true;
        note = '<small class="note-line">From the note: ' + esc(item.med.changeNote) + "</small>";
      }
      var refill = item.med.refillDays != null && item.med.refillDays <= 10 && !item.med.refillRequested ? " · Refill in " + item.med.refillDays + " days" : "";
      groups[item.group] += '<button type="button" class="dose is-' + status + '" data-action="toggle-dose" data-med="' + esc(item.med.id) + '" data-slot="' + esc(item.slot) + '" aria-pressed="' + (status === "taken" ? "true" : "false") + '"><span class="mark"></span><span class="dose-name"><strong>' + esc(item.med.name) + "</strong><small>" + esc(item.med.dose) + " · " + esc(slotLabel(item.slot)) + refill + "</small>" + note + '</span><span class="pill ' + status + '">' + esc(status.charAt(0).toUpperCase() + status.slice(1)) + "</span></button>";
    });
    var checklist = ["Morning", "Dinner", "Bedtime"].map(function (group) {
      if (!groups[group]) return "";
      return '<h3 class="group-label">' + group + "</h3>" + groups[group];
    }).join("");
    var upcoming = [];
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (var i = 0; i < 21 && upcoming.length < 4; i++) {
      var date = addDays(start, i);
      eventsFor(state, date).forEach(function (event) {
        if (upcoming.length < 4) upcoming.push({ event: event, date: date });
      });
    }
    var open = state.tasks.filter(function (item) { return item.status === "open"; })
      .slice()
      .sort(function (a, b) { return (a.owner ? 1 : 0) - (b.owner ? 1 : 0); })
      .slice(0, 4);
    var balance = balanceModel(state);
    var person = PEOPLE[state.viewer];
    var hour = now.getHours();
    var hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    var refills = refillAlerts(state);
    var refillLine = refills.length ? '<p class="note-line">Refill coming up: ' + esc(refills.map(function (med) { return med.name + " in " + med.refillDays + " days"; }).join(", ")) + ".</p>" : "";
    return '<p class="hello">' + hello + ", " + esc(person.name) + ". This is " + esc(parent.name) + '\'s board.</p><p class="identity">Demo identity: ' + esc(person.name) + ", " + esc(person.role.toLowerCase()) + ". Switch it to change My tasks.</p><div class=\"stack\"><section class=\"today-grid\"><article class=\"card parent-card\"><div class=\"card-head\"><div><span class=\"tag\">Sample data</span><h2 style=\"margin-top:8px\">" + esc(parent.name) + ", " + parent.age + "</h2><p class=\"muted\">" + esc(parent.address) + "</p></div></div><div class=\"chips\">" + parent.conditions.map(function (item) { return '<span class="chip">' + esc(item) + "</span>"; }).join("") + "</div><div class=\"chips\">" + parent.allergies.map(function (item) { return '<span class="chip chip-bad">Allergy · ' + esc(item) + "</span>"; }).join("") + '</div><p><a href="#profile">Open the full profile</a></p></article><article class="card"><div class="card-head"><h2>This week</h2><a href="#calendar">Calendar</a></div><div class="strip">' + days.map(function (day) {
      var info = describeDay(eventsFor(state, day.date));
      var today = day.key === iso(now) ? " is-today" : "";
      return '<a class="strip-day is-' + info.status + today + '" href="#calendar"><span>' + esc(day.name) + "</span><strong>" + day.date.getDate() + "</strong><em>" + statusLabel(info.status) + "</em></a>";
    }).join("") + "</div></article></section><section class=\"card\"><div class=\"card-head\"><div><h2>Today's medications</h2><p class=\"muted\">Sample statuses are filled in so taken, missed, and still due are all visible. Tap a dose to change it.</p></div><p class=\"fine\">" + counts.taken + " taken · " + counts.missed + " missed · " + counts.due + " still due</p></div>" + refillLine + checklist + "</section><section class=\"split\"><article class=\"card\"><div class=\"card-head\"><h2>Coming up</h2><a href=\"#calendar\">See the week</a></div>" + (upcoming.length ? upcoming.map(function (item) {
      return '<p><strong>' + esc(formatPretty(item.date)) + "</strong> · " + esc(formatTime(item.event.start)) + " " + esc(item.event.title) + " · " + esc(personName(item.event.owner)) + "</p>";
    }).join("") : "<p>Nothing is scheduled.</p>") + '</article><article class="card"><div class="card-head"><h2>Who is carrying the most</h2><a href="#tasks">Task board</a></div><p>' + esc(balance.sentence) + "</p>" + meterHtml(balance) + "<h3 class=\"group-label\">Open</h3>" + open.map(function (item) {
      return "<p><strong>" + esc(item.title) + "</strong><br><span class=\"muted\">" + esc(personName(item.owner)) + " · " + esc(item.due) + "</span></p>";
    }).join("") + "</article></section><p class=\"fine\">Sample data stays in this browser. Reset sample data puts the Wang family back. The waitlist on the website is stored separately.</p></div>";
  }

  function renderProfile() {
    var parent = state.parent;
    var insurance = parent.insurance;
    return '<div class="stack"><article class="card"><span class="tag">Sample data</span><h2 style="font-family:var(--serif);font-size:36px;margin-top:8px">' + esc(parent.name) + "</h2><p class=\"muted\">" + esc(parent.legalName) + " · " + parent.age + "</p><p>" + esc(parent.circle) + "</p><dl class=\"kv\"><dt>Date of birth</dt><dd>" + esc(parent.dob) + "</dd><dt>Blood type</dt><dd>" + esc(parent.bloodType) + "</dd><dt>Languages</dt><dd>" + esc(parent.languages) + "</dd><dt>Address</dt><dd>" + esc(parent.address) + "</dd><dt>Preferred hospital</dt><dd>" + esc(parent.hospital) + "</dd></dl></article><section class=\"split\"><article class=\"card\"><h2>Conditions</h2><div class=\"chips\">" + parent.conditions.map(function (item) { return '<span class="chip">' + esc(item) + "</span>"; }).join("") + '</div><h2 style="margin-top:16px">Allergies</h2><div class="chips">' + parent.allergies.map(function (item) { return '<span class="chip chip-bad">' + esc(item) + "</span>"; }).join("") + '</div></article><article class="card"><h2>Doctors</h2>' + parent.doctors.map(function (doctor) {
      return '<p><strong>' + esc(doctor.name) + "</strong><br>" + esc(doctor.specialty) + " · " + esc(doctor.clinic) + '<br><a href="tel:' + esc(doctor.tel) + '">' + esc(doctor.phone) + "</a></p>";
    }).join("") + "</article></section><article class=\"card\"><h2>Insurance</h2><dl class=\"kv\"><dt>Primary</dt><dd>" + esc(insurance.primary) + "</dd><dt>Member ID</dt><dd class=\"mono\">" + esc(insurance.memberId) + "</dd><dt>Supplemental</dt><dd>" + esc(insurance.supplemental) + "</dd><dt>Pharmacy plan</dt><dd>" + esc(insurance.pharmacyPlan) + "</dd><dt>Pharmacy</dt><dd>" + esc(insurance.pharmacy) + " · " + esc(insurance.pharmacyPhone) + "</dd></dl></article><article class=\"card\"><h2>Emergency contacts</h2><div class=\"contact-grid\">" + parent.contacts.map(function (contact) {
      return '<a class="contact-call" href="tel:' + esc(contact.tel) + '"><strong>' + esc(contact.name) + "</strong><span>" + esc(contact.relation) + "</span><em>" + esc(contact.phone) + "</em></a>";
    }).join("") + '</div><p style="margin-top:16px"><button type="button" class="btn btn-danger" data-action="emergency-open">Open emergency card</button></p></article></div>';
  }

  function renderMeds(now) {
    var counts = doseSummary(state, now);
    var body = renderTodayChecklist(now);
    var refills = state.meds.filter(function (med) { return med.refillDays != null && !med.stopped; })
      .slice()
      .sort(function (a, b) {
        if (!!a.refillRequested !== !!b.refillRequested) return a.refillRequested ? 1 : -1;
        return a.refillDays - b.refillDays;
      });
    var stopped = state.meds.filter(function (med) { return med.stopped; });
    var prn = state.meds.filter(function (med) { return med.prn && !med.stopped; });
    return '<div class="stack"><section class="card"><div class="card-head"><div><span class="tag">Sample data</span><h2 style="margin-top:8px">Today\'s checklist</h2><p class="muted">Sample statuses are filled in so taken, missed, and still due are all visible. Tap a dose to change it. A dose still due after its time of day shows as missed.</p></div><p class="fine">' + counts.taken + " taken · " + counts.missed + " missed · " + counts.due + " still due</p></div>" + body + "</section><section class=\"card\"><h2>Refill reminders</h2>" + refills.map(function (med) {
      var soon = med.refillDays <= 10 && !med.refillRequested;
      var action = med.refillRequested ? '<span class="pill taken">Refill requested</span>' : '<button type="button" class="btn btn-small btn-secondary" data-action="request-refill" data-med="' + esc(med.id) + '">Mark refill requested</button>';
      return '<div class="refill' + (soon ? " is-soon" : "") + '"><div><strong>' + esc(med.name) + "</strong><br><span class=\"muted\">" + med.refillDays + " days left · " + esc(med.pharmacy) + " · " + esc(state.parent.insurance.pharmacyPhone) + "</span>" + (med.changeNote ? '<div class="note-line">' + esc(med.changeNote) + "</div>" : "") + "</div>" + action + "</div>";
    }).join("") + "</section>" + (prn.length ? '<section class="card"><h2>As needed</h2>' + prn.map(function (med) {
      return "<p><strong>" + esc(med.name) + " " + esc(med.dose) + "</strong><br><span class=\"muted\">" + esc(med.instructions) + "</span></p>";
    }).join("") + "</section>" : "") + (stopped.length ? '<section class="card"><h2>Stopped</h2>' + stopped.map(function (med) {
      return '<div class="stopped"><strong>Do not give ' + esc(med.name) + "</strong><p>" + esc(med.changeNote || med.instructions) + "</p></div>";
    }).join("") + "</section>" : "") + "</div>";
  }

  function renderTodayChecklist(now) {
    var groups = { Morning: "", Dinner: "", Bedtime: "" };
    doseItems(state).forEach(function (item) {
      var status = displayStatus(state, item.med.id, item.slot, now);
      groups[item.group] += '<button type="button" class="dose is-' + status + '" data-action="toggle-dose" data-med="' + esc(item.med.id) + '" data-slot="' + esc(item.slot) + '" aria-pressed="' + (status === "taken" ? "true" : "false") + '"><span class="mark"></span><span class="dose-name"><strong>' + esc(item.med.name) + "</strong><small>" + esc(item.med.dose + " · " + item.med.instructions) + '</small></span><span class="pill ' + status + '">' + esc(status.charAt(0).toUpperCase() + status.slice(1)) + "</span></button>";
    });
    return ["Morning", "Dinner", "Bedtime"].map(function (group) {
      if (!groups[group]) return "";
      return '<h3 class="group-label">' + group + "</h3>" + groups[group];
    }).join("");
  }

  function renderCalendar(now) {
    var viewed = addDays(now, weekOffset * 7);
    var days = weekDays(viewed);
    var outside = (state.extraEvents || []).filter(function (event) {
      return days.every(function (day) { return day.key !== event.date; });
    });
    var columns = days.map(function (day) {
      var events = eventsFor(state, day.date);
      var info = describeDay(events);
      var today = day.key === iso(now) ? " is-today" : "";
      var cards = events.map(function (event) {
        return '<article class="event" style="--owner:' + ownerColor(event.owner) + '"><p><strong>' + esc(formatRange(event.start, event.end)) + "</strong> · " + esc(personName(event.owner)) + '</p><p>' + esc(event.title) + "</p><small>" + esc(event.place || "") + " · " + (event.date ? "This date" : "Weekly") + '</small><p><button type="button" class="btn btn-small btn-secondary" data-action="remove-event" data-id="' + esc(event.id) + '">Remove</button></p></article>';
      }).join("");
      var cover = info.status === "uncovered" ? '<button type="button" class="btn btn-small btn-primary" data-action="cover-day" data-date="' + day.key + "\">I'll cover this day</button>" : "";
      return '<article class="day-col is-' + info.status + today + '"><header class="day-head"><div><strong>' + esc(day.name) + "</strong><br><span class=\"muted\">" + esc(day.label) + '</span></div><span class="pill ' + info.status + '">' + statusLabel(info.status) + '</span></header><p class="day-help">' + esc(info.text) + "</p>" + cards + cover + "</article>";
    }).join("");
    var jumps = outside.length ? '<div class="callout"><strong>Appointments outside this week</strong><div class="jump-list">' + outside.map(function (event) {
      return '<div class="row"><span>' + esc(formatPretty(parseIso(event.date))) + " · " + esc(event.title) + "</span><button type=\"button\" class=\"btn btn-small btn-secondary\" data-action=\"goto-date\" data-date=\"" + esc(event.date) + "\">Show week</button></div>";
    }).join("") + "</div></div>" : "";
    return '<div class="stack"><p class="muted">Sample visits are tied to weekdays, so Monday\'s conflict and the uncovered days show every week. Covering a day, or an appointment added from a note, is saved on that date.</p><div class="week-nav"><button type="button" class="btn btn-small btn-secondary" data-action="week-prev">Previous week</button><button type="button" class="btn btn-small btn-secondary" data-action="week-today">This week</button><button type="button" class="btn btn-small btn-secondary" data-action="week-next">Next week</button><strong>' + esc(days[0].label) + " – " + esc(days[6].label) + "</strong></div><p class=\"legend\"><span><i style=\"background:#1d6b45\"></i>Covered</span><span><i style=\"background:#8f1d24\"></i>Conflict</span><span><i style=\"background:#8a5a12\"></i>Uncovered</span><span><i style=\"background:#0e6b5c\"></i>Amy</span><span><i style=\"background:#8a6232\"></i>Ben</span><span><i style=\"background:#9c3b2e\"></i>Chloe</span></p>" + jumps + '<div class="week-grid">' + columns + "</div></div>";
  }

  function renderTasks() {
    var filter = state.ui.taskFilter === "mine" ? "mine" : "all";
    var balance = balanceModel(state);
    var columns = filter === "mine" ? [state.viewer] : ["amy", "ben", "chloe", ""];
    var board = columns.map(function (owner) {
      var items = state.tasks.filter(function (item) { return item.owner === owner; })
        .slice()
        .sort(function (a, b) { return (a.status === "done") - (b.status === "done"); });
      var title = owner ? PEOPLE[owner].name : "Unclaimed";
      var cards = items.length ? items.map(function (item) {
        return '<article class="task' + (item.status === "done" ? " is-done" : "") + '"><div class="task-top"><button type="button" class="check' + (item.status === "done" ? " is-on" : "") + '" data-action="task-toggle" data-id="' + esc(item.id) + '" aria-pressed="' + (item.status === "done") + '" aria-label="' + esc((item.status === "done" ? "Reopen " : "Mark done ") + item.title) + '"></button><div><h3>' + esc(item.title) + '</h3><span class="tag">' + esc(item.area) + "</span> <span class=\"muted\">" + esc(item.due) + "</span></div></div><label class=\"field\" style=\"margin-top:8px\">Assign<select data-action=\"task-owner\" data-id=\"" + esc(item.id) + '">' + ownerOptions(item.owner) + "</select></label></article>";
      }).join("") : '<p class="muted">Nothing in this column.</p>';
      return '<section class="column"><h3>' + esc(title) + "</h3>" + cards + "</section>";
    }).join("");
    return '<div class="stack"><section class="card"><span class="tag">Sample data</span><div class="card-head" style="margin-top:8px"><div><h2>Who is carrying the most</h2><p>' + esc(balance.sentence) + "</p></div></div>" + meterHtml(balance) + '<p class="fine">Bars count finished tasks, including the sample history. Checking a task updates the meter.</p></section><div class="row"><div class="segmented" role="group" aria-label="Task filter"><button type="button" data-action="task-filter" data-filter="all" class="' + (filter === "all" ? "is-on" : "") + '" aria-pressed="' + (filter === "all") + '">All tasks</button><button type="button" data-action="task-filter" data-filter="mine" class="' + (filter === "mine" ? "is-on" : "") + '" aria-pressed="' + (filter === "mine") + '">My tasks</button></div><p class="muted">My tasks follows the sibling selected under Viewing as (' + esc(PEOPLE[state.viewer].name) + ").</p></div><div class=\"board\">" + board + "</div></div>";
  }

  function alreadyTask(title) {
    return state.tasks.some(function (item) { return item.title === title; });
  }

  function alreadyMed(text) {
    return state.meds.some(function (med) { return med.changeNote === text; });
  }

  function alreadyAppt(text) {
    return (state.extraEvents || []).some(function (event) { return event.notes === text; });
  }

  function renderNotes() {
    var extraction = state.extraction;
    var stale = extraction && extraction.sourceText !== state.draftNote;
    var blocks = "";
    if (extraction) {
      blocks = '<div class="callout"><strong>' + extraction.todos.length + " to-dos · " + extraction.medChanges.length + " medication changes · " + extraction.appointments.length + " appointment" + (extraction.appointments.length === 1 ? "" : "s") + "</strong>" + (stale ? "<p>The note has changed since this extraction. Choose Extract again.</p>" : "<p>Review the matches, then add the ones you want on the board.</p>") + "</div>" +
        renderExtractList("To-dos", extraction.todos, "add-todo", "Add all to-dos", "add-all-todos", alreadyTask) +
        renderExtractList("Medication changes", extraction.medChanges, "add-med", "Add medication changes", "add-all-meds", alreadyMed) +
        renderExtractList("Next appointment", extraction.appointments, "add-appt", "Add to calendar", "add-all-appts", alreadyAppt);
    }
    return '<div class="stack"><div class="callout"><strong>Rules written for this demo, not a live model.</strong><p>ParentLoop reads the note with a fixed set of rules in this browser. It does not call an AI service and it does not need an API key.</p></div><section class="notes-grid"><div class="card"><label class="field" for="note-input">Doctor\'s instructions<textarea id="note-input" placeholder="Paste an after-visit note here.">' + esc(state.draftNote) + '</textarea></label><div class="hero-actions"><button type="button" class="btn btn-secondary" data-action="load-sample">Load sample doctor\'s note</button><button type="button" class="btn btn-primary" data-action="extract-note">Extract</button></div><details><summary>How this demo reads a note</summary><ul class="rule-list"><li>A line about a next appointment or a follow-up becomes an appointment.</li><li>A line that names a medicine and a change, a dose in mg, or “as needed” becomes a medication change.</li><li>A line that says check, log, weigh, call, bring, request, recheck, monitor, or refill becomes a to-do.</li><li>Other lines are left out on purpose.</li></ul></details></div><div class="card"><h2>Extracted from the note</h2>' + (blocks || '<p class="muted">Nothing extracted yet. Load the sample note, or paste your own, then choose Extract.</p>') + "</div></section></div>";
  }

  function renderExtractList(title, items, action, allLabel, allAction, exists) {
    if (!items.length) {
      return '<div class="extract-block"><h3>' + title + '</h3><p class="muted">No matches.</p></div>';
    }
    return '<div class="extract-block"><div class="row"><h3>' + title + '</h3><button type="button" class="btn btn-small btn-primary" data-action="' + allAction + '">' + allLabel + '</button></div>' + items.map(function (item) {
      var done = exists(item);
      return '<div class="extract-item"><span>' + esc(item) + '</span><button type="button" class="btn btn-small btn-secondary" data-action="' + action + '" data-text="' + esc(item) + '"' + (done ? " disabled" : "") + ">" + (done ? "Added" : "Add") + "</button></div>";
    }).join("") + "</div>";
  }

  function renderDigest(now) {
    var text = buildDigest(state, now);
    var balance = balanceModel(state);
    return '<div class="stack"><div class="digest-layout"><section class="card"><div class="card-head"><div><span class="tag">Sample data</span><h2 style="margin-top:8px">Family chat preview</h2><p class="muted">Generated from the board you see now. Copy it into the family group chat.</p></div><button type="button" class="btn btn-primary" data-action="copy-digest">Copy for group chat</button></div><pre class="digest-pre" id="digest-text" tabindex="0">' + esc(text) + '</pre></section><aside class="card"><h2>What is included</h2><ul class="rule-list"><li>This week\'s coverage, including conflicts and uncovered days</li><li>Today\'s taken, missed, and due doses</li><li>Refill reminders</li><li>Open tasks and who has finished the most</li><li>Appointments added from a note, when they fall later</li></ul><h2 style="margin-top:18px">Who is carrying the most</h2><p>' + esc(balance.sentence) + "</p>" + meterHtml(balance) + "</aside></div></div>";
  }

  function emergencyCard() {
    var parent = state.parent;
    var meds = state.meds.filter(function (med) { return !med.stopped; });
    var stopped = state.meds.filter(function (med) { return med.stopped; });
    return '<div class="overlay"><button type="button" class="backdrop" data-action="emergency-close" aria-label="Close emergency card"></button><article class="emergency" role="dialog" aria-modal="true" aria-labelledby="emergency-title"><header class="emergency-top"><div><h2 id="emergency-title">Emergency card</h2><span class="tag">Sample data</span></div><button type="button" class="btn btn-small btn-secondary no-print" id="emergency-close" data-action="emergency-close">Close</button></header><div class="emergency-body"><div><h3>' + esc(parent.name) + ", " + parent.age + "</h3><p>" + esc(parent.legalName) + "</p><dl class=\"kv\"><dt>Date of birth</dt><dd>" + esc(parent.dob) + "</dd><dt>Blood type</dt><dd>" + esc(parent.bloodType) + "</dd><dt>Languages</dt><dd>" + esc(parent.languages) + "</dd></dl></div><div class=\"allergy-box\"><h3>Allergies</h3><strong>" + esc(parent.allergies.join(" · ")) + "</strong></div><div><h2>Conditions</h2><p>" + esc(parent.conditions.join(", ")) + "</p></div><div><h2>Medications now</h2>" + meds.map(function (med) {
      var when = med.prn || !(med.slots || []).length ? "As needed" : med.slots.map(slotLabel).join(", ");
      return "<p><strong>" + esc(med.name) + "</strong> — " + esc(med.dose) + " — " + esc(when) + "</p>";
    }).join("") + "</div>" + (stopped.length ? '<div class="stopped"><strong>Stopped</strong>' + stopped.map(function (med) { return "<p>" + esc(med.name) + " — " + esc(med.changeNote || "Do not give") + "</p>"; }).join("") + "</div>" : "") + "<div><h2>Insurance</h2><p>" + esc(parent.insurance.primary) + "<br><span class=\"mono\">" + esc(parent.insurance.memberId) + "</span><br>" + esc(parent.insurance.supplemental) + "</p></div><div><h2>Where to go</h2><p>" + esc(parent.address) + "<br>" + esc(parent.hospital) + "</p></div><div><h2>Call family</h2><div class=\"contact-grid\">" + parent.contacts.map(function (contact) {
      return '<a class="contact-call" href="tel:' + esc(contact.tel) + '"><strong>' + esc(contact.name) + "</strong><span>" + esc(contact.relation) + "</span><em>" + esc(contact.phone) + "</em></a>";
    }).join("") + "</div></div><div><h2>Doctors</h2><div class=\"doc-grid\">" + parent.doctors.map(function (doctor) {
      return '<a class="doc-line" href="tel:' + esc(doctor.tel) + '"><strong>' + esc(doctor.name) + "</strong><span>" + esc(doctor.specialty) + "</span><em>" + esc(doctor.phone) + "</em></a>";
    }).join("") + '</div></div><p class="fine">Fictional sample card. In a real emergency, call local emergency services. Show this layout to paramedics only after a real record is confirmed.</p><p class="no-print"><button type="button" class="btn btn-secondary" data-action="print-card">Print this card</button></p></div></article></div>';
  }

  function resetModal() {
    return '<div class="overlay"><button type="button" class="backdrop" data-action="reset-cancel" aria-label="Cancel reset"></button><div class="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title"><h2 id="reset-title">Put the sample family back?</h2><p>Changes you made to Grandma Wang\'s board on this browser will be replaced. Waitlist entries on the website stay saved.</p><div class="hero-actions"><button type="button" class="btn btn-secondary" id="reset-cancel" data-action="reset-cancel">Cancel</button><button type="button" class="btn btn-danger" data-action="reset-do">Reset sample data</button></div></div></div>';
  }

  function render(options) {
    var now = new Date();
    if (ensureToday(now)) persist();
    var view = currentView();
    document.title = pageTitle(view) + " · ParentLoop";
    var y = window.scrollY;
    var subtitles = {
      today: formatLong(now) + " · " + state.parent.name,
      profile: "Sample record · " + state.parent.name + ", " + state.parent.age,
      meds: "Doses, missed checks, and refills · sample",
      calendar: "Visits and appointments for Amy, Ben, and Chloe",
      tasks: "Split the chores · sample family",
      notes: "Paste a note · rules-based demo",
      digest: "Generated from the board · copy into the group chat"
    };
    var views = {
      today: renderToday,
      profile: renderProfile,
      meds: renderMeds,
      calendar: renderCalendar,
      tasks: renderTasks,
      notes: renderNotes,
      digest: renderDigest
    };
    var body = (views[view] || renderToday)(now);
    var failed = saveFailed ? " This browser is not saving changes." : "";
    root.innerHTML = '<div class="app-shell">' + sidebar(view, now) + '<div class="workspace"><div class="workspace-head"><div class="sample-bar"><p><strong>Sample data.</strong> Grandma Wang\'s care circle is fictional. Nothing here is a real medical record, and changes stay in this browser.' + failed + '</p><button type="button" class="btn btn-small btn-secondary" data-action="reset-ask">Reset sample data</button></div><header class="topbar"><div><h1 class="page-title">' + pageTitle(view) + '</h1><p class="page-sub">' + esc(subtitles[view] || "") + '</p></div><div class="top-actions"><label class="who-mobile">Viewing as <select data-action="set-viewer" aria-label="Demo identity">' + viewerOptions(state.viewer) + '</select></label><button type="button" class="btn btn-danger" data-action="emergency-open">Emergency card</button></div></header></div><main class="content" id="main">' + body + "</main></div></div>" + tabbar(view) + (state.ui.emergency ? emergencyCard() : "") + (state.ui.confirmReset ? resetModal() : "");
    document.body.classList.toggle("modal-open", !!(state.ui.emergency || state.ui.confirmReset));
    if (options && options.scroll === "top") window.scrollTo(0, 0);
    else window.scrollTo(0, y);
    if (pendingFocus) {
      var target = document.querySelector(pendingFocus);
      if (target) target.focus();
      pendingFocus = null;
    }
  }

  function toast(message) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3200);
  }

  function readNote() {
    var field = document.getElementById("note-input");
    if (field) state.draftNote = field.value;
  }

  function guessOwner(text) {
    if (/\bamy\b/i.test(text)) return "amy";
    if (/\bben\b/i.test(text)) return "ben";
    if (/\bchloe\b/i.test(text)) return "chloe";
    return state.viewer;
  }

  function addTodoText(text) {
    if (alreadyTask(text)) return false;
    state.tasks.push({
      id: uid("task"),
      title: text,
      owner: guessOwner(text),
      status: "open",
      due: "From the note",
      area: "From note",
      fromNote: true
    });
    return true;
  }

  function addMedText(text) {
    var lower = text.toLowerCase();
    if (/ibuprofen/.test(lower) && /\bstop\b/.test(lower)) {
      var existing = null;
      state.meds.forEach(function (med) {
        if (/ibuprofen/i.test(med.name)) existing = med;
      });
      if (existing && existing.changeNote === text && existing.stopped) return false;
      if (!existing) {
        state.meds.push({
          id: "ibuprofen",
          name: "Ibuprofen",
          dose: "Stopped",
          instructions: "Do not give. Stopped in the sample note.",
          slots: [],
          prn: false,
          stopped: true,
          refillDays: null,
          pharmacy: "",
          prescriber: "Dr. Priya Shah",
          changeNote: text,
          fromNote: true
        });
        return true;
      }
      existing.stopped = true;
      existing.changeNote = text;
      existing.dose = "Stopped";
      return true;
    }
    var med = null;
    state.meds.forEach(function (item) {
      if (lower.indexOf(item.name.toLowerCase()) >= 0) med = item;
    });
    if (!med) {
      if (alreadyMed(text)) return false;
      state.meds.push({
        id: uid("med"),
        name: "From the note",
        dose: "See note",
        instructions: text,
        slots: [],
        prn: /as needed/i.test(text),
        stopped: /\bstop\b/i.test(text),
        refillDays: null,
        pharmacy: "",
        prescriber: "",
        changeNote: text,
        fromNote: true
      });
      return true;
    }
    if (med.changeNote === text) return false;
    med.changeNote = text;
    med.fromNote = true;
    if (/metformin/i.test(med.name) && /1000/.test(text)) {
      med.dose = "500 mg breakfast · 1000 mg dinner";
      med.instructions = "With food. Sample change: 500 mg at breakfast and 1000 mg at dinner.";
    }
    if (/acetaminophen/i.test(med.name)) {
      med.instructions = "As needed for knee pain. No more than 3 times a day.";
      med.prn = true;
    }
    return true;
  }

  function appointmentTitle(text) {
    if (/endocrin/i.test(text)) return "Endocrinology follow-up";
    if (/cardio/i.test(text)) return "Cardiology follow-up";
    if (/lab/i.test(text)) return "Lab work";
    return "Follow-up from the note";
  }

  function addApptText(text, now) {
    if (alreadyAppt(text)) return "";
    var weeks = /in\s+(\d+)\s+weeks/i.exec(text);
    var days = weeks ? Number(weeks[1]) * 7 : 42;
    var date = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), days);
    state.extraEvents.push({
      id: uid("appt"),
      title: appointmentTitle(text),
      kind: "appointment",
      owner: guessOwner(text),
      date: iso(date),
      start: "10:00",
      end: "10:45",
      place: /endocrin/i.test(text) ? "South Bay Endocrine" : "Clinic",
      notes: text,
      fromNote: true
    });
    return iso(date);
  }

  function weekDiff(date, now) {
    var start = startOfWeek(now).getTime();
    var target = startOfWeek(date).getTime();
    return Math.round((target - start) / (7 * 24 * 60 * 60 * 1000));
  }

  function countAdded(list, fn) {
    var added = 0;
    list.forEach(function (item) { if (fn(item)) added += 1; });
    return added;
  }

  function closeEmergency() {
    state.ui.emergency = false;
    if (location.hash === "#emergency") history.replaceState(null, "", "#profile");
    render();
  }

  function onClick(event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var action = button.dataset.action;
    var now = new Date();
    if (action === "toggle-dose") {
      var medId = button.dataset.med;
      var slot = button.dataset.slot;
      var key = iso(now);
      if (!state.medLog[key]) state.medLog[key] = {};
      if (!state.medLog[key][medId]) state.medLog[key][medId] = {};
      var current = displayStatus(state, medId, slot, now);
      var next = current === "taken" ? (slotHasPassed(slot, now) ? "missed" : "due") : "taken";
      state.medLog[key][medId][slot] = next;
      persist();
      render();
      toast(next === "taken" ? "Marked taken" : next === "missed" ? "Marked missed" : "Cleared");
      return;
    }
    if (action === "request-refill") {
      var med = state.meds.filter(function (item) { return item.id === button.dataset.med; })[0];
      if (!med) return;
      med.refillRequested = true;
      persist();
      render();
      toast("Refill marked as requested in this demo");
      return;
    }
    if (action === "set-viewer") {
      if (!PEOPLE[button.dataset.who]) return;
      state.viewer = button.dataset.who;
      persist();
      render();
      return;
    }
    if (action === "task-filter") {
      state.ui.taskFilter = button.dataset.filter === "mine" ? "mine" : "all";
      persist();
      render();
      return;
    }
    if (action === "task-toggle") {
      var found = state.tasks.filter(function (item) { return item.id === button.dataset.id; })[0];
      if (!found) return;
      found.status = found.status === "done" ? "open" : "done";
      persist();
      render();
      toast(found.status === "done" ? "Task finished" : "Task reopened");
      return;
    }
    if (action === "cover-day") {
      var name = PEOPLE[state.viewer].name;
      state.extraEvents.push({
        id: uid("visit"),
        title: name + " covering",
        kind: "visit",
        owner: state.viewer,
        date: button.dataset.date,
        start: "10:00",
        end: "13:00",
        place: "Home",
        fromCover: true
      });
      persist();
      render();
      toast(name + " is covering that day");
      return;
    }
    if (action === "remove-event") {
      var before = state.events.length + state.extraEvents.length;
      state.events = state.events.filter(function (item) { return item.id !== button.dataset.id; });
      state.extraEvents = state.extraEvents.filter(function (item) { return item.id !== button.dataset.id; });
      if (state.events.length + state.extraEvents.length === before) return;
      persist();
      render();
      toast("Removed from the calendar");
      return;
    }
    if (action === "week-prev") { weekOffset -= 1; render(); return; }
    if (action === "week-next") { weekOffset += 1; render(); return; }
    if (action === "week-today") { weekOffset = 0; render(); return; }
    if (action === "goto-date") {
      weekOffset = weekDiff(parseIso(button.dataset.date), now);
      if (location.hash !== "#calendar") location.hash = "#calendar";
      else render({ scroll: "top" });
      return;
    }
    if (action === "emergency-open") {
      state.ui.more = false;
      state.ui.emergency = true;
      pendingFocus = "#emergency-close";
      render();
      return;
    }
    if (action === "emergency-close") { closeEmergency(); return; }
    if (action === "print-card") { window.print(); return; }
    if (action === "reset-ask") {
      state.ui.more = false;
      state.ui.confirmReset = true;
      pendingFocus = "#reset-cancel";
      render();
      return;
    }
    if (action === "reset-cancel") { state.ui.confirmReset = false; render(); return; }
    if (action === "reset-do") {
      state = createSeed(new Date());
      weekOffset = 0;
      persist();
      state.ui.confirmReset = false;
      render({ scroll: "top" });
      toast("Sample family restored");
      return;
    }
    if (action === "toggle-more") { state.ui.more = !state.ui.more; render(); return; }
    if (action === "load-sample") {
      state.draftNote = SAMPLE_NOTE;
      persist();
      render();
      toast("Sample note loaded. It is fictional.");
      return;
    }
    if (action === "extract-note") {
      readNote();
      if (!state.draftNote.trim()) {
        toast("Paste a note first, or load the sample.");
        return;
      }
      var extracted = extractNote(state.draftNote);
      state.extraction = {
        todos: extracted.todos,
        medChanges: extracted.medChanges,
        appointments: extracted.appointments,
        sourceText: state.draftNote
      };
      persist();
      render();
      var total = extracted.todos.length + extracted.medChanges.length + extracted.appointments.length;
      toast(total ? "Extracted " + total + " items with the demo rules" : "No to-dos, medication changes, or appointments matched");
      return;
    }
    if (action === "add-todo" || action === "add-all-todos" || action === "add-med" || action === "add-all-meds" || action === "add-appt" || action === "add-all-appts") {
      readNote();
      if (!state.extraction) return;
      var added = 0;
      var firstDate = "";
      if (action === "add-todo") added = addTodoText(button.dataset.text) ? 1 : 0;
      if (action === "add-all-todos") added = countAdded(state.extraction.todos, addTodoText);
      if (action === "add-med") added = addMedText(button.dataset.text) ? 1 : 0;
      if (action === "add-all-meds") added = countAdded(state.extraction.medChanges, addMedText);
      if (action === "add-appt") {
        firstDate = addApptText(button.dataset.text, now);
        added = firstDate ? 1 : 0;
      }
      if (action === "add-all-appts") {
        state.extraction.appointments.forEach(function (item) {
          var date = addApptText(item, now);
          if (date) {
            added += 1;
            if (!firstDate) firstDate = date;
          }
        });
      }
      if (firstDate) weekOffset = weekDiff(parseIso(firstDate), now);
      persist();
      render();
      toast(added ? "Added " + added + " to the board" : "Already on the board");
    }
  }

  function onChange(event) {
    var field = event.target.closest("[data-action]");
    if (!field) return;
    if (field.dataset.action === "set-viewer") {
      if (!PEOPLE[field.value]) return;
      state.viewer = field.value;
      persist();
      render();
    }
    if (field.dataset.action === "task-owner") {
      var found = state.tasks.filter(function (item) { return item.id === field.dataset.id; })[0];
      if (!found) return;
      found.owner = PEOPLE[field.value] ? field.value : "";
      persist();
      render();
    }
  }

  function onInput(event) {
    if (event.target.id === "note-input") {
      state.draftNote = event.target.value;
      persist();
    }
  }

  function onKey(event) {
    if (event.key === "Escape") {
      if (state.ui.confirmReset) { state.ui.confirmReset = false; render(); return; }
      if (state.ui.emergency) { closeEmergency(); return; }
      if (state.ui.more) { state.ui.more = false; render(); return; }
    }
    if (event.key !== "Tab") return;
    if (!state.ui.emergency && !state.ui.confirmReset) return;
    var box = document.querySelector(state.ui.emergency ? ".emergency" : ".modal");
    if (!box) return;
    var items = box.querySelectorAll("a, button, input, select, textarea");
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function onHash() {
    state.ui.more = false;
    state.ui.emergency = location.hash === "#emergency";
    if (state.ui.emergency) pendingFocus = "#emergency-close";
    render({ scroll: "top" });
  }

  function mount(el) {
    if (mounted) return;
    mounted = true;
    root = el;
    state = loadState();
    state.ui.emergency = location.hash === "#emergency";
    state.ui.confirmReset = false;
    state.ui.more = false;
    if (state.ui.emergency) pendingFocus = "#emergency-close";
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("input", onInput);
    document.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    render({ scroll: "top" });
  }

  return {
    SAMPLE_NOTE: SAMPLE_NOTE,
    extractNote: extractNote,
    createSeed: createSeed,
    eventsFor: eventsFor,
    dayStatus: dayStatus,
    buildDigest: buildDigest,
    weekDays: weekDays,
    displayStatus: displayStatus,
    balanceModel: balanceModel,
    mount: mount
  };
});
