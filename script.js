const params = new URLSearchParams(window.location.search);
const ROLE = params.get('role') === 'teacher' ? 'teacher' : 'student';
let USER_NAME = ROLE === 'teacher' ? '👨‍🏫 الأستاذ' : '';
let ROOM_ID = params.get('room') || '';
let toolbarVisible = true;

// ===== AudioContext (نفعّله مع أول ضغطة المستخدم) =====
let audioContext = null;
const audioQueues = new Map(); // sourceId -> { queue: [], playing: false }

function ensureAudioContext() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
  } catch (e) { /* ignore */ }
  return audioContext;
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
  ensureAudioContext(); // تفعيل الصوت بضغطة المستخدم
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
  ensureAudioContext(); // تفعيل الصوت بضغطة المستخدم — باش يسمع الأستاذ تلقائياً
  initSocket();
}
document.getElementById('nameInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmStudent(); });
document.getElementById('roomInputStudent')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmStudent(); });

// ===== Share Room Link =====
function shareRoomLink() {
  const base = window.location.origin + window.location.pathname;
  const link = `${base}?role=student&room=${ROOM_ID}`;
  navigator.clipboard.writeText(link).then(() => {
    showToast('✅ تم نسخ رابط التلاميذ!');
  }).catch(() => {
    prompt('انسخ هذا الرابط:', link);
  });
}

// ===== Toolbar Toggle =====
function toggleToolbar() {
  toolbarVisible = !toolbarVisible;
  document.getElementById('toolbar').classList.toggle('hidden', !toolbarVisible);
  document.getElementById('main').classList.toggle('toolbar-hidden', !toolbarVisible);
  document.getElementById('toolbarToggle').textContent = toolbarVisible ? '✕' : '☰';
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
const pendingSection = document.getElementById('pendingSection');
const pendingList    = document.getElementById('pendingList');
const handsSection   = document.getElementById('handsSection');
const handsList      = document.getElementById('handsList');
const speakingBanner = document.getElementById('speakingBanner');
const raiseHandBtn   = document.getElementById('raiseHandBtn');
const studentMicBtn  = document.getElementById('studentMicBtn');

// ===== State =====
let tool = 'pen', drawing = false, lastX = 0, lastY = 0;
let penColor = '#000000', penSize = 3;
let micOn = false, localStream = null, textPos = { x: 0, y: 0 };
let panelOpen = true;
let scale = 1;
let mediaRecorder = null;
// رفع اليد + مايك التلميذ
let handRaised = false;
let micGranted = false;
let studentMicOn = false;
let studentMediaRecorder = null;
let studentLocalStream = null;
const activeSpeakers = new Map(); // id -> name

// ===== Role =====
function setupRole() {
  const badge = document.getElementById('roleBadge');
  const roomBadge = document.getElementById('roomBadge');
  roomBadge.textContent = `🏫 ${ROOM_ID}`;
  if (ROLE === 'teacher') {
    badge.textContent = '👨‍🏫 الأستاذ';
    badge.className = 'teacher';
    document.getElementById('teacherTools').style.display = 'flex';
  } else {
    badge.textContent = `👨‍🎓 ${USER_NAME}`;
    badge.className = 'student';
    document.getElementById('studentTools').style.display = 'flex';
    document.getElementById('reactions').style.display = 'flex';
    canvas.style.cursor = 'default';
  }
}

// ===== Panel =====
function togglePanel() {
  panelOpen = !panelOpen;
  document.getElementById('rightPanel').classList.toggle('collapsed', !panelOpen);
  document.getElementById('toggleLabel').style.display = panelOpen ? 'inline' : 'none';
  document.getElementById('toggleArrow').textContent = panelOpen ? '◀' : '▶';
}

// ===== Canvas =====
function resizeCanvas() {
  const wrapper = document.getElementById('canvas-wrapper');
  let imgData = null;
  try { imgData = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch(e) {}
  canvas.style.transform = '';
  canvas.width  = wrapper.clientWidth;
  canvas.height = wrapper.clientHeight;
  if (imgData) ctx.putImageData(imgData, 0, 0);
  resetCtx();
  if (scale !== 1) {
    canvas.style.transformOrigin = '0 0';
    canvas.style.transform = `scale(${scale})`;
  }
}
function resetCtx() {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = penColor; ctx.lineWidth = penSize;
}
window.addEventListener('resize', resizeCanvas);

// ===== Zoom =====
function zoom(delta) {
  scale = Math.min(Math.max(0.5, scale + delta), 3);
  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = `scale(${scale})`;
  document.getElementById('zoomLevel').textContent = Math.round(scale * 100) + '%';
}
function resetZoom() {
  scale = 1;
  canvas.style.transform = '';
  canvas.style.transformOrigin = '';
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

// ===== Draw =====
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) / scale,
    y: (src.clientY - rect.top)  / scale
  };
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
function showTextInput(pos) {
  textPos = pos;
  const rect = canvas.getBoundingClientRect();
  textInput.style.display = 'block';
  textInput.style.left = (rect.left + pos.x * scale) + 'px';
  textInput.style.top  = (rect.top  + pos.y * scale - 18) + 'px';
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

// ===== Files =====
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
    const maxW = canvas.width  - 80;
    const maxH = canvas.height - 80;
    const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
    ctx.drawImage(img, 40, 40, img.width * ratio, img.height * ratio);
  };
  img.src = d.data;
}
function addFileToList(d, canDelete) {
  filesSection.style.display = 'block';
  const safeId = 'f_' + d.name.replace(/[^a-z0-9]/gi, '_');
  if (document.getElementById(safeId)) return;
  const div = document.createElement('div');
  div.className = 'file-item'; div.id = safeId;
  div.innerHTML = `<a href="${d.data}" download="${d.name}" target="_blank">📎 ${d.name}</a>`;
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
  content.innerHTML = `
    <div style="margin-bottom:8px">📎 الأستاذ أرسل ملف:</div>
    <strong style="color:var(--green)">${d.name}</strong>
    <a class="dl-btn" href="${d.data}" download="${d.name}">⬇️ تحميل الملف</a>
  `;
  popup.style.display = 'block';
  setTimeout(() => popup.style.display = 'none', 15000);
}

// ===== Clear =====
function clearBoard() {
  if (ROLE !== 'teacher') return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit('clear'); showToast('🗑️ تم مسح السبورة');
}

// ===== مايك الأستاذ =====
async function toggleMic() {
  if (ROLE !== 'teacher') return;
  if (!micOn) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micOn = true;
      micBtn.textContent = '🔴 إيقاف';
      micBtn.classList.add('on');
      socket.emit('mic_status', { on: true });
      showToast('🎙️ المايك شاغل');
      startTeacherAudioStream();
    } catch(err) {
      console.error(err);
      showToast('❌ تعذر فتح المايك (تأكد من الإذن)');
    }
  } else {
    stopTeacherAudioStream();
    micOn = false;
    micBtn.textContent = '🎙️ مايك';
    micBtn.classList.remove('on');
    socket.emit('mic_status', { on: false });
    showToast('🔇 المايك موقوف');
  }
}

function getSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/aac'
  ];
  for (const type of types) {
    try { if (MediaRecorder.isTypeSupported(type)) return type; } catch(e) {}
  }
  return '';
}

function startTeacherAudioStream() {
  const mimeType = getSupportedMimeType();
  try {
    mediaRecorder = new MediaRecorder(localStream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : {});
    mediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        const buffer = await e.data.arrayBuffer();
        socket.emit('audio_chunk', { buffer, mimeType: mediaRecorder.mimeType });
      }
    };
    mediaRecorder.start(200);
  } catch(err) {
    console.error(err);
    showToast('❌ المايك ما خدمش على هذا المتصفح');
  }
}

function stopTeacherAudioStream() {
  try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch(e) {}
  mediaRecorder = null;
  localStream?.getTracks().forEach(t => t.stop());
  localStream = null;
}

// ===== رفع اليد (التلميذ) =====
function toggleRaiseHand() {
  if (ROLE !== 'student') return;
  ensureAudioContext();
  handRaised = !handRaised;
  raiseHandBtn.classList.toggle('raised', handRaised);
  socket.emit('raise_hand', { raised: handRaised });
  showToast(handRaised ? '✋ رفعت يدك — انتظر الأستاذ' : '✋ خفضت يدك');
}

// ===== مايك التلميذ =====
async function toggleStudentMic() {
  if (ROLE !== 'student' || !micGranted) return;
  if (!studentMicOn) {
    try {
      studentLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      studentMicOn = true;
      studentMicBtn.classList.add('on');
      studentMicBtn.textContent = '🔴';
      studentMicBtn.title = 'اوقف المايك';
      socket.emit('student_mic_status', { on: true });
      startStudentAudioStream();
      showToast('🎙️ مايكك شاغل — تكلم!');
    } catch(err) {
      console.error(err);
      showToast('❌ تعذر فتح المايك (تأكد من الإذن)');
    }
  } else {
    stopStudentAudioStream();
    studentMicOn = false;
    studentMicBtn.classList.remove('on');
    studentMicBtn.textContent = '🎙️';
    studentMicBtn.title = 'افتح المايك';
    socket.emit('student_mic_status', { on: false });
    showToast('🔇 سكرت مايكك');
  }
}

function startStudentAudioStream() {
  const mimeType = getSupportedMimeType();
  try {
    studentMediaRecorder = new MediaRecorder(studentLocalStream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : {});
    studentMediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        const buffer = await e.data.arrayBuffer();
        socket.emit('student_audio_chunk', { buffer, mimeType: studentMediaRecorder.mimeType });
      }
    };
    studentMediaRecorder.start(200);
  } catch(err) {
    console.error(err);
    showToast('❌ المايك ما خدمش على هذا المتصفح');
  }
}

function stopStudentAudioStream() {
  try { if (studentMediaRecorder && studentMediaRecorder.state !== 'inactive') studentMediaRecorder.stop(); } catch(e) {}
  studentMediaRecorder = null;
  studentLocalStream?.getTracks().forEach(t => t.stop());
  studentLocalStream = null;
}

// ===== تشغيل الصوت القادم (أستاذ أو تلميذ) =====
async function playAudioFromSource(sourceId, data) {
  ensureAudioContext();
  if (!audioContext) return;
  if (!audioQueues.has(sourceId)) {
    audioQueues.set(sourceId, { queue: [], playing: false });
  }
  const q = audioQueues.get(sourceId);
  q.queue.push(data);
  if (!q.playing) processAudioQueue(sourceId);
}

async function processAudioQueue(sourceId) {
  const q = audioQueues.get(sourceId);
  if (!q || q.queue.length === 0) {
    if (q) q.playing = false;
    return;
  }
  q.playing = true;
  const data = q.queue.shift();
  try {
    let arrayBuffer;
    if (data.buffer instanceof ArrayBuffer) {
      arrayBuffer = data.buffer.slice(0);
    } else if (data.buffer && data.buffer.byteLength !== undefined) {
      // Blob أو Uint8Array
      arrayBuffer = data.buffer.buffer ? data.buffer.buffer.slice(0) : new Uint8Array(data.buffer).buffer;
    } else if (data.buffer && typeof data.buffer === 'object') {
      arrayBuffer = new Uint8Array(Object.values(data.buffer)).buffer;
    } else {
      processAudioQueue(sourceId);
      return;
    }
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.onended = () => processAudioQueue(sourceId);
    source.start();
  } catch(e) {
    processAudioQueue(sourceId);
  }
}

// ===== Chat (مفتوح للجميع) =====
function sendChat() {
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
      const micBtn = s.micGranted
        ? `<button class="revoke" onclick="revokeMic('${s.id}')" title="إلغاء إذن المايك">🚫🎙️</button>`
        : '';
      return `<div class="student-item">
        <span>${handIcon}🟢 ${escapeHtml(s.name)} ${micIcon}</span>
        ${micBtn}
        <button class="kick" onclick="kickStudent('${s.id}')" title="طرد">🚫</button>
      </div>`;
    }
    return `<div class="student-item"><span>${handIcon}🟢 ${escapeHtml(s.name)} ${micIcon}</span></div>`;
  }).join('');
}
function kickStudent(id) { if (confirm('طرد هذا التلميذ؟')) socket.emit('kick_student', { id }); }
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

// ===== رفع الأيدي (للأستاذ) =====
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
function grantMic(id) {
  socket.emit('grant_mic', { id });
  showToast('✅ سمحت للتلميذ بفتح المايك');
}
function lowerHand(id) {
  socket.emit('revoke_mic', { id });
}

// ===== Reactions =====
function sendReaction(emoji) {
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

// ===== Toast =====
let toastTimer;
function showToast(msg) {
  toast.textContent = msg; toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===== مؤشر "يتكلم الآن" =====
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
  socket.on('disconnect', () => showToast('🔴 انقطع الاتصال'));

  socket.on('waiting_approval', () => {
    document.getElementById('waitingScreen').style.display = 'flex';
  });
  socket.on('approved', () => {
    document.getElementById('waitingScreen').style.display = 'none';
    setupRole();
    ensureAudioContext();
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

  // ===== صوت الأستاذ =====
  socket.on('mic_status', d => {
    micIndicator.style.display = d.on ? 'block' : 'none';
    if (d.on) {
      ensureAudioContext();
      if (ROLE === 'student') showToast('🎙️ الأستاذ يتكلم');
    } else {
      const q = audioQueues.get('teacher');
      if (q) { q.queue = []; q.playing = false; }
    }
  });
  socket.on('audio_chunk', async d => {
    if (ROLE === 'student') await playAudioFromSource('teacher', d);
  });

  // ===== صوت التلميذ =====
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
    if (studentMicOn) {
      stopStudentAudioStream();
      studentMicOn = false;
    }
    showToast('🚫 الأستاذ ألغى إذن المايك');
  });
  socket.on('student_mic_status', d => {
    if (d.on) {
      activeSpeakers.set(d.id, d.name);
      ensureAudioContext();
      if (ROLE === 'teacher') showToast(`🎙️ ${d.name} يتكلم`);
    } else {
      activeSpeakers.delete(d.id);
      const q = audioQueues.get('student_' + d.id);
      if (q) { q.queue = []; q.playing = false; }
    }
    refreshSpeakingBanner();
  });
  socket.on('student_audio_chunk', async d => {
    // مايجيش للمرسل أصلاً (socket.to)
    await playAudioFromSource('student_' + d.id, d);
  });

  // ===== شات =====
  socket.on('chat',       m => addChatMsg(m));
  socket.on('chat_clear', () => { chatMessagesEl.innerHTML = ''; });
  socket.on('delete_msg', d => removeMsgEl(d.id));

  // ===== التلاميذ =====
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
resizeCanvas();
if (ROLE === 'student') {
  showNamePopup();
} else {
  showTeacherPopup();
}
