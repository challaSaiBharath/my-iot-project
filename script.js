/* ============================================================
   IoT Announcement System – script.js (fully wired & robust)
   Matches your posted HTML/CSS exactly. Uses Firebase RTDB.
   Adds auto-loader for Firebase Storage (uploads work).
   ============================================================ */

/* ---------------- Firebase Config (yours) ---------------- */
const firebaseConfig = {
  apiKey: "AIzaSyAFyaKNhaMDPJ66gG9ysB5TYJPSpDXdf1M",
  authDomain: "iot-based-annoucement-system.firebaseapp.com",
  databaseURL: "https://iot-based-annoucement-system-default-rtdb.firebaseio.com",
  projectId: "iot-based-annoucement-system",
  storageBucket: "iot-based-annoucement-system.firebasestorage.app",
  messagingSenderId: "243072769758",
  appId: "1:243072769758:web:f3c4e8dd702861a2bd6c4f",
  measurementId: "G-M08JRRQF5E"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// We’ll load Storage SDK dynamically so you don’t edit HTML.
let storage = null;
loadFirebaseStorage()
  .then(() => { storage = firebase.storage(); })
  .catch(() => { console.warn("Firebase Storage SDK could not be loaded. Media uploads disabled."); });

function loadFirebaseStorage() {
  return new Promise((resolve, reject) => {
    if (firebase.storage) return resolve();
    const s = document.createElement("script");
    s.src = "https://www.gstatic.com/firebasejs/9.22.0/firebase-storage-compat.js";
    s.onload = () => resolve();
    s.onerror = () => reject();
    document.head.appendChild(s);
  });
}

/* ---------------- Shortcuts & utils ---------------- */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg, kind = "info") {
  const t = document.createElement("div");
  t.className = "toast-lite";
  t.textContent = msg;
  if (kind === "success") t.style.background = "#16a34a";
  if (kind === "error")   t.style.background = "#ef4444";
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => t.remove(), 2600);
}

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const todayName = () => DAYS[new Date().getDay()];
const isSunday  = () => new Date().getDay() === 0;
const nowISO    = () => new Date().toISOString();

/* ---------------- Sections (match HTML) ---------------- */
const sections = {
  dashboard:    $("#dashboardSection"),
  announcement: $("#announcementSection"),
  rooms:        $("#roomsSection"),
  status:       $("#statusSection"),
  logs:         $("#logsSection")
};
let currentPage = "dashboard";

/* ---------------- Global caches ---------------- */
let roomsCache     = {}; // /rooms
let statusCache    = {}; // /status
let logsCache      = {}; // /logs
let timetableCache = {}; // /timetable

/* ---------------- Navigation wiring ---------------- */
(function wireSidebar() {
  $$(".sidebar .nav-link").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      $$(".sidebar .nav-link").forEach(x => x.classList.remove("active"));
      a.classList.add("active");
      showSection(a.dataset.page);
    });
  });
})();

function showSection(page) {
  currentPage = page;
  Object.values(sections).forEach(el => el?.classList.add("d-none"));
  sections[page]?.classList.remove("d-none");

  // Page-specific refresh
  if (page === "dashboard") {
    renderDashboardCounts();
    fillTodayTimetable();
    computeNextEvent();
  } else if (page === "announcement") {
    renderRoomToggles();
    renderAnnHistory();
  } else if (page === "rooms") {
    renderRoomList();
  } else if (page === "status") {
    renderStatus();
  } else if (page === "logs") {
    renderLogs();
  }
}

/* ---------------- Header buttons ---------------- */
$("#timetableBtn")?.addEventListener("click", () => {
  showSection("dashboard");
  $("#todayTable")?.scrollIntoView({ behavior: "smooth", block: "center" });
});
$("#userBtn")?.addEventListener("click", () => {
  toast("User: admin (demo)\nLogin history can be shown from /loginHistory.", "info");
});

/* ---------------- Realtime listeners (RTDB) ---------------- */
db.ref("/rooms").on("value", (s) => {
  roomsCache = s.val() || {};
  if (currentPage === "dashboard")    renderDashboardCounts();
  if (currentPage === "announcement") renderRoomToggles();
  if (currentPage === "rooms")        renderRoomList();
}, onRtdbError);

db.ref("/status").on("value", (s) => {
  statusCache = s.val() || {};
  if (currentPage === "dashboard") renderDashboardCounts();
  if (currentPage === "status")    renderStatus();
}, onRtdbError);

db.ref("/logs").on("value", (s) => {
  logsCache = s.val() || {};
  if (currentPage === "announcement") renderAnnHistory();
  if (currentPage === "logs")         renderLogs();
}, onRtdbError);

db.ref("/timetable").on("value", (s) => {
  timetableCache = s.val() || {};
  if (currentPage === "dashboard") {
    fillTodayTimetable();
    computeNextEvent();
  }
}, onRtdbError);

function onRtdbError(err) {
  // Helpful surfacing of permission or connection errors
  const msg = (err && err.message) ? err.message : String(err || "Unknown RTDB error");
  console.warn("Firebase warning:", msg);
  if (/permission_denied/i.test(msg)) {
    toast("Firebase rules blocked this action. Use open rules while testing.", "error");
  }
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboardCounts() {
  const displaysOnline = Object.keys(statusCache?.rooms || {}).filter(id => statusCache.rooms[id]?.online).length;
  const roomsCount     = Object.keys(roomsCache || {}).length;

  $("#displayCount") && ($("#displayCount").innerText = String(displaysOnline));
  $("#activeRooms")  && ($("#activeRooms").innerText  = String(roomsCount));
}
$("#refreshDisplay")?.addEventListener("click", renderDashboardCounts);
$("#refreshRooms")?.addEventListener("click", renderDashboardCounts);
$("#checkNextEvent")?.addEventListener("click", computeNextEvent);
$("#reloadTimetable")?.addEventListener("click", fillTodayTimetable);

function fillTodayTimetable() {
  const tbody = $("#timetableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="text-muted">Loading...</td></tr>`;

  if (isSunday()) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted">No classes today (Sunday)</td></tr>`;
    return;
  }

  const day = todayName();
  const dayData = timetableCache?.[day] || [];
  let rows = [];

  // accept: array OR object per room
  if (Array.isArray(dayData)) {
    rows = dayData; // [{serial,roomNo,professor,subject,start,end}]
  } else {
    Object.keys(dayData || {}).forEach(roomId => {
      (dayData[roomId] || []).forEach(e => rows.push({ ...e, roomNo: e.roomNo || roomId }));
    });
  }

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted">No schedule today</td></tr>`;
    return;
  }

  rows.sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${r.roomNo || "-"}</td>
      <td>${r.professor || "-"}</td>
      <td>${r.subject || "-"}</td>
      <td>${r.start || "--:--"}</td>
      <td>${r.end || "--:--"}</td>
    </tr>
  `).join("");
}

function computeNextEvent() {
  const label = $("#nextEvent");
  if (!label) return;

  if (isSunday()) {
    label.innerText = "No classes today";
    return;
  }

  const day = todayName();
  const now = new Date();
  const curMin = now.getHours() * 60 + now.getMinutes();

  const dayData = timetableCache?.[day] || [];
  let rows = [];

  if (Array.isArray(dayData)) rows = dayData;
  else {
    Object.keys(dayData || {}).forEach(roomId => {
      (dayData[roomId] || []).forEach(e => rows.push({ ...e, roomNo: e.roomNo || roomId }));
    });
  }

  rows.sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  let next = null;
  for (const r of rows) {
    const [h, m] = (r.start || "00:00").split(":").map(x => parseInt(x, 10));
    if (h * 60 + m >= curMin) { next = r; break; }
  }
  label.innerText = next ? `${next.subject} ${next.start} (${next.roomNo || "-"})` : "No upcoming events";
}

/* ============================================================
   ANNOUNCEMENTS
   ============================================================ */
const textMsg      = $("#textMsg");
const textPreview  = $("#textPreview");
const sendTextBtn  = $("#sendText");
const clearTextBtn = $("#clearText");

textMsg?.addEventListener("input", () => {
  textPreview.textContent = textMsg.value || "Preview will appear here...";
});

clearTextBtn?.addEventListener("click", () => {
  textMsg.value = "";
  textPreview.textContent = "Preview will appear here...";
});

sendTextBtn?.addEventListener("click", () => {
  const msg = (textMsg?.value || "").trim();
  if (!msg) return toast("Please type a message", "error");

  const targets = getSelectedRoomsOrAll();
  if (targets.length === 0) return toast("No rooms available", "error");

  const payload = { type: "text", message: msg, timestamp: nowISO(), duration: 20 };

  batchSendToRooms(payload, targets)
    .then(() => {
      toast("Text announcement sent!", "success");
      textMsg.value = "";
      textPreview.textContent = "Preview will appear here...";
      renderAnnHistory();
    })
    .catch((e) => toast(e?.message || "Send failed", "error"));
});

function getSelectedRoomsOrAll() {
  const toggled = $$("#roomSwitchContainer input[type=checkbox]:checked").map(x => x.dataset.room);
  return toggled.length ? toggled : Object.keys(roomsCache || {});
}

function renderRoomToggles() {
  const container = $("#roomSwitchContainer");
  if (!container) return;
  const keys = Object.keys(roomsCache || {});
  if (keys.length === 0) {
    container.innerHTML = `<div class="empty">No rooms yet. Add rooms in the Rooms tab.</div>`;
    return;
  }

  container.innerHTML = keys.map(id => {
    const name = roomsCache[id]?.meta?.name || id;
    return `
      <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" id="switch_${id}" data-room="${id}">
        <label class="form-check-label" for="switch_${id}">
          ${name} <span class="small text-muted">(${id})</span>
        </label>
      </div>
    `;
  }).join("");
}

function renderAnnHistory() {
  const list = $("#announcementHistory");
  if (!list) return;

  const rooms = Object.keys(logsCache || {});
  if (rooms.length === 0) {
    list.innerHTML = `<li class="list-group-item text-muted">No previous announcements.</li>`;
    return;
  }

  let html = "";
  rooms.forEach(room => {
    const entries = logsCache[room] || {};
    const lastKey = Object.keys(entries).sort().pop();
    const last = lastKey ? entries[lastKey] : "(none)";
    const name = roomsCache[room]?.meta?.name || room;
    html += `
      <li class="list-group-item d-flex justify-content-between align-items-center">
        <span><strong>${name}</strong> <span class="text-muted">(${room})</span></span>
        <span class="small text-muted">${last}</span>
      </li>
    `;
  });
  list.innerHTML = html;
}

/* ---- Audio / Image / Video buttons (now working) ---- */
const btnAudio  = $("#audioRec");
const btnImage  = $("#uploadImage");
const btnVideo  = $("#uploadVideo");

// Create a reusable hidden file input
function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.onchange = () => {
      const f = inp.files && inp.files[0] ? inp.files[0] : null;
      document.body.removeChild(inp);
      resolve(f);
    };
    inp.click();
  });
}

// Batch write helper
function batchSendToRooms(payload, roomIds) {
  const ops = [];
  roomIds.forEach(r => {
    ops.push(db.ref(`/rooms/${r}/currentAnnouncement`).set(payload));
    ops.push(db.ref(`/logs/${r}/${Date.now()}`).set(`${payload.type}: ${payload.message || payload.mediaUrl || ''}`));
  });
  return Promise.allSettled(ops);
}

// Upload helper
async function uploadToStorage(fileOrBlob, folder) {
  if (!storage) {
    toast("Storage not loaded. Check internet / CSP.", "error");
    throw new Error("Storage not initialized");
  }
  const safeName = (fileOrBlob.name || `blob_${Date.now()}`).replace(/[^\w.\-]+/g, "_");
  const path = `${folder}/${Date.now()}_${safeName}`;
  const ref  = storage.ref().child(path);
  await ref.put(fileOrBlob);
  return await ref.getDownloadURL();
}

/* --- Audio recorder toggle --- */
let mediaRecorder = null;
let recChunks = [];
let recording = false;

btnAudio?.addEventListener("click", async () => {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast("Microphone not supported in this browser", "error");
      return;
    }

    if (!recording) {
      // start recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => e.data && recChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(recChunks, { type: "audio/webm" });
          const url  = await uploadToStorage(blob, "ann_audio");
          const targets = getSelectedRoomsOrAll();
          if (targets.length === 0) { toast("No rooms available", "error"); return; }
          const payload = { type: "audio", message: "Audio Announcement", mediaUrl: url, timestamp: nowISO(), duration: 20 };
          await batchSendToRooms(payload, targets);
          toast("Audio announcement sent!", "success");
          renderAnnHistory();
        } catch (e) {
          console.error(e);
          toast("Audio upload/send failed", "error");
        }
      };
      mediaRecorder.start();
      recording = true;
      btnAudio.classList.remove("btn-outline-primary");
      btnAudio.classList.add("btn-danger");
      btnAudio.innerHTML = `<i class="bi bi-stop-fill"></i> Stop`;
      toast("Recording… click Stop when done");
    } else {
      // stop recording
      mediaRecorder?.stop();
      recording = false;
      btnAudio.classList.remove("btn-danger");
      btnAudio.classList.add("btn-outline-primary");
      btnAudio.innerHTML = `<i class="bi bi-mic"></i> Record Audio`;
    }
  } catch (e) {
    console.error(e);
    toast("Mic access blocked. Allow microphone permission.", "error");
  }
});

/* --- Image upload --- */
btnImage?.addEventListener("click", async () => {
  try {
    const f = await pickFile("image/*");
    if (!f) return;
    const url = await uploadToStorage(f, "ann_image");
    const targets = getSelectedRoomsOrAll();
    if (targets.length === 0) { toast("No rooms available", "error"); return; }
    const payload = { type: "image", message: "Image Announcement", mediaUrl: url, timestamp: nowISO(), duration: 20 };
    await batchSendToRooms(payload, targets);
    toast("Image announcement sent!", "success");
    renderAnnHistory();
  } catch (e) {
    console.error(e);
    toast("Image upload/send failed", "error");
  }
});

/* --- Video upload --- */
btnVideo?.addEventListener("click", async () => {
  try {
    const f = await pickFile("video/*");
    if (!f) return;
    const url = await uploadToStorage(f, "ann_video");
    const targets = getSelectedRoomsOrAll();
    if (targets.length === 0) { toast("No rooms available", "error"); return; }
    const payload = { type: "video", message: "Video Announcement", mediaUrl: url, timestamp: nowISO(), duration: 30, mute: false };
    await batchSendToRooms(payload, targets);
    toast("Video announcement sent!", "success");
    renderAnnHistory();
  } catch (e) {
    console.error(e);
    toast("Video upload/send failed", "error");
  }
});

/* ============================================================
   ROOMS (Add + Delete both work)
   ============================================================ */
$("#addRoomBtn")?.addEventListener("click", () => {
  const id = $("#roomIdInput")?.value?.trim();
  if (!id) return toast("Enter Room Number", "error");
  db.ref(`/rooms/${id}/meta`).set({ name: `Room ${id}`, type: "LCD", online: false })
    .then(() => toast("Room added", "success"))
    .catch(e => toast(e?.message || "Write failed", "error"));
  $("#roomIdInput").value = "";
});

$("#deleteRoomBtn")?.addEventListener("click", () => {
  const id = $("#roomIdInput")?.value?.trim();
  if (!id) return toast("Enter Room Number to delete", "error");
  if (!confirm(`Delete room ${id}?`)) return;
  db.ref(`/rooms/${id}`).remove()
    .then(() => toast("Room deleted", "success"))
    .catch(e => toast(e?.message || "Delete failed", "error"));
  $("#roomIdInput").value = "";
});

function renderRoomList() {
  const list = $("#roomList");
  if (!list) return;

  const keys = Object.keys(roomsCache || {});
  if (keys.length === 0) {
    list.innerHTML = `<li class="list-group-item text-muted">No rooms yet.</li>`;
    return;
  }

  // Render items with inline delete buttons (doesn’t change your HTML layout)
  list.innerHTML = keys.map(id => {
    const m = roomsCache[id]?.meta || {};
    const online = m.online
      ? `<span class="badge-online">Online</span>`
      : `<span class="badge-offline">Offline</span>`;
    return `
      <li class="list-group-item d-flex justify-content-between align-items-center">
        <span><strong>${m.name || id}</strong> <span class="text-muted">(${id})</span></span>
        <span class="d-flex align-items-center gap-2">
          ${online}
          <button class="btn btn-sm btn-outline-danger" data-action="del" data-room="${id}">
            <i class="bi bi-trash"></i>
          </button>
        </span>
      </li>
    `;
  }).join("");

  // hook inline delete clicks
  $$("#roomList [data-action='del']").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.room;
      if (!confirm(`Delete room ${id}?`)) return;
      db.ref(`/rooms/${id}`).remove()
        .then(() => toast(`Room ${id} deleted`, "success"))
        .catch(e => toast(e?.message || "Delete failed", "error"));
    });
  });
}

/* ============================================================
   STATUS
   ============================================================ */
function renderStatus() {
  const displayStatus = $("#displayStatus");
  const speakerStatus = $("#speakerStatus");
  if (!displayStatus || !speakerStatus) return;

  const dCount = Object.keys(statusCache?.rooms || {}).filter(k => statusCache.rooms[k]?.online).length;
  const sCount = Object.keys(statusCache?.speakers || {}).filter(k => statusCache.speakers[k]?.online).length;

  displayStatus.innerHTML = dCount > 0
    ? `<span class="badge-online">Online (${dCount})</span>`
    : `<span class="badge-offline">Offline</span>`;

  speakerStatus.innerHTML = sCount > 0
    ? `<span class="badge-online">Online (${sCount})</span>`
    : `<span class="badge-offline">Offline</span>`;
}

$("#refreshDisplayStatus")?.addEventListener("click", renderStatus);
$("#refreshSpeakerStatus")?.addEventListener("click", renderStatus);

/* ============================================================
   LOGS
   ============================================================ */
function renderLogs() {
  const panel = $("#logsPanel");
  if (!panel) return;

  const rooms = Object.keys(logsCache || {});
  if (rooms.length === 0) {
    panel.innerHTML = `<div class="text-muted">No logs yet.</div>`;
    return;
  }

  panel.innerHTML = "";
  rooms.forEach(room => {
    const entries = logsCache[room] || {};
    const keys = Object.keys(entries).sort();
    keys.forEach(k => {
      const line = document.createElement("div");
      line.className = "log-line";
      line.innerHTML = `<span class="text-success">[${new Date(parseInt(k, 10)).toLocaleTimeString()}]</span> <b>${room}</b>: ${entries[k]}`;
      panel.appendChild(line);
    });
  });
}

$("#clearLogs")?.addEventListener("click", () => {
  if (!confirm("Clear ALL logs?")) return;
  db.ref("/logs").remove()
    .then(() => toast("Logs cleared", "success"))
    .catch(e => toast(e?.message || "Failed to clear logs", "error"));
});

/* ============================================================
   INITIAL RENDER
   ============================================================ */
showSection("dashboard");
renderDashboardCounts();
fillTodayTimetable();
computeNextEvent();
renderRoomList();
renderRoomToggles();
renderStatus();
renderLogs();
toast("Website connected to Firebase!", "success");
