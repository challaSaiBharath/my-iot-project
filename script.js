/* script.js - full UI + Firebase wiring (timetable Mon-Sat integrated)
   Firebase config kept as provided.
*/

// ---------- Firebase Init ----------
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

// ---------- Helpers ----------
const el = sel => document.querySelector(sel);
const qAll = sel => Array.from(document.querySelectorAll(sel));
const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function todayName(){ return days[new Date().getDay()]; }
function isSunday(){ return new Date().getDay() === 0; }
function toast(msg){ alert(msg); }

// ---------- Initial UI wiring ----------
document.addEventListener('DOMContentLoaded', () => {
  qAll('.nav-link').forEach(link=>{
    link.addEventListener('click', e=>{
      e.preventDefault();
      qAll('.nav-link').forEach(x=>x.classList.remove('active'));
      link.classList.add('active');
      loadPage(link.dataset.page);
    });
  });

  el('#timetableBtn').addEventListener('click', openTimetableModal);
  el('#userBtn').addEventListener('click', openUserModal);

  // day tabs click handling (delegated after modal is shown)
  // manual entry save
  el('#saveManualEntryBtn').addEventListener('click', addManualEntry);

  // Edit button in modal (toggle simple delete mode)
  el('#editTimetableBtn').addEventListener('click', ()=>{
    const btn = el('#editTimetableBtn');
    if(btn.dataset.mode === 'delete'){
      btn.dataset.mode = '';
      btn.innerText = 'Edit';
      loadDayTimetable(currentDay); // reload normal
    } else {
      btn.dataset.mode = 'delete';
      btn.innerText = 'Done';
      loadDayTimetable(currentDay); // reload with delete buttons
    }
  });

  // default load
  loadPage('dashboard');
});

// ---------- Page loader ----------
let currentPage = 'dashboard';
function loadPage(page){
  currentPage = page;
  const main = el('#mainContent');
  if(page === 'dashboard'){
    main.innerHTML = dashboardHTML();
    attachDashboardRealtime();
  } else if(page === 'announcement'){
    main.innerHTML = announcementHTML();
    attachAnnouncementsLogic();
  } else if(page === 'rooms'){
    main.innerHTML = roomsHTML();
    attachRoomsLogic();
  } else if(page === 'status'){
    main.innerHTML = statusHTML();
    attachStatusLogic();
  }
}

/* ---------------- DASHBOARD ---------------- */
function dashboardHTML(){
  return `
    <div class="panel-grid">
      <div class="panel"><h4>Displays Connected</h4><div id="displaysConnected" class="big">0</div></div>
      <div class="panel"><h4>Speakers Connected</h4><div id="speakersConnected" class="big">0</div></div>
      <div class="panel"><h4>Active Rooms</h4><div id="activeRooms" class="big">0</div></div>
      <div class="panel"><h4>Today's Schedule</h4><div id="todaysSchedulePreview">—</div></div>
      <div class="panel"><h4>Next Event</h4><div id="nextEvent">—</div></div>
    </div>
    <div class="panel">
      <h4>Quick Announcement</h4>
      <div class="d-flex gap-2">
        <select id="quickRoomSelect" class="form-select"><option value="">All Rooms</option></select>
        <input id="quickMsg" class="form-control" placeholder="Type quick message">
        <button class="btn btn-primary" id="quickSend">Send</button>
      </div>
    </div>
  `;
}

let roomsCache = {};
function attachDashboardRealtime(){
  db.ref('rooms').on('value', snap=>{
    roomsCache = snap.val() || {};
    const sel = el('#quickRoomSelect');
    if(sel) sel.innerHTML = '<option value="">All Rooms</option>' + Object.keys(roomsCache).map(r=>`<option value="${r}">${roomsCache[r].meta?.name||roomsCache[r].name||r}</option>`).join('');
    el('#activeRooms') && (el('#activeRooms').innerText = Object.keys(roomsCache).length);
  });

  db.ref('status').on('value', snap=>{
    const st = snap.val() || {};
    let displays=0, speakers=0;
    Object.keys(st).forEach(k=>{
      const info = st[k].info||{};
      if(info.online){
        if(info.type === 'speaker') speakers++; else displays++;
      }
    });
    el('#displaysConnected') && (el('#displaysConnected').innerText = displays);
    el('#speakersConnected') && (el('#speakersConnected').innerText = speakers);
  });

  const day = todayName();
  db.ref(`timetable/${day}`).on('value', snap=>{
    const data = snap.val() || {};
    const rows = [];
    Object.keys(data).forEach(roomId=>{
      const arr = data[roomId] || [];
      if(Array.isArray(arr)) arr.forEach(e=>rows.push(Object.assign({}, e, {room: roomId})));
    });
    el('#todaysSchedulePreview') && (el('#todaysSchedulePreview').innerHTML = rows.slice(0,4).map(r=>`${r.start}-${r.end} ${r.subject} (${r.room||r.roomNo||'-'})`).join('<br>') || '<span class="text-muted">No timetable entries for today</span>');
    // next event
    const now = new Date(); const curMin = now.getHours()*60 + now.getMinutes();
    rows.sort((a,b)=> (a.start||'').localeCompare(b.start||''));
    let next = null;
    for(let r of rows){
      const [h,m] = (r.start||'00:00').split(':').map(x=>parseInt(x));
      const smin = h*60 + (m||0);
      if(smin >= curMin){ next = r; break; }
    }
    el('#nextEvent') && (el('#nextEvent').innerText = next ? `${next.subject} @ ${next.start} (${next.room||'-'})` : 'No upcoming events today');
  });

  const quickSend = el('#quickSend');
  if(quickSend){
    quickSend.onclick = ()=>{
      const msg = el('#quickMsg').value.trim();
      if(!msg) return toast('Type a quick message first');
      const rid = el('#quickRoomSelect').value;
      const roomIds = rid ? [rid] : Object.keys(roomsCache);
      sendAnnouncementToRooms({ type:'text', message: msg, timestamp: new Date().toISOString(), duration:20 }, roomIds);
      el('#quickMsg').value = '';
    };
  }
}

/* ---------------- ANNOUNCEMENTS ---------------- */
function announcementHTML(){
  return `
    <div class="announcement-layout">
      <div class="panel">
        <h5>Announcement History</h5>
        <div id="announcementHistory">Loading...</div>
      </div>
      <div>
        <div class="panel">
          <h5>Compose Announcement</h5>
          <ul class="nav nav-tabs mb-2" id="annTabs">
            <li class="nav-item"><a class="nav-link active" data-type="text" href="#">Text</a></li>
            <li class="nav-item"><a class="nav-link" data-type="audio" href="#">Audio</a></li>
            <li class="nav-item"><a class="nav-link" data-type="image" href="#">Image</a></li>
            <li class="nav-item"><a class="nav-link" data-type="video" href="#">Video</a></li>
          </ul>
          <div id="annForm"></div>
          <div class="mt-3 d-flex gap-2">
            <button id="annSendBtn" class="btn btn-primary">Send</button>
            <button id="annClearBtn" class="btn btn-outline-secondary">Clear</button>
          </div>
        </div>

        <div class="panel mt-3">
          <h5>Target Rooms</h5>
          <div id="annRooms"></div>
          <div class="mt-2 d-flex gap-2">
            <input id="newRoomInput" class="form-control form-control-sm" placeholder="Add room id (ex: room101)">
            <button id="addRoomBtnSmall" class="btn btn-sm btn-success">Add Room</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

let currentAnnType = 'text';
let recordedAudioBlob = null;
function attachAnnouncementsLogic(){
  loadAnnouncementHistory();
  loadRoomsForAnnouncementPanel();

  qAll('#annTabs .nav-link').forEach(tab=>{
    tab.addEventListener('click', e=>{
      e.preventDefault();
      qAll('#annTabs .nav-link').forEach(x=>x.classList.remove('active'));
      tab.classList.add('active');
      currentAnnType = tab.dataset.type;
      renderAnnForm(currentAnnType);
    });
  });
  renderAnnForm('text');

  el('#annSendBtn').onclick = async ()=>{
    const roomCheckboxes = qAll('#annRooms input.room-toggle');
    const roomIds = roomCheckboxes.filter(cb=>cb.checked).map(cb=>cb.dataset.roomId);
    if(roomIds.length === 0) return toast('Select at least one room');

    const base = { type: currentAnnType, timestamp: new Date().toISOString(), duration: 30 };

    if(currentAnnType === 'text'){
      const txt = (el('#annText')||{}).value || '';
      if(!txt) return toast('Type text message');
      base.message = txt; base.mediaUrl = '';
    } else if(currentAnnType === 'audio'){
      const fileInput = el('#annAudioFile');
      let blob = null;
      if(fileInput && fileInput.files && fileInput.files[0]) blob = fileInput.files[0];
      else if(recordedAudioBlob) blob = recordedAudioBlob;
      if(!blob) return toast('Record or upload audio');
      base.mediaUrl = await uploadToStorage(blob, `audio_${Date.now()}`);
    } else if(currentAnnType === 'image'){
      const f = (el('#annImageFile')||{}).files && el('#annImageFile').files[0];
      if(!f) return toast('Select an image');
      base.mediaUrl = await uploadToStorage(f, `image_${Date.now()}`);
    } else if(currentAnnType === 'video'){
      const f = (el('#annVideoFile')||{}).files && el('#annVideoFile').files[0];
      if(!f) return toast('Select a video file');
      base.mediaUrl = await uploadToStorage(f, `video_${Date.now()}`);
      base.mute = !!el('#annVideoMute')?.checked;
    }

    await db.ref('announcements').push(Object.assign({}, base, { roomIds }));
    await sendAnnouncementToRooms(base, roomIds);
    toast('Announcement sent');
    renderAnnForm(currentAnnType);
    loadAnnouncementHistory();
  };

  el('#annClearBtn').onclick = ()=> renderAnnForm(currentAnnType);

  el('#addRoomBtnSmall').onclick = ()=>{
    const id = el('#newRoomInput').value && el('#newRoomInput').value.trim();
    if(!id) return toast('enter a room id');
    db.ref(`rooms/${id}/meta`).set({ name: id, type: 'LCD', active: true }).then(()=>{ el('#newRoomInput').value=''; loadRoomsForAnnouncementPanel(); });
  };
}

function renderAnnForm(type){
  const form = el('#annForm');
  recordedAudioBlob = null;
  if(type === 'text'){
    form.innerHTML = `<textarea id="annText" class="form-control" rows="4" placeholder="Type announcement text"></textarea>`;
  } else if(type === 'audio'){
    form.innerHTML = `
      <div class="d-flex gap-2">
        <input type="file" id="annAudioFile" accept="audio/*" class="form-control"/>
        <div class="d-flex flex-column">
          <button id="recStartBtn" class="btn btn-sm btn-outline-primary mb-1">Record</button>
          <button id="recStopBtn" class="btn btn-sm btn-outline-secondary">Stop</button>
        </div>
      </div>
      <div id="audioPreview" class="mt-2"></div>`;
    setupRecorderUI();
  } else if(type === 'image'){
    form.innerHTML = `<input type="file" id="annImageFile" accept="image/*" class="form-control"><div id="imagePreview" class="mt-2"></div>`;
    el('#annImageFile').addEventListener('change', e=>{
      const f = e.target.files[0];
      if(!f) return;
      el('#imagePreview').innerHTML = `<img src="${URL.createObjectURL(f)}" style="max-width:240px;border-radius:6px">`;
    });
  } else if(type === 'video'){
    form.innerHTML = `<input type="file" id="annVideoFile" accept="video/*" class="form-control"><div class="form-check mt-2"><input type="checkbox" id="annVideoMute" class="form-check-input"><label class="form-check-label">Mute Audio</label></div><div id="videoPreview" class="mt-2"></div>`;
    el('#annVideoFile').addEventListener('change', e=>{
      const f = e.target.files[0];
      if(!f) return;
      el('#videoPreview').innerHTML = `<video controls src="${URL.createObjectURL(f)}" style="max-width:420px;border-radius:6px"></video>`;
    });
  }
}

let mediaRecorder = null;
function setupRecorderUI(){
  const startBtn = el('#recStartBtn');
  const stopBtn  = el('#recStopBtn');
  const preview = el('#audioPreview');
  startBtn.onclick = async ()=>{
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('Mic not supported');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedAudioBlob = null;
    mediaRecorder = new MediaRecorder(stream);
    const chunks = [];
    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      recordedAudioBlob = blob;
      preview.innerHTML = `<audio controls src="${URL.createObjectURL(blob)}"></audio>`;
    };
    mediaRecorder.start();
    toast('Recording started');
  };
  stopBtn.onclick = ()=>{ if(mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop(); };
}

async function uploadToStorage(fileOrBlob, name){
  const path = `uploads/${name}_${Date.now()}`;
  const ref = storage.ref().child(path);
  await ref.put(fileOrBlob);
  const url = await ref.getDownloadURL();
  return url;
}

function loadRoomsForAnnouncementPanel(){
  const container = el('#annRooms');
  container.innerHTML = '<div class="text-muted">Loading rooms...</div>';
  db.ref('rooms').on('value', snap=>{
    const rooms = snap.val() || {};
    roomsCache = rooms;
    container.innerHTML = Object.keys(rooms).map(rid=>{
      const meta = rooms[rid].meta || rooms[rid];
      const name = meta.name || rid;
      const checked = meta.active===false ? '' : 'checked';
      return `<div class="room-switch"><div>${name}</div><div><input type="checkbox" class="room-toggle" data-room-id="${rid}" ${checked}></div></div>`;
    }).join('') || '<div class="text-muted">No rooms yet</div>';

    qAll('#annRooms input.room-toggle').forEach(cb=>{
      cb.addEventListener('change', e=>{
        const rid = e.target.dataset.roomId;
        const val = e.target.checked;
        db.ref(`rooms/${rid}/meta/active`).set(val);
      });
    });
  });
}

async function sendAnnouncementToRooms(base, roomIds){
  const tasks = roomIds.map(async rid=>{
    const currentPath = `rooms/${rid}/currentAnnouncement`;
    const historyPath = `rooms/${rid}/history`;
    await db.ref(currentPath).set(base);
    await db.ref(historyPath).push(base);
  });
  await Promise.all(tasks);
  await db.ref('announcements').push(Object.assign({}, base, { roomIds }));
}

function loadAnnouncementHistory(){
  const container = el('#announcementHistory');
  container.innerHTML = '<div class="text-muted">Loading...</div>';
  db.ref('announcements').limitToLast(50).on('value', snap=>{
    const data = snap.val() || {};
    const items = Object.keys(data).map(k=>data[k]).reverse();
    container.innerHTML = items.map(it=>{
      const ts = new Date(it.timestamp).toLocaleString();
      const rooms = (it.roomIds||[]).map(rid=>roomsCache[rid]?.meta?.name || roomsCache[rid]?.name || rid).join(', ');
      return `<div style="padding:8px;border-bottom:1px solid #f0f0f0;"><small class="text-muted">${ts}</small><div><b>${it.type.toUpperCase()}</b>: ${it.message || (it.mediaUrl?'<i>media</i>':'')}</div><div class="small text-muted">Rooms: ${rooms}</div></div>`;
    }).join('') || '<div class="text-muted">No announcements yet</div>';
  });
}

/* ---------------- ROOMS ---------------- */
function roomsHTML(){
  return `
    <div class="panel">
      <h5>Rooms</h5>
      <div class="d-flex gap-2 mb-3">
        <input id="roomAddInput" class="form-control" placeholder="Room ID (e.g., room101)">
        <select id="roomTypeSelect" class="form-select" style="width:120px;"><option>LCD</option><option>LED</option></select>
        <button id="addRoomBtn" class="btn btn-success">Add Room</button>
      </div>
      <div id="roomsList"></div>
    </div>
  `;
}

function attachRoomsLogic(){
  el('#addRoomBtn').onclick = ()=>{
    const id = (el('#roomAddInput').value||'').trim();
    const type = el('#roomTypeSelect').value || 'LCD';
    if(!id) return toast('Enter room id');
    db.ref(`rooms/${id}/meta`).set({ name: id, type, active: true }).then(()=>{ el('#roomAddInput').value=''; });
  };

  db.ref('rooms').on('value', snap=>{
    const cont = el('#roomsList');
    const rooms = snap.val() || {};
    cont.innerHTML = Object.keys(rooms).map(rid=>{
      const meta = rooms[rid].meta || rooms[rid];
      return `<div class="room-card"><div><b>${meta.name||rid}</b><div class="small text-muted">${meta.type||'-'}</div></div><div><button class="btn btn-sm btn-danger" data-room="${rid}">Delete</button></div></div>`;
    }).join('') || '<div class="text-muted">No rooms</div>';
    qAll('#roomsList .btn-danger').forEach(btn=>{
      btn.onclick = ()=>{
        const rid = btn.dataset.room;
        if(confirm(`Delete room ${rid}?`)) db.ref(`rooms/${rid}`).remove();
      };
    });
  });
}

/* ---------------- STATUS ---------------- */
function statusHTML(){
  return `
    <div class="panel-grid">
      <div class="panel"><h4>Displays Connected</h4><div id="statDisplays" class="big">0</div></div>
      <div class="panel"><h4>Speakers Connected</h4><div id="statSpeakers" class="big">0</div></div>
    </div>
    <div class="panel"><h5>Device Status (last heartbeats)</h5><div id="deviceStatusList"></div></div>
  `;
}

function attachStatusLogic(){
  db.ref('status').on('value', snap=>{
    const data = snap.val() || {};
    let displays = 0, speakers = 0;
    const list = el('#deviceStatusList');
    list.innerHTML = Object.keys(data).map(k=>{
      const info = data[k].info||{};
      if(info.online){
        if(info.type==='speaker') speakers++; else displays++;
      }
      const last = info.ts ? new Date(info.ts).toLocaleString() : '-';
      return `<div style="padding:8px;border-bottom:1px solid #f3f3f3;"><b>${k}</b> - ${info.ip||''} - ${info.type||'device'} - ${info.online?'<span style="color:green">Online</span>':'<span style="color:red">Offline</span>'} <div class="small text-muted">last: ${last}</div></div>`;
    }).join('') || '<div class="text-muted">No device status</div>';
    el('#statDisplays') && (el('#statDisplays').innerText = displays);
    el('#statSpeakers') && (el('#statSpeakers').innerText = speakers);
    list.innerHTML = list.innerHTML;
  });
}

// ---------------------- TIMETABLE MODULE ----------------------

// Global
let currentDay = 'Monday';
if(deleteMode){
  qAll('#timetableBody button').forEach(btn=>{
    btn.onclick = ()=> {
      if(!confirm('Delete this timetable entry?')) return;
      const idx = parseInt(btn.dataset.idx);
      db.ref(`timetable/${currentDay}`).once('value').then(snap=>{
        const d = snap.val() || {};
        const flat = [];
        Object.keys(d).forEach(roomId=>{
          const arr = d[roomId] || [];
          if(Array.isArray(arr)) arr.forEach(it=> flat.push({roomId, item: it}));
          else if(typeof arr === 'object') Object.keys(arr).forEach(k=> flat.push({roomId, item: arr[k]}));
        });
        const removed = flat.splice(idx, 1);  // remove the entry

        // Remove row visually with effect
        const tr = btn.closest('tr');
        tr.classList.add('timetable-row-delete');
        setTimeout(()=> tr.remove(), 200);

        // rebuild grouped object and update Firebase
        const newObj = {};
        flat.forEach(f => { if(!newObj[f.roomId]) newObj[f.roomId]=[]; newObj[f.roomId].push(f.item); });
        db.ref(`timetable/${currentDay}`).set(newObj);
      });
    };
  });
}


// ---------------------- MODAL OPENING ----------------------
function openTimetableModal(){
    currentDay = todayName();
    if(currentDay === 'Sunday') currentDay = 'Monday'; // skip Sunday

    highlightActiveDay(currentDay);
    attachDayTabHandlers();
    loadDayTimetable(currentDay);

    // Show modal
    new bootstrap.Modal(el('#timetableModal')).show();
}

// Highlight active tab
function highlightActiveDay(day){
    qAll('#dayTabs button').forEach(btn => btn.classList.remove('active'));
    const btn = qAll('#dayTabs button').find(b => b.dataset.day === day);
    if(btn) btn.classList.add('active');
}

// Attach click handlers for day tabs
function attachDayTabHandlers(){
    qAll('#dayTabs button').forEach(tb => {
        tb.onclick = () => {
            currentDay = tb.dataset.day;
            highlightActiveDay(currentDay);
            loadDayTimetable(currentDay);
        };
    });
}

// ---------------------- LOAD TIMETABLE ----------------------
function loadDayTimetable(day){
    const tbody = el('#timetableBody');
    showLoadingRow(tbody);

    db.ref(`timetable/${day}`).once('value').then(snap => {
        const data = snap.val() || {};
        const flatRows = flattenTimetableData(data);

        if(flatRows.length === 0){
            showEmptyRow(tbody, day);
            return;
        }

        renderTimetableRows(tbody, flatRows);
    });
}

// Show loading
function showLoadingRow(tbody){
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted">Loading...</td></tr>`;
}

// Show empty row
function showEmptyRow(tbody, day){
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No entries for ${day}</td></tr>`;
}

// Flatten data from Firebase object to array with room info
function flattenTimetableData(data){
    const rows = [];
    Object.keys(data).forEach(roomId => {
        const arr = data[roomId];
        if(Array.isArray(arr)){
            arr.forEach(e => rows.push({...e, room: roomId}));
        } else if(typeof arr === 'object'){
            Object.keys(arr).forEach(k => rows.push({...arr[k], room: roomId}));
        }
    });
    return rows;
}

// Render table rows
function renderTimetableRows(tbody, rows){
    const deleteMode = el('#editTimetableBtn').dataset.mode === 'delete';
    tbody.innerHTML = rows.map((r,i) => {
        return `<tr>
            <td>${r.serial || i+1}</td>
            <td>${r.room || r.roomNo || ''}</td>
            <td>${r.subject || ''}</td>
            <td>${r.professor || ''}</td>
            <td>${r.start || ''}</td>
            <td>${r.end || ''}${deleteMode ? ` <button class="btn btn-sm btn-danger ms-2" onclick="deleteTimetableEntry(${i})">Delete</button>` : ''}</td>
        </tr>`;
    }).join('');
}

// ---------------------- ADD ENTRY ----------------------
function showManualTimeTableForm(){
    new bootstrap.Modal(el('#manualTimeTableModal')).show();
}

// Add new entry
function addManualEntry(){
    const serial = el('#serialNo').value || '';
    const room = el('#roomNo').value || '';
    const subject = el('#subject').value || '';
    const professor = el('#professor').value || '';
    const start = el('#startTime').value || '';
    const end = el('#endTime').value || '';

    if(!room || !subject || !start || !end){
        toast('Please fill required fields (room, subject, start, end)');
        return;
    }

    db.ref(`timetable/${currentDay}/${room}`).once('value').then(snap => {
        let arr = snap.val() || [];
        arr = ensureArray(arr);

        arr.push({ serial, roomNo: room, subject, professor, start, end });
        db.ref(`timetable/${currentDay}/${room}`).set(arr).then(() => {
            toast('Entry added successfully');
            clearManualEntryForm();
            loadDayTimetable(currentDay);
            closeModal('#manualTimeTableModal');
        });
    });
}

// Ensure value is array
function ensureArray(val){
    if(Array.isArray(val)) return val;
    if(typeof val === 'object') return Object.keys(val).map(k => val[k]);
    return [];
}

// Clear manual form inputs
function clearManualEntryForm(){
    ['#serialNo','#roomNo','#subject','#professor','#startTime','#endTime'].forEach(sel => el(sel).value = '');
}

// Close Bootstrap modal
function closeModal(modalId){
    const modal = bootstrap.Modal.getInstance(el(modalId));
    if(modal) modal.hide();
}

// ---------------------- DELETE ENTRY ----------------------
function deleteTimetableEntry(index){
    if(!confirm('Delete this timetable entry?')) return;

    db.ref(`timetable/${currentDay}`).once('value').then(snap => {
        const d = snap.val() || {};
        const flat = flattenFirebaseDataForDelete(d);

        flat.splice(index,1); // Remove entry
        const rebuilt = rebuildFirebaseData(flat);

        db.ref(`timetable/${currentDay}`).set(rebuilt).then(() => {
            toast('Entry deleted');
            loadDayTimetable(currentDay);
        });
    });
}

// Flatten Firebase data into array for deletion
function flattenFirebaseDataForDelete(data){
    const flat = [];
    Object.keys(data).forEach(roomId => {
        const arr = data[roomId] || [];
        if(Array.isArray(arr)){
            arr.forEach(item => flat.push({roomId, item}));
        } else if(typeof arr === 'object'){
            Object.keys(arr).forEach(k => flat.push({roomId, item: arr[k]}));
        }
    });
    return flat;
}

// Rebuild Firebase object after deletion
function rebuildFirebaseData(flat){
    const obj = {};
    flat.forEach(f => {
        if(!obj[f.roomId]) obj[f.roomId] = [];
        obj[f.roomId].push(f.item);
    });
    return obj;
}

// ---------------------- EDIT MODE ----------------------
function toggleEditMode(){
    const btn = el('#editTimetableBtn');
    if(btn.dataset.mode === 'delete'){
        btn.dataset.mode = '';
        btn.innerText = 'Edit';
    } else {
        btn.dataset.mode = 'delete';
        btn.innerText = 'Done';
    }
    loadDayTimetable(currentDay);
}

/* ---------------- USER MODAL ---------------- */
function openUserModal(){
  const modal = new bootstrap.Modal(document.getElementById('userModal'));
  modal.show();
  db.ref('users').once('value').then(snap=> el('#userDetails').innerHTML = Object.keys(snap.val()||{}).map(k=>`<div><b>${snap.val()[k].name||k}</b><div class="small text-muted">${snap.val()[k].email||''}</div></div>`).join('') || '<div class="text-muted">No users</div>');
  db.ref('loginHistory').limitToLast(20).once('value').then(snap=> el('#loginHistory').innerHTML = Object.keys(snap.val()||{}).reverse().map(k=>`<div>${new Date(parseInt(k)*1000).toLocaleString()} - ${snap.val()[k]}</div>`).join('') || '<div class="text-muted">No login history</div>');
}

/* ----------------- Init default page ----------------- */
loadPage('dashboard');
