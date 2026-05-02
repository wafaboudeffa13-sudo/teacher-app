const params = new URLSearchParams(window.location.search);
const ROLE = params.get('role') === 'teacher' ? 'teacher' : 'student';
let USER_NAME = ROLE === 'teacher' ? '👨‍🏫 الأستاذ' : '';
let ROOM_ID = params.get('room') || '';
let toolbarVisible = true;
const IS_MOBILE = window.matchMedia('(max-width: 768px)').matches;

// سبورة منطقية ثابتة
const LOGICAL_W = 1280, LOGICAL_H = 720;

// فك قفل الصوت في iOS
const SILENT_MP3 = 'data:audio/mp3;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGhlcXVlLm9yZwBURU5DAAAAHQAAA1N3aXRjaCBQbHVzIMKpIE5DSCBTb2Z0d2FyZQBUSVQyAAAABgAAAzIyMzUAVFNTRQAAAA8AAANMYXZmNTcuODMuMTAwAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/zQsQbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  try { new Audio(SILENT_MP3).play().then(() => { audioUnlocked = true; }).catch(()=>{}); } catch(e){}
}

// ===== Popups =====
function showTeacherPopup() {
  const p = document.getElementById('teacherPopup'); p.style.display='flex';
  const i = document.getElementById('roomInput'); if (ROOM_ID) i.value=ROOM_ID;
  setTimeout(() => i.focus(), 150);
}
function confirmTeacher() {
  const v = document.getElementById('roomInput').value.trim().toLowerCase().replace(/\s+/g,'-');
  if (!v) { showToast('⚠️ أدخل كود الغرفة!'); return; }
  ROOM_ID = v;
  document.getElementById('teacherPopup').style.display='none';
  unlockAudio(); setupRole(); initSocket();
}
function showNamePopup() {
  document.getElementById('namePopup').style.display='flex';
  if (ROOM_ID) document.getElementById('roomInputStudent').value=ROOM_ID;
  setTimeout(() => document.getElementById('nameInput').focus(), 150);
}
function confirmStudent() {
  const n = document.getElementById('nameInput').value.trim();
  const r = document.getElementById('roomInputStudent').value.trim().toLowerCase().replace(/\s+/g,'-');
  if (!n) { showToast('⚠️ اكتب اسمك!'); return; }
  if (!r) { showToast('⚠️ أدخل كود الغرفة!'); return; }
  USER_NAME = n; ROOM_ID = r;
  document.getElementById('namePopup').style.display='none';
  document.getElementById('waitingScreen').style.display='flex';
  unlockAudio(); initSocket();
}
document.getElementById('roomInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmTeacher(); });
document.getElementById('nameInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmStudent(); });
document.getElementById('roomInputStudent')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmStudent(); });

function shareRoomLink() {
  const link = `${window.location.origin}${window.location.pathname}?role=student&room=${ROOM_ID}`;
  navigator.clipboard.writeText(link).then(() => showToast('✅ تم نسخ الرابط!')).catch(() => prompt('انسخ:', link));
}
function toggleToolbar() {
  toolbarVisible = !toolbarVisible;
  document.getElementById('toolbar').classList.toggle('hidden', !toolbarVisible);
  document.getElementById('main').classList.toggle('toolbar-hidden', !toolbarVisible);
  document.getElementById('toolbarToggle').textContent = toolbarVisible ? '✕' : '☰';
  setTimeout(resizeCanvas, 280);
}

// ===== Socket =====
let socket;
function initSocket() {
  socket = io({ query: { role: ROLE, name: USER_NAME, room: ROOM_ID } });
  setupSocketEvents();
}

// ===== Elements =====
const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');
const textInput = document.getElementById('textInput');
const fileInput = document.getElementById('fileInput');
const toast = document.getElementById('toast');
const micBtn = document.getElementById('micBtn');
const micIndicator = document.getElementById('micIndicator');
const chatMessagesEl = document.getElementById('chatMessages');
const chatBox = document.getElementById('chatBox');
const studentsList = document.getElementById('studentsList');
const filesSection = document.getElementById('filesSection');
const filesList = document.getElementById('filesList');
const lockChatBtn = document.getElementById('lockChatBtn');
const pendingSection = document.getElementById('pendingSection');
const pendingList = document.getElementById('pendingList');
const handsSection = document.getElementById('handsSection');
const handsList = document.getElementById('handsList');
const raiseHandBtn = document.getElementById('raiseHandBtn');
const studentMicBtn = document.getElementById('studentMicBtn');
const audioContainer = document.getElementById('audioContainer');

// ===== State =====
let tool = 'pen', drawing = false, lastX = 0, lastY = 0;
let penColor = '#000000', penSize = 3;
let textPos = { x: 0, y: 0 };
let panelOpen = !IS_MOBILE;
let scale = 1, fitScale = 1;
let chatLocked = false, myMuted = false;
let handRaised = false, micGranted = false;
// Audio
let micOn = false, studentMicOn = false;
let teacherStream = null, studentStream = null;
let teacherRecording = false, studentRecording = false;
let teacherRecorder = null, studentRecorder = null;
const blobUrls = new Map();

// ===== Role / Panel =====
function setupRole() {
  const badge = document.getElementById('roleBadge');
  document.getElementById('roomBadge').textContent = `🏫 ${ROOM_ID}`;
  if (ROLE === 'teacher') {
    badge.textContent = '👨‍🏫 الأستاذ'; badge.className = 'teacher';
    document.getElementById('teacherTools').style.display = 'flex';
    if (lockChatBtn) lockChatBtn.style.display = 'block';
  } else {
    badge.textContent = `👨‍🎓 ${USER_NAME}`; badge.className = 'student';
    document.getElementById('studentTools').style.display = 'flex';
    document.getElementById('reactions').style.display = 'flex';
    canvas.style.cursor = 'default';
    if (lockChatBtn) lockChatBtn.style.display = 'none';
  }
}
function applyPanelState() {
  document.getElementById('rightPanel').classList.toggle('collapsed', !panelOpen);
  document.getElementById('toggleLabel').style.display = panelOpen ? 'inline' : 'none';
  document.getElementById('toggleArrow').textContent = panelOpen ? '◀' : '▶';
}
function togglePanel() { panelOpen = !panelOpen; applyPanelState(); setTimeout(resizeCanvas, 280); }

// ===== Canvas (logical 1280x720) =====
function resizeCanvas() {
  let imgData = null;
  try { imgData = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch(e){}
  if (canvas.width !== LOGICAL_W) canvas.width = LOGICAL_W;
  if (canvas.height !== LOGICAL_H) canvas.height = LOGICAL_H;
  const wrapper = document.getElementById('canvas-wrapper');
  fitScale = Math.min(wrapper.clientWidth / LOGICAL_W, wrapper.clientHeight / LOGICAL_H);
  canvas.style.width = (LOGICAL_W * fitScale) + 'px';
  canvas.style.height = (LOGICAL_H * fitScale) + 'px';
  if (imgData) ctx.putImageData(imgData, 0, 0);
  resetCtx(); applyZoom();
}
function applyZoom() {
  canvas.style.transform = scale !== 1 ? `scale(${scale})` : '';
  canvas.style.transformOrigin = scale !== 1 ? '0 0' : '';
}
function resetCtx() { ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle=penColor; ctx.lineWidth=penSize; }
window.addEventListener('resize', () => setTimeout(resizeCanvas, 80));
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 250));

// ===== Zoom =====
function zoom(delta) {
  scale = Math.min(Math.max(0.5, scale + delta), 3);
  applyZoom();
  document.getElementById('zoomLevel').textContent = Math.round(scale*100) + '%';
}
function resetZoom() { scale=1; applyZoom(); document.getElementById('zoomLevel').textContent='100%'; }
document.getElementById('canvas-wrapper').addEventListener('wheel', e => {
  e.preventDefault(); zoom(e.deltaY < 0 ? 0.1 : -0.1);
}, { passive: false });
let lastDist = 0;
canvas.addEventListener('touchstart', e => {
  if (e.touches.length === 2)
    lastDist = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
}, { passive: true });
canvas.addEventListener('touchmove', e => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
    zoom((d-lastDist)*0.005); lastDist = d;
  }
}, { passive: false });

// ===== Tools =====
function setTool(t) {
  if (ROLE !== 'teacher') return;
  tool = t;
  ['penBtn','eraserBtn','textBtn'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  document.getElementById(t+'Btn')?.classList.add('active');
  canvas.style.cursor = t === 'text' ? 'text' : t === 'eraser' ? 'cell' : 'crosshair';
  if (t !== 'text') hideTextInput();
}
document.getElementById('colorPicker')?.addEventListener('input', e => { penColor = e.target.value; resetCtx(); });
document.getElementById('sizeSlider')?.addEventListener('input', e => { penSize = parseInt(e.target.value); resetCtx(); });

// ===== Draw =====
function getPos(e) {
  const r = canvas.getBoundingClientRect();
  const s = e.touches ? e.touches[0] : e;
  return { x: ((s.clientX-r.left)/r.width)*LOGICAL_W, y: ((s.clientY-r.top)/r.height)*LOGICAL_H };
}
function startDraw(e) {
  if (ROLE !== 'teacher') return;
  if (e.touches && e.touches.length > 1) return;
  e.preventDefault();
  if (tool === 'text') { showTextInput(getPos(e)); return; }
  drawing = true;
  const p = getPos(e); lastX = p.x; lastY = p.y;
  socket.emit('draw_start', { x: p.x, y: p.y });
}
function moveDraw(e) {
  if (!drawing || ROLE !== 'teacher') return;
  if (e.touches && e.touches.length > 1) return;
  e.preventDefault();
  const p = getPos(e);
  const d = { x1: lastX, y1: lastY, x2: p.x, y2: p.y, color: penColor, size: penSize, eraser: tool === 'eraser' };
  drawSeg(d); socket.emit('draw_move', d);
  lastX = p.x; lastY = p.y;
}
function endDraw() { if (!drawing) return; drawing = false; socket.emit('draw_end'); }
function drawSeg(d) {
  ctx.beginPath(); ctx.moveTo(d.x1, d.y1); ctx.lineTo(d.x2, d.y2);
  if (d.eraser) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = d.size * 5; ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = d.color; ctx.lineWidth = d.size;
  }
  ctx.lineCap='round'; ctx.lineJoin='round'; ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}
canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', moveDraw);
canvas.addEventListener('mouseup', endDraw);
canvas.addEventListener('mouseleave', endDraw);
canvas.addEventListener('touchstart', startDraw, { passive: false });
canvas.addEventListener('touchmove', moveDraw, { passive: false });
canvas.addEventListener('touchend', endDraw);

// ===== Text =====
function showTextInput(pos) {
  textPos = pos;
  const r = canvas.getBoundingClientRect();
  const sx = r.left + (pos.x/LOGICAL_W)*r.width;
  const sy = r.top + (pos.y/LOGICAL_H)*r.height;
  textInput.style.display='block'; textInput.style.left=sx+'px'; textInput.style.top=(sy-18)+'px';
  textInput.value=''; setTimeout(() => textInput.focus(), 10);
}
function hideTextInput() { textInput.style.display='none'; textInput.value=''; }
textInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const t = textInput.value.trim(); if (!t) { hideTextInput(); return; }
    const d = { text: t, x: textPos.x, y: textPos.y, color: penColor, size: penSize };
    drawText(d); socket.emit('text', d); hideTextInput();
  }
  if (e.key === 'Escape') hideTextInput();
});
function drawText(d) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = `${Math.max(14, d.size*5)}px 'Segoe UI',Tahoma,sans-serif`;
  ctx.fillStyle = d.color || '#000'; ctx.fillText(d.text, d.x, d.y);
}

// ===== Files (blob URLs) =====
function dataUrlToBlobUrl(dataUrl, mime) {
  try {
    const arr = dataUrl.split(',');
    const m = arr[0].match(/:(.*?);/);
    const type = m ? m[1] : (mime || 'application/octet-stream');
    const bstr = atob(arr[1]); let n = bstr.length;
    const u8 = new Uint8Array(n); while(n--) u8[n] = bstr.charCodeAt(n);
    return URL.createObjectURL(new Blob([u8], { type }));
  } catch(e) { return dataUrl; }
}
function fileBlobUrl(d) {
  const k = d.name + '|' + (d.data?.length || 0);
  if (blobUrls.has(k)) return blobUrls.get(k);
  const url = dataUrlToBlobUrl(d.data, d.mime);
  blobUrls.set(k, url); return url;
}
fileInput?.addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    const d = { name: f.name, type: f.type.startsWith('image/') ? 'image' : 'other', mime: f.type, data: ev.target.result };
    if (d.type === 'image') drawImg(d);
    addFileToList(d, true);
    socket.emit('file', d);
    showToast(`✅ تم رفع: ${f.name}`);
  };
  r.readAsDataURL(f); fileInput.value = '';
});
function drawImg(d) {
  const img = new Image();
  img.onload = () => {
    const mw = LOGICAL_W-80, mh = LOGICAL_H-80;
    const ratio = Math.min(mw/img.width, mh/img.height, 1);
    ctx.drawImage(img, 40, 40, img.width*ratio, img.height*ratio);
  };
  img.src = d.data;
}
function addFileToList(d, canDelete) {
  filesSection.style.display='block';
  const id = 'f_'+d.name.replace(/[^a-z0-9]/gi,'_');
  if (document.getElementById(id)) return;
  const url = fileBlobUrl(d);
  const div = document.createElement('div'); div.className='file-item'; div.id=id;
  div.innerHTML = `<a href="${url}" download="${escapeHtml(d.name)}" target="_blank" rel="noopener">📎 ${escapeHtml(d.name)}</a>`;
  if (canDelete) {
    const b = document.createElement('button'); b.className='del-btn'; b.textContent='✕';
    b.onclick = () => { socket.emit('remove_file', { name: d.name }); removeFileFromList(d.name); };
    div.appendChild(b);
  }
  filesList.appendChild(div);
}
function removeFileFromList(name) {
  const el = document.getElementById('f_'+name.replace(/[^a-z0-9]/gi,'_'));
  if (el) el.remove();
  if (!filesList.children.length) filesSection.style.display='none';
}
function showFilePopup(d) {
  const p = document.getElementById('filePopup');
  const url = fileBlobUrl(d);
  document.getElementById('filePopupContent').innerHTML = `
    <div style="margin-bottom:8px">📎 ملف من الأستاذ:</div>
    <strong style="color:var(--green);display:block;margin-bottom:8px;word-break:break-all">${escapeHtml(d.name)}</strong>
    <a class="dl-btn" href="${url}" download="${escapeHtml(d.name)}" target="_blank" rel="noopener">⬇️ تحميل</a>
    <a class="dl-btn" href="${url}" target="_blank" rel="noopener" style="background:var(--purple);margin-right:6px">👁️ فتح</a>`;
  p.style.display='block';
}
function clearBoard() {
  if (ROLE !== 'teacher') return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  socket.emit('clear'); showToast('🗑️ تم مسح السبورة');
}

// ===== AUDIO: clips كاملة كل 1 ثانية =====
function getMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg','audio/mp4;codecs=mp4a.40.2','audio/mp4'];
  for (const t of types) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch(e){} }
  return '';
}
async function toggleMic() {
  if (ROLE !== 'teacher') return;
  if (!micOn) {
    try {
      teacherStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video:false });
      micOn = true; teacherRecording = true;
      micBtn.textContent='🔴 إيقاف'; micBtn.classList.add('on');
      socket.emit('mic_status', { on: true });
      showToast('🎙️ المايك شاغل');
      recordTeacherClip();
    } catch(err) { console.error(err); showToast('❌ تعذر فتح المايك (إذن أو HTTPS)'); }
  } else {
    teacherRecording = false;
    try { if (teacherRecorder?.state !== 'inactive') teacherRecorder?.stop(); } catch(e){}
    teacherRecorder = null;
    teacherStream?.getTracks().forEach(t => t.stop()); teacherStream = null;
    micOn = false; micBtn.textContent='🎙️ مايك'; micBtn.classList.remove('on');
    socket.emit('mic_status', { on: false });
    showToast('🔇 المايك موقوف');
  }
}
function recordTeacherClip() {
  if (!teacherRecording || !teacherStream) return;
  const mime = getMime(); const chunks = [];
  let rec;
  try { rec = new MediaRecorder(teacherStream, mime ? { mimeType:mime, audioBitsPerSecond:64000 } : {}); }
  catch(e) { console.error(e); return; }
  teacherRecorder = rec;
  rec.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
  rec.onstop = async () => {
    if (chunks.length > 0) {
      try {
        const blob = new Blob(chunks, { type: rec.mimeType });
        const buffer = await blob.arrayBuffer();
        socket.emit('audio_chunk', { buffer, mimeType: rec.mimeType });
      } catch(e) { console.error(e); }
    }
    if (teacherRecording) recordTeacherClip();
  };
  try {
    rec.start();
    setTimeout(() => { try { if (rec.state === 'recording') rec.stop(); } catch(e){} }, 1000);
  } catch(e) { console.error(e); }
}
async function toggleStudentMic() {
  if (ROLE !== 'student' || !micGranted) return;
  if (!studentMicOn) {
    try {
      studentStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video:false });
      studentMicOn = true; studentRecording = true;
      studentMicBtn.classList.add('on'); studentMicBtn.textContent='🔴';
      socket.emit('student_mic_status', { on: true });
      showToast('🎙️ مايكك شاغل — تكلم!');
      recordStudentClip();
    } catch(err) { console.error(err); showToast('❌ تعذر فتح المايك'); }
  } else {
    studentRecording = false;
    try { if (studentRecorder?.state !== 'inactive') studentRecorder?.stop(); } catch(e){}
    studentRecorder = null;
    studentStream?.getTracks().forEach(t => t.stop()); studentStream = null;
    studentMicOn = false;
    studentMicBtn.classList.remove('on'); studentMicBtn.textContent='🎙️';
    socket.emit('student_mic_status', { on: false });
    showToast('🔇 سكرت مايكك');
  }
}
function recordStudentClip() {
  if (!studentRecording || !studentStream) return;
  const mime = getMime(); const chunks = [];
  let rec;
  try { rec = new MediaRecorder(studentStream, mime ? { mimeType:mime, audioBitsPerSecond:64000 } : {}); }
  catch(e) { return; }
  studentRecorder = rec;
  rec.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
  rec.onstop = async () => {
    if (chunks.length > 0) {
      try {
        const blob = new Blob(chunks, { type: rec.mimeType });
        const buffer = await blob.arrayBuffer();
        socket.emit('student_audio_chunk', { buffer, mimeType: rec.mimeType });
      } catch(e) {}
    }
    if (studentRecording) recordStudentClip();
  };
  try {
    rec.start();
    setTimeout(() => { try { if (rec.state === 'recording') rec.stop(); } catch(e){} }, 1000);
  } catch(e) {}
}

// ===== Playback (HTML Audio + blob URL) =====
const playQueues = new Map();
function playAudio(sourceId, data) {
  if (!playQueues.has(sourceId)) playQueues.set(sourceId, { items: [], playing: false });
  const q = playQueues.get(sourceId);
  q.items.push(data);
  if (!q.playing) playNext(sourceId);
}
function playNext(sourceId) {
  const q = playQueues.get(sourceId);
  if (!q || q.items.length === 0) { if (q) q.playing = false; return; }
  q.playing = true;
  const data = q.items.shift();
  let buffer;
  if (data.buffer instanceof ArrayBuffer) buffer = data.buffer;
  else if (data.buffer?.byteLength !== undefined) buffer = data.buffer;
  else if (typeof data.buffer === 'object') {
    try { buffer = new Uint8Array(Object.values(data.buffer)).buffer; } catch(e) { playNext(sourceId); return; }
  } else { playNext(sourceId); return; }
  const blob = new Blob([buffer], { type: data.mimeType || 'audio/webm' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.playsInline = true;
  const cleanup = () => { try { URL.revokeObjectURL(url); } catch(e){} playNext(sourceId); };
  audio.onended = cleanup;
  audio.onerror = cleanup;
  audio.play().catch(() => cleanup());
}

// ===== Hand raise =====
function toggleRaiseHand() {
  if (ROLE !== 'student') return;
  unlockAudio();
  handRaised = !handRaised;
  raiseHandBtn.classList.toggle('raised', handRaised);
  socket.emit('raise_hand', { raised: handRaised });
  showToast(handRaised ? '✋ رفعت يدك' : '✋ خفضت يدك');
}

// ===== Chat =====
function sendChat() {
  if (myMuted) { showToast('🔇 الأستاذ كتم رسائلك'); return; }
  if (chatLocked && ROLE !== 'teacher') { showToast('🔒 الشات مقفول'); return; }
  const t = chatBox.value.trim(); if (!t) return;
  socket.emit('chat', { text: t }); chatBox.value = '';
}
chatBox.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
function addChatMsg(m) {
  const div = document.createElement('div');
  div.className = `chat-msg ${m.role}`; div.dataset.id = m.id;
  if (ROLE === 'teacher') {
    div.classList.add('deletable'); div.title = 'اضغط لحذف';
    div.onclick = () => { socket.emit('delete_msg', { id: m.id }); removeMsgEl(m.id); };
  }
  div.innerHTML = `<div class="msg-name">${escapeHtml(m.name)} · ${m.time}</div><div class="msg-text">${escapeHtml(m.text)}</div>`;
  chatMessagesEl.appendChild(div);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}
function removeMsgEl(id) {
  const el = chatMessagesEl.querySelector(`[data-id="${id}"]`); if (el) el.remove();
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toggleChatLock() {
  if (ROLE !== 'teacher') return;
  chatLocked = !chatLocked;
  socket.emit('chat_lock', { locked: chatLocked }); updateLockBtn();
}
function updateLockBtn() {
  if (!lockChatBtn) return;
  lockChatBtn.textContent = chatLocked ? '🔒 مقفول' : '🔓 مفتوح';
  lockChatBtn.classList.toggle('locked', chatLocked);
  if (ROLE !== 'teacher') {
    chatBox.disabled = chatLocked || myMuted;
    chatBox.placeholder = chatLocked ? '🔒 مقفول' : (myMuted ? '🔇 مكتوم' : 'اكتب...');
  }
}

// ===== Lists =====
function updateStudentsList(list) {
  if (!list?.length) {
    studentsList.innerHTML = '<span style="color:rgba(255,255,255,0.3);font-size:10px">لا يوجد</span>'; return;
  }
  studentsList.innerHTML = list.map(s => {
    const mic = s.micActive ? '<span class="speaking">🎙️</span>' : (s.micGranted ? '<span class="mic-on">🎙️</span>' : '');
    const hand = s.handRaised ? '✋ ' : '';
    if (ROLE === 'teacher') {
      const r = s.micGranted ? `<button class="revoke" onclick="revokeMic('${s.id}')">🚫🎙️</button>` : '';
      return `<div class="student-item ${s.muted?'muted':''}">
        <span>${hand}🟢 ${escapeHtml(s.name)} ${mic}</span>
        ${r}
        <button onclick="muteStudent('${s.id}',${!s.muted})">${s.muted?'🔊':'🔇'}</button>
        <button class="kick" onclick="kickStudent('${s.id}')">🚫</button>
      </div>`;
    }
    return `<div class="student-item ${s.muted?'muted':''}"><span>${hand}🟢 ${escapeHtml(s.name)} ${mic}</span></div>`;
  }).join('');
}
function kickStudent(id) { if (confirm('طرد التلميذ؟')) socket.emit('kick_student', { id }); }
function muteStudent(id, m) { socket.emit('mute_student', { id, muted: m }); }
function revokeMic(id) { socket.emit('revoke_mic', { id }); }
function addPending(d) {
  pendingSection.style.display='block';
  const div = document.createElement('div'); div.className='pending-item'; div.id='pending_'+d.id;
  div.innerHTML = `<span>⏳ ${escapeHtml(d.name)}</span>
    <button class="approve" onclick="approveStudent('${d.id}',true)">✅</button>
    <button class="reject" onclick="approveStudent('${d.id}',false)">❌</button>`;
  pendingList.appendChild(div);
  showToast(`🔔 ${d.name} يطلب الدخول`);
}
function removePending(id) {
  const el = document.getElementById('pending_'+id); if (el) el.remove();
  if (!pendingList.children.length) pendingSection.style.display='none';
}
function approveStudent(id, a) { socket.emit('approve_student', { id, approved: a }); removePending(id); }
function updateRaisedHands(list) {
  if (ROLE !== 'teacher') return;
  if (!list?.length) { handsSection.style.display='none'; handsList.innerHTML=''; return; }
  handsSection.style.display='block';
  handsList.innerHTML = list.map(h => `<div class="hand-item">
    <span>✋ ${escapeHtml(h.name)}</span>
    <button class="grant" onclick="grantMic('${h.id}')">🎙️ سمح</button>
    <button class="lower" onclick="lowerHand('${h.id}')">✋</button>
  </div>`).join('');
}
function grantMic(id) { socket.emit('grant_mic', { id }); showToast('✅ سمحت'); }
function lowerHand(id) { socket.emit('revoke_mic', { id }); }
function sendReaction(emoji) {
  if (myMuted) return;
  socket.emit('student_react', { emoji });
  showFloatingReaction(emoji, window.innerWidth/2, window.innerHeight-100);
}
function showFloatingReaction(e, x, y) {
  const el = document.createElement('div'); el.className='reaction-popup'; el.textContent=e;
  el.style.left=x+'px'; el.style.top=y+'px';
  document.body.appendChild(el); setTimeout(() => el.remove(), 2000);
}
let toastTimer;
function showToast(msg) {
  toast.textContent=msg; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===== Socket Events =====
function setupSocketEvents() {
  socket.on('connect', () => { if (ROLE === 'teacher') showToast('🟢 متصل'); });
  socket.on('disconnect', () => showToast('🔴 انقطع'));
  socket.on('waiting_approval', () => document.getElementById('waitingScreen').style.display='flex');
  socket.on('approved', () => {
    document.getElementById('waitingScreen').style.display='none';
    setupRole(); unlockAudio(); showToast('✅ تم قبولك!');
  });
  socket.on('rejected', () => {
    document.getElementById('waitingScreen').style.display='none';
    document.getElementById('rejectedScreen').style.display='flex';
  });
  socket.on('init', s => {
    s.boardState?.strokes?.forEach(x => drawSeg(x));
    s.boardState?.texts?.forEach(t => drawText(t));
    s.boardState?.images?.forEach(i => drawImg(i));
    s.boardState?.files?.forEach(f => addFileToList(f, ROLE === 'teacher'));
    s.chatMessages?.forEach(m => addChatMsg(m));
    updateStudentsList(s.students);
    if (ROLE === 'teacher') updateRaisedHands(s.raisedHands || []);
    chatLocked = !!s.chatLocked; updateLockBtn();
    if (s.roomId) { ROOM_ID=s.roomId; document.getElementById('roomBadge').textContent=`🏫 ${ROOM_ID}`; }
  });
  socket.on('student_pending', d => { if (ROLE === 'teacher') addPending(d); });
  socket.on('draw_start', d => { ctx.beginPath(); ctx.moveTo(d.x, d.y); });
  socket.on('draw_move', d => drawSeg(d));
  socket.on('draw_end', () => {});
  socket.on('text', d => drawText(d));
  socket.on('file', d => {
    if (d.type === 'image') drawImg(d);
    if (ROLE === 'teacher') addFileToList(d, true);
    else { addFileToList(d, false); showFilePopup(d); }
    showToast(`📎 ملف: ${d.name}`);
  });
  socket.on('remove_file', d => removeFileFromList(d.name));
  socket.on('clear', () => { ctx.clearRect(0,0,canvas.width,canvas.height); showToast('🗑️ تمسحت'); });
  socket.on('mic_status', d => {
    micIndicator.style.display = d.on ? 'block' : 'none';
    if (d.on && ROLE === 'student') showToast('🎙️ الأستاذ يتكلم');
  });
  socket.on('audio_chunk', d => { if (ROLE === 'student') playAudio('teacher', d); });
  socket.on('mic_granted', () => {
    micGranted = true; studentMicBtn.classList.add('granted');
    handRaised = false; raiseHandBtn.classList.remove('raised');
    showToast('✅ الأستاذ سمحلك! اضغط 🎙️');
  });
  socket.on('mic_revoked', () => {
    micGranted = false;
    studentMicBtn.classList.remove('granted');
    studentMicBtn.classList.remove('on');
    studentMicBtn.textContent='🎙️';
    if (studentMicOn) {
      studentRecording = false;
      try { studentRecorder?.stop(); } catch(e){}
      studentStream?.getTracks().forEach(t => t.stop());
      studentStream = null; studentMicOn = false;
    }
    showToast('🚫 ألغى الإذن');
  });
  socket.on('student_mic_status', d => {
    if (d.on && ROLE === 'teacher') showToast(`🎙️ ${d.name} يتكلم`);
    if (!d.on) { const q = playQueues.get('s_'+d.id); if (q) { q.items=[]; q.playing=false; } }
  });
  socket.on('student_audio_chunk', d => playAudio('s_'+d.id, d));
  socket.on('chat', m => addChatMsg(m));
  socket.on('chat_clear', () => chatMessagesEl.innerHTML='');
  socket.on('delete_msg', d => removeMsgEl(d.id));
  socket.on('chat_lock', d => {
    chatLocked = !!d.locked; updateLockBtn();
    showToast(d.locked ? '🔒 الشات مقفول' : '🔓 الشات مفتوح');
  });
  socket.on('chat_blocked', d => showToast(d.reason === 'muted' ? '🔇 مكتوم' : '🔒 مقفول'));
  socket.on('you_muted', d => { myMuted = !!d.muted; updateLockBtn(); showToast(myMuted ? '🔇 تم كتمك' : '🔊 فك الكتم'); });
  socket.on('students_list', list => updateStudentsList(list));
  socket.on('raised_hands', list => updateRaisedHands(list));
  socket.on('student_react', d => {
    showFloatingReaction(d.emoji, Math.random()*window.innerWidth*0.7+50, window.innerHeight-120);
    if (ROLE === 'teacher') showToast(`${d.name}: ${d.emoji}`);
  });
  socket.on('kicked', () => document.getElementById('kickedScreen').style.display='flex');
}

// ===== Init =====
applyPanelState();
resizeCanvas();
if (ROLE === 'student') showNamePopup(); else showTeacherPopup();
