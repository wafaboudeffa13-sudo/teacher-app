const params = new URLSearchParams(window.location.search);
const ROLE = params.get('role') === 'teacher' ? 'teacher' : 'student';
let USER_NAME = ROLE === 'teacher' ? '👨‍🏫 الأستاذ' : '';
let ROOM_ID = params.get('room') || '';
let toolbarVisible = true;

const IS_MOBILE = window.matchMedia('(max-width: 768px)').matches;

// ===== سبورة منطقية ثابتة (نفس الحجم لكل الأجهزة) =====
const LOGICAL_W = 1280;
const LOGICAL_H = 720;
let fitScale = 1;

// ===== STUN + TURN =====
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};

// ===== فك قفل الصوت في iOS/Safari =====
const SILENT_MP3 = 'data:audio/mp3;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGhlcXVlLm9yZwBURU5DAAAAHQAAA1N3aXRjaCBQbHVzIMKpIE5DSCBTb2Z0d2FyZQBUSVQyAAAABgAAAzIyMzUAVFNTRQAAAA8AAANMYXZmNTcuODMuMTAwAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/zQsQbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  try {
    const a = new Audio(SILENT_MP3);
    a.play().then(() => { audioUnlocked = true; }).catch(() => {});
  } catch(e) {}
}

// ===== Teacher Popup =====
function showTeacherPopup() {
  const popup = document.getElementById('teacherPopup');
  popup.style.display = 'flex';
  const input = document.getElementById('roomInput');
  if (ROOM_ID) input.value = ROOM_ID;
  setTimeout(() => input.focus(), 150);
}
function confirmTeacher() {
  const val = document.getElementById('roomInput').value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!val) { showToast('⚠️ أدخل كود الغرفة!'); return; }
  ROOM_ID = val;
  document.getElementById('teacherPopup').style.display = 'none';
  unlockAudio();
  setupRole();
  initSocket();
}
document.getElementById('roomInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmTeacher(); });

// ===== Student Popup =====
function showNamePopup() {
  const popup = document.getElementById('namePopup');
  popup.style.display = 'flex';
  if (ROOM_ID) document.getElementById('roomInputStudent').value = ROOM_ID;
  setTimeout(() => document.getElementById('nameInput').focus(), 150);
}
function confirmStudent() {
  const name = document.getElementById('nameInput').value.trim();
  const room = document.getElementById('roomInputStudent').value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!name) { showToast('⚠️ اكتب اسمك!'); return; }
  if (!room) { showToast('⚠️ أدخل كود الغرفة!'); return; }
  USER_NAME = name;
  ROOM_ID = room;
  document.getElementById('namePopup').style.display = 'none';
  document.getElementById('waitingScreen').style.display = 'flex';
  unlockAudio();
  initSocket();
}
document.getElementById('nameInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmStudent(); });
document.getElementById('roomInputStudent')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmStudent(); });

function shareRoomLink() {
  const base = window.location.origin + window.location.pathname;
  const link = `${base}?role=student&room=${ROOM_ID}`;
  navigator.clipboard.writeText(link).then(() => {
    showToast('✅ تم نسخ رابط التلاميذ!');
  }).catch(() => {
    prompt('انسخ هذا الرابط:', link);
  });
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
const canvas         = document.getElementById('whiteboard');
const ctx            = canvas.getContext('2d');
const textInput      = document.getElementById('textInput');
const fileInput      = document.getElementById('fileInput');
const toast          = document.getElementById('toast');
const micBtn         = document.getElementById('micBtn');
const micIndicator   = document.getElementById('micIndicator');
const chatMessagesEl = document.getElementById('chatMessages');
const chatBox        = document.getElementById('chatBox');
const studentsList   = document.getElementById('studentsList');
const filesSection   = document.getElementById('filesSection');
const filesList      = document.getElementById('filesList');
const lockChatBtn    = document.getElementById('lockChatBtn');
const pendingSection = document.getElementById('pendingSection');
const pendingList    = document.getElementById('pendingList');
const handsSection   = document.getElementById('handsSection');
const handsList      = document.getElementById('handsList');
const speakingBanner = document.getElementById('speakingBanner');
const raiseHandBtn   = document.getElementById('raiseHandBtn');
const studentMicBtn  = document.getElementById('studentMicBtn');
const audioContainer = document.getElementById('audioContainer');

// ===== State =====
let tool = 'pen', drawing = false, lastX = 0, lastY = 0;
let penColor = '#000000', penSize = 3;
let micOn = false, textPos = { x: 0, y: 0 };
let panelOpen = !IS_MOBILE;
let scale = 1;
let chatLocked = false, myMuted = false;
let handRaised = false, micGranted = false, studentMicOn = false;
const activeSpeakers = new Map();
const blobUrls = new Map(); // file name -> blob URL (للتنظيف لاحقاً)

// ===== WebRTC =====
let myStream = null;
const outgoingPeers = new Map();
const incomingPeers = new Map();

// ===== Role =====
function setupRole() {
  const badge = document.getElementById('roleBadge');
  const roomBadge = document.getElementById('roomBadge');
  roomBadge.textContent = `🏫 ${ROOM_ID}`;
  if (ROLE === 'teacher') {
    badge.textContent = '👨‍🏫 الأستاذ';
    badge.className = 'teacher';
    document.getElementById('teacherTools').style.display = 'flex';
    if (lockChatBtn) lockChatBtn.style.display = 'block';
  } else {
    badge.textContent = `👨‍🎓 ${USER_NAME}`;
    badge.className = 'student';
    document.getElementById('studentTools').style.display = 'flex';
    document.getElementById('reactions').style.display = 'flex';
    canvas.style.cursor = 'default';
    if (lockChatBtn) lockChatBtn.style.display = 'none';
  }
}

// ===== Panel =====
function applyPanelState() {
  document.getElementById('rightPanel').classList.toggle('collapsed', !panelOpen);
  document.getElementById('toggleLabel').style.display = panelOpen ? 'inline' : 'none';
  document.getElementById('toggleArrow').textContent = panelOpen ? '◀' : '▶';
}
function togglePanel() {
  panelOpen = !panelOpen;
  applyPanelState();
  setTimeout(resizeCanvas, 280);
}

// ===== Canvas (logical fixed size) =====
function resizeCanvas() {
  // نحفظ الصورة قبل
  let imgData = null;
  try { imgData = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch(e) {}

  // الـ resolution الداخلي ثابت
  if (canvas.width !== LOGICAL_W) canvas.width = LOGICAL_W;
  if (canvas.height !== LOGICAL_H) canvas.height = LOGICAL_H;

  // نحسبو fit في الـ wrapper
  const wrapper = document.getElementById('canvas-wrapper');
  const ww = wrapper.clientWidth;
  const wh = wrapper.clientHeight;
  fitScale = Math.min(ww / LOGICAL_W, wh / LOGICAL_H);

  canvas.style.width  = (LOGICAL_W * fitScale) + 'px';
  canvas.style.height = (LOGICAL_H * fitScale) + 'px';

  if (imgData) ctx.putImageData(imgData, 0, 0);
  resetCtx();
  applyZoom();
}
function applyZoom() {
  if (scale !== 1) {
    canvas.style.transform = `scale(${scale})`;
    canvas.style.transformOrigin = '0 0';
  } else {
    canvas.style.transform = '';
    canvas.style.transformOrigin = '';
  }
}
function resetCtx() {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = penColor; ctx.lineWidth = penSize;
}
window.addEventListener('resize', () => setTimeout(resizeCanvas, 80));
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 250));

// ===== Zoom =====
function zoom(delta) {
  scale = Math.min(Math.max(0.5, scale + delta), 3);
  applyZoom();
  document.getElementById('zoomLevel').textContent = Math.round(scale * 100) + '%';
}
function resetZoom() {
  scale = 1;
  applyZoom();
  document.getElementById('zoomLevel').textContent = '100%';
}
document.getElementById('canvas-wrapper').addEventListener('wheel', e => {
  e.preventDefault();
  zoom(e.deltaY < 0 ? 0.1 : -0.1);
}, { passive: false });
let lastDist = 0;
canvas.addEventListener('touchstart', e => {
  if (e.touches.length === 2)
    lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
}, { passive: true });
canvas.addEventListener('touchmove', e => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    zoom((d - lastDist) * 0.005); lastDist = d;
  }
}, { passive: false });

// ===== Tools =====
function setTool(t) {
  if (ROLE !== 'teacher') return;
  tool = t;
  ['penBtn','eraserBtn','textBtn'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  document.getElementById(t + 'Btn')?.classList.add('active');
  canvas.style.cursor = t === 'text' ? 'text' : t === 'eraser' ? 'cell' : 'crosshair';
  if (t !== 'text') hideTextInput();
}
document.getElementById('colorPicker')?.addEventListener('input', e => { penColor = e.target.value; resetCtx(); });
document.getElementById('sizeSlider')?.addEventListener('input', e => { penSize = parseInt(e.target.value); resetCtx(); });

// ===== Draw — coordinates في الفضاء المنطقي =====
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return {
    x: ((src.clientX - rect.left) / rect.width)  * LOGICAL_W,
    y: ((src.clientY - rect.top)  / rect.height) * LOGICAL_H
  };
}
function startDraw(e) {
  if (ROLE !== 'teacher') return;
  if (e.touches && e.touches.length > 1) return;
  e.preventDefault();
  if (tool === 'text') { showTextInput(getPos(e), e); return; }
  drawing = true;
  const p = getPos(e); lastX = p.x; lastY = p.y;
  socket.emit('draw_start', { x: p.x, y: p.y });
}
function moveDraw(e) {
  if (!drawing || ROLE !== 'teacher') return;
  if (e.touches && e.touches.length > 1) return;
  e.preventDefault();
  const p = getPos(e);
  const data = { x1: lastX, y1: lastY, x2: p.x, y2: p.y, color: penColor, size: penSize, eraser: tool === 'eraser' };
  drawSeg(data); socket.emit('draw_move', data);
  lastX = p.x; lastY = p.y;
}
function endDraw() { if (!drawing) return; drawing = false; socket.emit('draw_end'); }
function drawSeg(d) {
  ctx.beginPath(); ctx.moveTo(d.x1, d.y1); ctx.lineTo(d.x2, d.y2);
  if (d.eraser) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = d.size * 5;
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.size;
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}
canvas.addEventListener('mousedown',  startDraw);
canvas.addEventListener('mousemove',  moveDraw);
canvas.addEventListener('mouseup',    endDraw);
canvas.addEventListener('mouseleave', endDraw);
canvas.addEventListener('touchstart', startDraw, { passive: false });
canvas.addEventListener('touchmove',  moveDraw,  { passive: false });
canvas.addEventListener('touchend',   endDraw);

// ===== Text =====
function showTextInput(pos, e) {
  textPos = pos;
  const rect = canvas.getBoundingClientRect();
  // نرجعو من logical لشاشة
  const sx = rect.left + (pos.x / LOGICAL_W) * rect.width;
  const sy = rect.top  + (pos.y / LOGICAL_H) * rect.height;
  textInput.style.display = 'block';
  textInput.style.left = sx + 'px';
  textInput.style.top  = (sy - 18) + 'px';
  textInput.value = '';
  setTimeout(() => textInput.focus(), 10);
}
function hideTextInput() { textInput.style.display = 'none'; textInput.value = ''; }
textInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const text = textInput.value.trim();
    if (!text) { hideTextInput(); return; }
    const d = { text, x: textPos.x, y: textPos.y, color: penColor, size: penSize };
    drawText(d); socket.emit('text', d); hideTextInput();
  }
  if (e.key === 'Escape') hideTextInput();
});
function drawText(d) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = `${Math.max(14, d.size * 5)}px 'Segoe UI', Tahoma, sans-serif`;
  ctx.fillStyle = d.color || '#000';
  ctx.fillText(d.text, d.x, d.y);
}

// ===== Files — blob URL باش يخدم التحميل في كل التليفونات =====
function dataUrlToBlobUrl(dataUrl, fallbackMime) {
  try {
    const arr = dataUrl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : (fallbackMime || 'application/octet-stream');
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8 = new Uint8Array(n);
    while(n--) u8[n] = bstr.charCodeAt(n);
    return URL.createObjectURL(new Blob([u8], { type: mime }));
  } catch(e) { console.error(e); return dataUrl; }
}

fileInput?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const data = {
      name: file.name,
      type: file.type.startsWith('image/') ? 'image' : 'other',
      mime: file.type,
      data: ev.target.result
    };
    if (data.type === 'image') drawImg(data);
    addFileToList(data, true);
    socket.emit('file', data);
    showToast(`✅ تم رفع: ${file.name}`);
  };
  reader.readAsDataURL(file);
  fileInput.value = '';
});
function drawImg(d) {
  const img = new Image();
  img.onload = () => {
    const maxW = LOGICAL_W - 80;
    const maxH = LOGICAL_H - 80;
    const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
    ctx.drawImage(img, 40, 40, img.width * ratio, img.height * ratio);
  };
  img.src = d.data;
}
function fileBlobUrl(d) {
  const key = d.name + '|' + (d.data?.length || 0);
  if (blobUrls.has(key)) return blobUrls.get(key);
  const url = dataUrlToBlobUrl(d.data, d.mime);
  blobUrls.set(key, url);
  return url;
}
function addFileToList(d, canDelete) {
  filesSection.style.display = 'block';
  const safeId = 'f_' + d.name.replace(/[^a-z0-9]/gi, '_');
  if (document.getElementById(safeId)) return;
  const url = fileBlobUrl(d);
  const div = document.createElement('div');
  div.className = 'file-item'; div.id = safeId;
  div.innerHTML = `<a href="${url}" download="${escapeHtml(d.name)}" target="_blank" rel="noopener">📎 ${escapeHtml(d.name)}</a>`;
  if (canDelete) {
    const btn = document.createElement('button');
    btn.className = 'del-btn'; btn.textContent = '✕';
    btn.onclick = () => { socket.emit('remove_file', { name: d.name }); removeFileFromList(d.name); };
    div.appendChild(btn);
  }
  filesList.appendChild(div);
}
function removeFileFromList(name) {
  const el = document.getElementById('f_' + name.replace(/[^a-z0-9]/gi, '_'));
  if (el) el.remove();
  if (!filesList.children.length) filesSection.style.display = 'none';
}
function showFilePopup(d) {
  const popup = document.getElementById('filePopup');
  const content = document.getElementById('filePopupContent');
  const url = fileBlobUrl(d);
  content.innerHTML = `
    <div style="margin-bottom:8px">📎 الأستاذ أرسل ملف:</div>
    <strong style="color:var(--green);display:block;margin-bottom:8px;word-break:break-all">${escapeHtml(d.name)}</strong>
    <a class="dl-btn" href="${url}" download="${escapeHtml(d.name)}" target="_blank" rel="noopener">⬇️ تحميل الملف</a>
    <a class="dl-btn" href="${url}" target="_blank" rel="noopener" style="background:var(--purple);margin-right:6px">👁️ فتح</a>
  `;
  popup.style.display = 'block';
  // ما يختفيش تلقائياً، التلميذ يسكر بنفسو
}

// ===== Clear =====
function clearBoard() {
  if (ROLE !== 'teacher') return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit('clear'); showToast('🗑️ تم مسح السبورة');
}

// ===== WebRTC =====
async function startBroadcasting() {
  if (myStream) return true;
  if (typeof SimplePeer === 'undefined') {
    showToast('❌ مكتبة WebRTC ما تحملت — حدّث الصفحة');
    console.error('SimplePeer is undefined - CDN failed?');
    return false;
  }
  try {
    myStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    console.log('✅ Got mic stream', myStream.getAudioTracks());
    socket.emit('start_broadcast');
    return true;
  } catch(err) {
    console.error('mic error:', err);
    showToast('❌ تعذر فتح المايك (إذن أو HTTPS)');
    myStream = null;
    return false;
  }
}

function stopBroadcasting() {
  outgoingPeers.forEach(peer => { try { peer.destroy(); } catch(e){} });
  outgoingPeers.clear();
  if (myStream) {
    myStream.getTracks().forEach(t => t.stop());
    myStream = null;
  }
  socket.emit('stop_broadcast');
}

function createOutgoingPeer(listenerId) {
  if (outgoingPeers.has(listenerId)) return;
  if (!myStream) { console.warn('no stream yet'); return; }
  if (typeof SimplePeer === 'undefined') return;
  let peer;
  try {
    peer = new SimplePeer({
      initiator: true,
      trickle: true,
      stream: myStream,
      config: RTC_CONFIG
    });
  } catch(e) { console.error('createOutgoingPeer:', e); return; }
  console.log('📡 Creating outgoing peer to', listenerId);
  peer.on('signal', signal => socket.emit('webrtc_signal', { to: listenerId, signal }));
  peer.on('connect', () => console.log('✅ Connected to listener', listenerId));
  peer.on('error', err => console.warn('outgoing peer err:', err));
  peer.on('close', () => { outgoingPeers.delete(listenerId); console.log('❌ Outgoing closed', listenerId); });
  outgoingPeers.set(listenerId, peer);
}

function destroyOutgoingPeer(listenerId) {
  const peer = outgoingPeers.get(listenerId);
  if (peer) { try { peer.destroy(); } catch(e){} }
  outgoingPeers.delete(listenerId);
}

function handleIncomingSignal(from, signal) {
  let peer = incomingPeers.get(from);
  if (!peer) {
    if (typeof SimplePeer === 'undefined') return;
    try {
      peer = new SimplePeer({
        initiator: false,
        trickle: true,
        config: RTC_CONFIG
      });
    } catch(e) { console.error('createIncomingPeer:', e); return; }
    console.log('📡 Creating incoming peer from', from);
    peer.on('signal', sig => socket.emit('webrtc_signal', { to: from, signal: sig }));
    peer.on('connect', () => { console.log('✅ Connected to broadcaster', from); showToast('🎧 الصوت متصل'); });
    peer.on('stream', stream => { console.log('🎧 Got remote stream from', from); attachRemoteStream(from, stream); });
    peer.on('error', err => console.warn('incoming peer err:', err));
    peer.on('close', () => {
      incomingPeers.delete(from);
      detachRemoteStream(from);
      console.log('❌ Incoming closed', from);
    });
    incomingPeers.set(from, peer);
  }
  try { peer.signal(signal); } catch(e) { console.error('peer.signal:', e); }
}

function attachRemoteStream(broadcasterId, stream) {
  let audio = document.getElementById('aud_' + broadcasterId);
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = 'aud_' + broadcasterId;
    audio.autoplay = true;
    audio.playsInline = true;
    audio.controls = false;
    audioContainer.appendChild(audio);
  }
  audio.srcObject = stream;
  audio.play().then(() => {
    console.log('▶️ Playing audio from', broadcasterId);
  }).catch(err => {
    console.warn('autoplay blocked:', err);
    showToast('⚠️ المس الشاشة باش تسمع');
  });
}

function detachRemoteStream(broadcasterId) {
  const audio = document.getElementById('aud_' + broadcasterId);
  if (audio) {
    try { audio.srcObject = null; } catch(e){}
    audio.remove();
  }
}

function destroyAllIncomingPeers() {
  incomingPeers.forEach((peer, id) => {
    try { peer.destroy(); } catch(e){}
    detachRemoteStream(id);
  });
  incomingPeers.clear();
}

// ===== مايك الأستاذ =====
async function toggleMic() {
  if (ROLE !== 'teacher') return;
  if (!micOn) {
    const ok = await startBroadcasting();
    if (!ok) return;
    micOn = true;
    micBtn.textContent = '🔴 إيقاف';
    micBtn.classList.add('on');
    socket.emit('mic_status', { on: true });
    showToast('🎙️ المايك شاغل (Real-time)');
  } else {
    stopBroadcasting();
    micOn = false;
    micBtn.textContent = '🎙️ مايك';
    micBtn.classList.remove('on');
    socket.emit('mic_status', { on: false });
    showToast('🔇 المايك موقوف');
  }
}

// ===== رفع اليد =====
function toggleRaiseHand() {
  if (ROLE !== 'student') return;
  unlockAudio();
  handRaised = !handRaised;
  raiseHandBtn.classList.toggle('raised', handRaised);
  socket.emit('raise_hand', { raised: handRaised });
  showToast(handRaised ? '✋ رفعت يدك — انتظر الأستاذ' : '✋ خفضت يدك');
}

// ===== مايك التلميذ =====
async function toggleStudentMic() {
  if (ROLE !== 'student' || !micGranted) return;
  if (!studentMicOn) {
    const ok = await startBroadcasting();
    if (!ok) return;
    studentMicOn = true;
    studentMicBtn.classList.add('on');
    studentMicBtn.textContent = '🔴';
    studentMicBtn.title = 'اوقف المايك';
    socket.emit('student_mic_status', { on: true });
    showToast('🎙️ مايكك شاغل — تكلم!');
  } else {
    stopBroadcasting();
    studentMicOn = false;
    studentMicBtn.classList.remove('on');
    studentMicBtn.textContent = '🎙️';
    studentMicBtn.title = 'افتح المايك';
    socket.emit('student_mic_status', { on: false });
    showToast('🔇 سكرت مايكك');
  }
}

// ===== Chat =====
function sendChat() {
  if (myMuted) { showToast('🔇 الأستاذ كتم رسائلك'); return; }
  if (chatLocked && ROLE !== 'teacher') { showToast('🔒 الشات مقفول'); return; }
  const text = chatBox.value.trim();
  if (!text) return;
  socket.emit('chat', { text });
  chatBox.value = '';
}
chatBox.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

function addChatMsg(msg) {
  const div = document.createElement('div');
  div.className = `chat-msg ${msg.role}`;
  div.dataset.id = msg.id;
  if (ROLE === 'teacher') {
    div.classList.add('deletable');
    div.title = 'اضغط لحذف';
    div.onclick = () => { socket.emit('delete_msg', { id: msg.id }); removeMsgEl(msg.id); };
  }
  div.innerHTML = `<div class="msg-name">${escapeHtml(msg.name)} · ${msg.time}</div><div class="msg-text">${escapeHtml(msg.text)}</div>`;
  chatMessagesEl.appendChild(div);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}
function removeMsgEl(id) {
  const el = chatMessagesEl.querySelector(`[data-id="${id}"]`);
  if (el) el.remove();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function toggleChatLock() {
  if (ROLE !== 'teacher') return;
  chatLocked = !chatLocked;
  socket.emit('chat_lock', { locked: chatLocked });
  updateLockBtn();
}
function updateLockBtn() {
  if (!lockChatBtn) return;
  lockChatBtn.textContent = chatLocked ? '🔒 مقفول' : '🔓 مفتوح';
  lockChatBtn.classList.toggle('locked', chatLocked);
  if (ROLE !== 'teacher') {
    chatBox.disabled = chatLocked || myMuted;
    chatBox.placeholder = chatLocked ? '🔒 الشات مقفول' : (myMuted ? '🔇 الأستاذ كتم رسائلك' : 'اكتب رسالة...');
  }
}

// ===== التلاميذ =====
function updateStudentsList(list) {
  if (!list || !list.length) {
    studentsList.innerHTML = '<span style="color:rgba(255,255,255,0.3);font-size:10px">لا يوجد تلاميذ</span>';
    return;
  }
  studentsList.innerHTML = list.map(s => {
    const micIcon = s.micActive ? '<span class="speaking">🎙️</span>' : (s.micGranted ? '<span class="mic-on">🎙️</span>' : '');
    const handIcon = s.handRaised ? '✋ ' : '';
    if (ROLE === 'teacher') {
      const micCtrl = s.micGranted
        ? `<button class="revoke" onclick="revokeMic('${s.id}')" title="إلغاء إذن المايك">🚫🎙️</button>`
        : '';
      const muteBtn = `<button onclick="muteStudent('${s.id}', ${!s.muted})" title="${s.muted ? 'فك الكتم' : 'كتم'}">${s.muted ? '🔊' : '🔇'}</button>`;
      return `<div class="student-item ${s.muted ? 'muted' : ''}">
        <span>${handIcon}🟢 ${escapeHtml(s.name)} ${micIcon}</span>
        ${micCtrl}
        ${muteBtn}
        <button class="kick" onclick="kickStudent('${s.id}')" title="طرد">🚫</button>
      </div>`;
    }
    return `<div class="student-item ${s.muted ? 'muted' : ''}"><span>${handIcon}🟢 ${escapeHtml(s.name)} ${micIcon}</span></div>`;
  }).join('');
}
function kickStudent(id) { if (confirm('طرد هذا التلميذ؟')) socket.emit('kick_student', { id }); }
function muteStudent(id, muted) { socket.emit('mute_student', { id, muted }); }
function revokeMic(id) { socket.emit('revoke_mic', { id }); }

// ===== Pending =====
function addPending(data) {
  pendingSection.style.display = 'block';
  const div = document.createElement('div');
  div.className = 'pending-item'; div.id = 'pending_' + data.id;
  div.innerHTML = `
    <span>⏳ ${escapeHtml(data.name)}</span>
    <button class="approve" onclick="approveStudent('${data.id}', true)">✅</button>
    <button class="reject"  onclick="approveStudent('${data.id}', false)">❌</button>
  `;
  pendingList.appendChild(div);
  showToast(`🔔 ${data.name} يطلب الدخول`);
}
function removePending(id) {
  const el = document.getElementById('pending_' + id);
  if (el) el.remove();
  if (!pendingList.children.length) pendingSection.style.display = 'none';
}
function approveStudent(id, approved) {
  socket.emit('approve_student', { id, approved });
  removePending(id);
}

function updateRaisedHands(list) {
  if (ROLE !== 'teacher') return;
  if (!list || !list.length) {
    handsSection.style.display = 'none';
    handsList.innerHTML = '';
    return;
  }
  handsSection.style.display = 'block';
  handsList.innerHTML = list.map(h => `
    <div class="hand-item">
      <span>✋ ${escapeHtml(h.name)}</span>
      <button class="grant" onclick="grantMic('${h.id}')" title="افتحلو المايك">🎙️ سمح</button>
      <button class="lower" onclick="lowerHand('${h.id}')" title="اخفض يده">✋</button>
    </div>
  `).join('');
}
function grantMic(id) { socket.emit('grant_mic', { id }); showToast('✅ سمحت للتلميذ بفتح المايك'); }
function lowerHand(id) { socket.emit('revoke_mic', { id }); }

function sendReaction(emoji) {
  if (myMuted) return;
  socket.emit('student_react', { emoji });
  showFloatingReaction(emoji, window.innerWidth / 2, window.innerHeight - 100);
}
function showFloatingReaction(emoji, x, y) {
  const el = document.createElement('div');
  el.className = 'reaction-popup'; el.textContent = emoji;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg; toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function refreshSpeakingBanner() {
  const names = Array.from(activeSpeakers.values());
  if (names.length === 0) {
    speakingBanner.style.display = 'none';
    return;
  }
  speakingBanner.textContent = '🎙️ يتكلم: ' + names.join('، ');
  speakingBanner.style.display = 'block';
}

// ===== Socket Events =====
function setupSocketEvents() {
  socket.on('connect',    () => { if (ROLE === 'teacher') showToast('🟢 متصل'); });
  socket.on('disconnect', () => {
    showToast('🔴 انقطع الاتصال');
    destroyAllIncomingPeers();
    outgoingPeers.forEach(p => { try { p.destroy(); } catch(e){} });
    outgoingPeers.clear();
  });

  socket.on('waiting_approval', () => {
    document.getElementById('waitingScreen').style.display = 'flex';
  });
  socket.on('approved', () => {
    document.getElementById('waitingScreen').style.display = 'none';
    setupRole();
    unlockAudio();
    showToast('✅ تم قبولك!');
  });
  socket.on('rejected', () => {
    document.getElementById('waitingScreen').style.display = 'none';
    document.getElementById('rejectedScreen').style.display = 'flex';
  });

  socket.on('init', state => {
    state.boardState?.strokes?.forEach(s => drawSeg(s));
    state.boardState?.texts?.forEach(t => drawText(t));
    state.boardState?.images?.forEach(i => drawImg(i));
    state.boardState?.files?.forEach(f => addFileToList(f, ROLE === 'teacher'));
    state.chatMessages?.forEach(m => addChatMsg(m));
    updateStudentsList(state.students);
    if (ROLE === 'teacher') updateRaisedHands(state.raisedHands || []);
    chatLocked = !!state.chatLocked;
    updateLockBtn();
    if (state.teacherMicOn) micIndicator.style.display = 'block';
    if (state.roomId) {
      ROOM_ID = state.roomId;
      document.getElementById('roomBadge').textContent = `🏫 ${ROOM_ID}`;
    }
  });

  socket.on('student_pending', data => {
    if (ROLE === 'teacher') addPending(data);
  });

  socket.on('draw_start', d => { ctx.beginPath(); ctx.moveTo(d.x, d.y); });
  socket.on('draw_move',  d => drawSeg(d));
  socket.on('draw_end',   () => {});
  socket.on('text',       d => drawText(d));

  socket.on('file', d => {
    if (d.type === 'image') drawImg(d);
    if (ROLE === 'teacher') addFileToList(d, true);
    else { addFileToList(d, false); showFilePopup(d); }
    showToast(`📎 ملف: ${d.name}`);
  });
  socket.on('remove_file', d => removeFileFromList(d.name));
  socket.on('clear', () => { ctx.clearRect(0, 0, canvas.width, canvas.height); showToast('🗑️ السبورة تمسحت'); });

  socket.on('mic_status', d => {
    micIndicator.style.display = d.on ? 'block' : 'none';
    if (d.on && ROLE === 'student') showToast('🎙️ الأستاذ يتكلم');
  });

  socket.on('mic_granted', () => {
    micGranted = true;
    studentMicBtn.classList.add('granted');
    handRaised = false;
    raiseHandBtn.classList.remove('raised');
    showToast('✅ الأستاذ سمحلك! اضغط على 🎙️ باش تتكلم');
  });
  socket.on('mic_revoked', () => {
    micGranted = false;
    studentMicBtn.classList.remove('granted');
    studentMicBtn.classList.remove('on');
    studentMicBtn.textContent = '🎙️';
    if (studentMicOn) {
      stopBroadcasting();
      studentMicOn = false;
    }
    showToast('🚫 الأستاذ ألغى إذن المايك');
  });
  socket.on('student_mic_status', d => {
    if (d.on) {
      activeSpeakers.set(d.id, d.name);
      if (ROLE === 'teacher') showToast(`🎙️ ${d.name} يتكلم`);
    } else {
      activeSpeakers.delete(d.id);
    }
    refreshSpeakingBanner();
  });

  socket.on('broadcast_listeners', listeners => {
    if (!Array.isArray(listeners)) return;
    console.log('📡 Got listeners:', listeners);
    listeners.forEach(id => createOutgoingPeer(id));
  });
  socket.on('new_listener', d => {
    if (myStream) createOutgoingPeer(d.id);
  });
  socket.on('listener_left', d => destroyOutgoingPeer(d.id));
  socket.on('broadcaster_stopped', d => {
    const peer = incomingPeers.get(d.id);
    if (peer) { try { peer.destroy(); } catch(e){} }
    incomingPeers.delete(d.id);
    detachRemoteStream(d.id);
  });
  socket.on('broadcaster_started', d => { console.log('📢 Broadcaster started:', d); });
  socket.on('webrtc_signal', d => handleIncomingSignal(d.from, d.signal));

  socket.on('chat',       m => addChatMsg(m));
  socket.on('chat_clear', () => { chatMessagesEl.innerHTML = ''; });
  socket.on('delete_msg', d => removeMsgEl(d.id));
  socket.on('chat_lock',  d => {
    chatLocked = !!d.locked;
    updateLockBtn();
    showToast(d.locked ? '🔒 الشات مقفول' : '🔓 الشات مفتوح');
  });
  socket.on('chat_blocked', d => {
    showToast(d.reason === 'muted' ? '🔇 الأستاذ كتم رسائلك' : '🔒 الشات مقفول');
  });
  socket.on('you_muted', d => {
    myMuted = !!d.muted;
    updateLockBtn();
    showToast(myMuted ? '🔇 تم كتمك' : '🔊 تم فتح الكتم');
  });

  socket.on('students_list', list => updateStudentsList(list));
  socket.on('raised_hands', list => updateRaisedHands(list));

  socket.on('student_react', d => {
    showFloatingReaction(d.emoji, Math.random() * window.innerWidth * 0.7 + 50, window.innerHeight - 120);
    if (ROLE === 'teacher') showToast(`${d.name}: ${d.emoji}`);
  });

  socket.on('kicked', () => {
    document.getElementById('kickedScreen').style.display = 'flex';
  });
}

// ===== Init =====
applyPanelState();
resizeCanvas();
if (ROLE === 'student') {
  showNamePopup();
} else {
  showTeacherPopup();
}
