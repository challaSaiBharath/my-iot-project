/* =========================
   Firebase + App Frontend
   ========================= */

// ----- Your Firebase config (from your project) -----
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
const storage = firebase.storage();

// ------------- Helpers -------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]; // no Sunday

function toast(msg){ alert(msg); }
function nowISO(){ return new Date().toISOString(); }

// ------------- Navigation wiring -------------
const main = $("#mainContent");
const sidebarLinks = $$(".app-sidebar .nav-link");
sidebarLinks.forEach(a=>{
  a.addEventListener("click",(e)=>{
    e.preventDefault();
    sidebarLinks.forEach(x=>x.classList.remove("active"));
    a.classList.add("active");
    const page = a.dataset.page;
    loadPage(page);
  })
});

// header buttons
$("#btnTimetable").addEventListener("click", openTimetableModal);
$("#btnUser").addEventListener("click", openUserModal);

// ------------- Global caches -------------
let roomsCache = {};        // /rooms
let statusCache = {};       // /status or /status/rooms
let logsCache = {};         // /logs
let ttCache = {};           // /timetable

// ------------- DB listeners -------------
db.ref("/rooms").on("value", s => { roomsCache = s.val() || {}; if(currentPage==='rooms') renderRooms(); if(currentPage==='dashboard') renderDashboard(); });
db.ref("/status").on("value", s => { statusCache = s.val() || {}; if(currentPage==='status') renderStatus(); if(currentPage==='dashboard') renderDashboard(); });
db.ref("/logs").on("value", s => { logsCache = s.val() || {}; if(currentPage==='announcements') renderAnnouncements(); });
db.ref("/timetable").on("value", s => { ttCache = s.val() || {}; if(currentPage==='dashboard') renderDashboard(); });

// ------------- Pages -------------
let currentPage = "dashboard";
loadPage("dashboard");

function loadPage(page){
  currentPage = page;
  if(page==="dashboard") return renderDashboard();
  if(page==="announcements") return renderAnnouncements();
  if(page==="rooms") return renderRooms();
  if(page==="status") return renderStatus();
}

/* ======================
   Dashboard
   ====================== */
function renderDashboard(){
  // counts
  const displaysConnected = Object.keys(statusCache?.rooms||{}).filter(k => statusCache.rooms[k]?.online).length
    + (statusCache?.esp8266?.info?.online ? 1 : 0);
  const speakersConnected =  (statusCache?.speakers) ? Object.keys(statusCache.speakers).filter(k=>statusCache.speakers[k].online).length : 0;
  const activeRooms = Object.keys(roomsCache||{}).length;

  main.innerHTML = `
    <div class="panel">
      <div class="grid-cards">
        <div class="card-kpi"><div class="kpi-icon"><i class="bi bi-tv"></i></div><div class="kpi-body"><h6>Displays Connected</h6><div id="kpiDisplays">${displaysConnected}</div></div></div>
        <div class="card-kpi"><div class="kpi-icon"><i class="bi bi-volume-up"></i></div><div class="kpi-body"><h6>Speakers Connected</h6><div id="kpiSpeakers">${speakersConnected}</div></div></div>
        <div class="card-kpi"><div class="kpi-icon"><i class="bi bi-houses"></i></div><div class="kpi-body"><h6>Active Rooms</h6><div id="kpiRooms">${activeRooms}</div></div></div>
        <div class="card-kpi"><div class="kpi-icon"><i class="bi bi-calendar3"></i></div><div class="kpi-body"><h6>Today's Schedule</h6><div><button class="btn btn-sm btn-outline-primary" id="btnViewToday">View</button></div></div></div>
        <div class="card-kpi"><div class="kpi-icon"><i class="bi bi-hourglass-split"></i></div><div class="kpi-body"><h6>Next Event</h6><div id="nextEvent">—</div></div></div>
      </div>
    </div>

    <div class="panel">
      <h5>Quick Send</h5>
      <div class="d-flex gap-2 flex-wrap">
        <select id="qsRoom" class="form-select" style="max-width:240px;">
          <option value="">All Rooms</option>
          ${Object.keys(roomsCache||{}).map(r=>`<option value="${r}">${roomsCache[r]?.meta?.name||r}</option>`).join("")}
        </select>
        <input id="qsMsg" class="form-control" placeholder="Type message...">
        <button id="qsSend" class="btn btn-primary"><i class="bi bi-send"></i> Send</button>
      </div>
    </div>
  `;

  $("#btnViewToday").onclick = openTimetableModal;
  $("#qsSend").onclick = () => {
    const msg = $("#qsMsg").value.trim();
    if(!msg) return toast("Type a message");
    const room = $("#qsRoom").value;
    const targetRooms = room ? [room] : Object.keys(roomsCache||{});
    const payload = { type:"text", message:msg, timestamp: nowISO(), duration:20 };
    targetRooms.forEach(r=>{
      db.ref(`/rooms/${r}/currentAnnouncement`).set(payload);
      db.ref(`/logs/${r}/${Math.floor(Date.now()/1000)}`).set(`Text: ${msg}`);
    });
    $("#qsMsg").value = "";
    toast("Sent!");
  };

  computeNextEvent();
}

function computeNextEvent(){
  // expects ttCache[Day][Room] = array of entries {serial, roomNo, subject, professor, start, end}
  const day = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][new Date().getDay()];
  if(day==="Sunday" || !ttCache?.[day]) { $("#nextEvent").innerText = "No classes today"; return; }
  let rows = [];
  Object.keys(ttCache[day]||{}).forEach(room=>{
    (ttCache[day][room]||[]).forEach(x=>rows.push({...x, room}));
  });
  rows.sort((a,b)=> (a.start||"").localeCompare(b.start||""));
  const curMin = new Date().getHours()*60 + new Date().getMinutes();
  let next = null;
  for(const r of rows){
    const [h,m] = (r.start||"00:00").split(":").map(n=>parseInt(n,10));
    if(h*60+m >= curMin){ next = r; break; }
  }
  $("#nextEvent").innerText = next ? `${next.subject} ${next.start} (${next.room})` : "No upcoming events";
}

/* ======================
   Announcements
   ====================== */
function renderAnnouncements(){
  const roomsHTML = Object.keys(roomsCache||{}).map(r=>{
    const name = roomsCache[r]?.meta?.name || r;
    return `
      <div class="list-room">
        <div><strong>${name}</strong><div class="small-muted">${r}</div></div>
        <label class="switch">
          <input type="checkbox" class="room-switch" value="${r}">
          <span class="track"><span class="thumb"></span></span>
        </label>
      </div>
    `;
  }).join("");

  main.innerHTML = `
    <div class="panel">
      <h5 class="mb-3">Announcements</h5>
      <div class="ann-tabs mb-3">
        <div class="ann-tab active" data-type="text">Text</div>
        <div class="ann-tab" data-type="audio">Audio</div>
        <div class="ann-tab" data-type="image">Image</div>
        <div class="ann-tab" data-type="video">Video</div>
      </div>
      <div id="annForm" class="mb-3"></div>

      <div class="mb-3"><h6>Rooms (On = will receive)</h6>${roomsHTML || '<div class="small-muted">Add rooms first.</div>'}</div>

      <div class="d-flex gap-2">
        <input id="annDuration" type="number" class="form-control" style="max-width:220px" placeholder="Duration (sec)" value="20">
        <button id="annSend" class="btn btn-primary"><i class="bi bi-send"></i> Send</button>
      </div>
    </div>

    <div class="panel">
      <h6 class="mb-2">Announcement History (latest per room)</h6>
      <div id="annHistory" class="small"></div>
    </div>
  `;

  // tabs
  $$(".ann-tab").forEach(t=>t.addEventListener("click",()=>{
    $$(".ann-tab").forEach(x=>x.classList.remove("active"));
    t.classList.add("active");
    loadAnnForm(t.dataset.type);
  }));
  loadAnnForm("text");

  $("#annSend").onclick = sendAnnouncement;
  renderAnnHistory();
}

function loadAnnForm(type){
  const box = $("#annForm");
  if(type==="text"){
    box.innerHTML = `
      <textarea id="annText" class="form-control" rows="3" placeholder="Type your announcement..."></textarea>
      <div class="small-muted mt-1">The message will be written to /rooms/{roomId}/currentAnnouncement</div>
    `;
  } else if(type==="audio"){
    box.innerHTML = `
      <input type="file" id="annAudio" accept="audio/*" class="form-control">
      <div class="small-muted mt-1">Uploads to Firebase Storage and sends the URL.</div>
    `;
  } else if(type==="image"){
    box.innerHTML = `<input type="file" id="annImage" accept="image/*" class="form-control">`;
  } else if(type==="video"){
    box.innerHTML = `
      <input type="file" id="annVideo" accept="video/*" class="form-control">
      <div class="form-check mt-2">
        <input class="form-check-input" type="checkbox" id="annMute">
        <label class="form-check-label" for="annMute">Mute video</label>
      </div>
    `;
  }
}

async function sendAnnouncement(){
  const type = $$(".ann-tab").find(x=>x.classList.contains("active")).dataset.type;
  const duration = parseInt($("#annDuration").value)||20;
  const checked = $$(".room-switch:checked").map(x=>x.value);
  if(checked.length===0) return toast("Toggle ON at least one room.");

  const base = { type, timestamp: nowISO(), duration };
  if(type==="text"){
    const txt = ($("#annText")?.value||"").trim();
    if(!txt) return toast("Type text");
    base.message = txt;
    base.mediaUrl = "";
    writeToRooms(base, checked);
  }else{
    // upload file then send URL
    const inputId = type==="audio"?"annAudio": type==="image"?"annImage":"annVideo";
    const f = $("#"+inputId)?.files?.[0];
    if(!f) return toast("Select a file");
    try{
      const path = `ann/${type}_${Date.now()}_${f.name}`;
      const ref = storage.ref().child(path);
      await ref.put(f);
      const url = await ref.getDownloadURL();
      base.message = (type==="video") ? "Video Announcement" : (type==="image"?"Image Announcement":"Audio Announcement");
      base.mediaUrl = url;
      if(type==="video") base.mute = $("#annMute").checked;
      writeToRooms(base, checked);
    }catch(err){
      console.error(err);
      toast("Upload failed: "+err.message);
    }
  }
}

function writeToRooms(payload, roomIds){
  roomIds.forEach(r=>{
    db.ref(`/rooms/${r}/currentAnnouncement`).set(payload);
    db.ref(`/logs/${r}/${Math.floor(Date.now()/1000)}`).set(`${payload.type}: ${payload.message||payload.mediaUrl||''}`);
  });
  toast("Announcement sent");
  renderAnnHistory();
}

function renderAnnHistory(){
  const container = $("#annHistory");
  let html = Object.keys(logsCache||{}).map(room=>{
    const entries = logsCache[room] || {};
    const lastKey = Object.keys(entries).sort().pop();
    const last = lastKey ? entries[lastKey] : "(none)";
    const name = roomsCache[room]?.meta?.name || room;
    return `<div><strong>${name}</strong> — <span class="small-muted">${last}</span></div>`;
  }).join("");
  container.innerHTML = html || "<div class='small-muted'>No history yet</div>";
}

/* ======================
   Rooms
   ====================== */
function renderRooms(){
  main.innerHTML = `
    <div class="panel">
      <h5>Rooms</h5>
      <div class="d-flex gap-2 mb-3 flex-wrap">
        <input id="roomId" class="form-control" placeholder="Room ID (e.g., 101)" style="max-width:200px;">
        <input id="roomName" class="form-control" placeholder="Room Name (e.g., Room 101)" style="max-width:280px;">
        <select id="roomType" class="form-select" style="max-width:160px;">
          <option>LCD</option><option>LED</option>
        </select>
        <button id="addRoom" class="btn btn-success"><i class="bi bi-plus-circle"></i> Add Room</button>
      </div>

      <div id="roomList"></div>
    </div>
  `;

  $("#addRoom").onclick = () => {
    const id = $("#roomId").value.trim();
    const name = $("#roomName").value.trim();
    const type = $("#roomType").value;
    if(!id || !name) return toast("Enter Room ID and Name");
    db.ref(`/rooms/${id}/meta`).set({ name, type, online:false }).then(()=>{
      toast("Room added");
      $("#roomId").value = ""; $("#roomName").value = "";
    });
  };

  const list = $("#roomList");
  list.innerHTML = Object.keys(roomsCache||{}).map(r=>{
    const m = roomsCache[r]?.meta||{};
    return `
      <div class="list-room">
        <div>
          <strong>${m.name||r}</strong>
          <div class="small-muted">${r} · ${m.type||'-'}</div>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-primary" onclick="viewRoom('${r}')">View</button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteRoom('${r}')">Delete</button>
        </div>
      </div>
    `;
  }).join("") || "<div class='small-muted'>No rooms yet</div>";
}

window.deleteRoom = function(roomId){
  if(!confirm(`Delete room ${roomId}?`)) return;
  db.ref(`/rooms/${roomId}`).remove().then(()=>toast("Room deleted"));
};

window.viewRoom = function(roomId){
  const m = roomsCache[roomId]?.meta||{};
  const panel = document.createElement("div");
  panel.className="panel";
  panel.innerHTML = `
    <h6>${m.name||roomId} (${roomId})</h6>
    <div>Type: ${m.type||'-'}</div>
    <div class="small-muted mt-2">Current class (if any) shown via timetable day logic.</div>
    <div class="mt-2"><button class="btn btn-sm btn-outline-secondary" onclick="this.closest('.panel').remove()">Close</button></div>
  `;
  main.prepend(panel);
};

/* ======================
   Status
   ====================== */
function renderStatus(){
  const roomStatus = statusCache?.rooms || {};
  main.innerHTML = `
    <div class="panel">
      <h5>Status</h5>
      ${Object.keys(roomsCache||{}).map(r=>{
        const online = roomStatus[r]?.online ? `<span class="badge-online">Online</span>` : `<span class="small-muted">Offline</span>`;
        const ip = roomStatus[r]?.ip || '-';
        const ts = roomStatus[r]?.ts || '-';
        return `
          <div class="list-room">
            <div><strong>${roomsCache[r]?.meta?.name||r}</strong><div class="small-muted">${r}</div></div>
            <div class="text-end">
              <div>${online}</div>
              <div class="small-muted">IP: ${ip}</div>
              <div class="small-muted">TS: ${ts}</div>
            </div>
          </div>
        `;
      }).join("") || "<div class='small-muted'>No rooms.</div>"}
    </div>
  `;
}

/* ======================
   Timetable Modal
   ====================== */
function openTimetableModal(){
  // fill days
  const daysHTML = days.map((d,i)=>`<button class="btn btn-sm btn-outline-primary ${i===0?'active':''}" data-day="${d}">${d}</button>`).join("");
  $("#ttDays").innerHTML = daysHTML;

  // rooms dropdown
  $("#ttRoomSelect").innerHTML = Object.keys(roomsCache||{}).map(r=>`
    <option value="${r}">${roomsCache[r]?.meta?.name||r}</option>
  `).join("");

  const bs = bootstrap.Modal.getOrCreateInstance(document.getElementById('timetableModal'));
  bs.show();

  let activeDay = days[0];
  const render = () => loadTimetableDay(activeDay, $("#ttRoomSelect").value);

  $$("#ttDays .btn").forEach(b=>b.addEventListener("click",()=>{
    $$("#ttDays .btn").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    activeDay = b.dataset.day; render();
  }));
  $("#ttRoomSelect").onchange = render;

  $("#ttAddManual").onclick = () => {
    const mm = bootstrap.Modal.getOrCreateInstance(document.getElementById('manualModal'));
    mm.show();
    $("#mSave").onclick = () => {
      const entry = {
        serial: $("#mSerial").value.trim(),
        roomNo: $("#mRoom").value.trim(),
        subject: $("#mSubject").value.trim(),
        professor: $("#mProfessor").value.trim(),
        start: $("#mStart").value,
        end: $("#mEnd").value
      };
      if(!entry.serial || !entry.roomNo || !entry.subject || !entry.professor || !entry.start || !entry.end){
        return toast("Fill all fields");
      }
      db.ref(`/timetable/${activeDay}/${$("#ttRoomSelect").value}`).once("value").then(s=>{
        let arr = s.val(); if(!Array.isArray(arr)) arr=[];
        arr.push(entry);
        return db.ref(`/timetable/${activeDay}/${$("#ttRoomSelect").value}`).set(arr);
      }).then(()=>{ toast("Saved"); mm.hide(); render(); });
    };
  };

  $("#ttDeleteDay").onclick = () => {
    if(!confirm(`Delete all entries for ${activeDay} in selected room?`)) return;
    db.ref(`/timetable/${activeDay}/${$("#ttRoomSelect").value}`).remove().then(()=>{ toast("Cleared"); render(); });
  };

  render();
}

function loadTimetableDay(day, roomId){
  const area = $("#ttTableArea");
  area.innerHTML = "Loading...";
  db.ref(`/timetable/${day}/${roomId}`).once("value").then(s=>{
    const arr = s.val() || [];
    if(!Array.isArray(arr) || arr.length===0){
      area.innerHTML = `<div class="small-muted">No entries for ${day}.</div>`;
      return;
    }
    const rows = arr.map((r,i)=>`
      <tr>
        <td>${i+1}</td>
        <td>${r.roomNo||roomId}</td>
        <td>${r.professor||'-'}</td>
        <td>${r.subject||'-'}</td>
        <td>${(r.start||'--:--')} : ${(r.end||'--:--')}</td>
      </tr>
    `).join("");
    area.innerHTML = `
      <table class="table table-bordered">
        <thead><tr><th>Serial No</th><th>Room No</th><th>Professor</th><th>Subject</th><th>Time (Start : End)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  });
}

/* ======================
   User modal (demo)
   ====================== */
function openUserModal(){
  const m = bootstrap.Modal.getOrCreateInstance(document.getElementById('userModal'));
  $("#loginHistory").innerHTML = `<div>${new Date().toLocaleString()} — admin logged in</div>`;
  m.show();
}

/* ======================
   Start
   ====================== */
setTimeout(()=>loadPage(currentPage), 200);
