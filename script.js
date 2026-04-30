const params = new URLSearchParams(window.location.search);
const ROLE = params.get('role') === 'teacher' ? 'teacher' : 'student';
let USER_NAME = ROLE === 'teacher' ? '👨‍🏫 الأستاذ' : '';
let toolbarVisible = true;

function showNamePopup() {
  document.getElementById('namePopup').style.display = 'flex';
  setTimeout(() => document.getElementById('nameInput').focus(), 150);
}
function confirmName() {
  const val = document.getElementById('nameInput').value.trim();
  if (!val) { showToast('⚠️ اكتب اسمك!'); return; }
  USER_NAME = val;
  document.getElementById('namePopup').style.display = 'none';
  document.getElementById('waitingScreen').style.display = 'flex';
  initSocket();
}
document.getElementById('nameInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmName(); });

function toggleToolbar() {
  toolbarVisible = !toolbarVisible;
  document.getElementById('toolbar').classList.toggle('hidden', !toolbarVisible);
  document.getElementById('main').classList.toggle('toolbar-hidden', !toolbarVisible);
  document.getElementById('toolbarToggle').textContent = toolbarVisible ? '✕' : '☰';
}

let socket;
function initSocket() {
  socket = io({ query: { role: ROLE, name: USER_NAME } });
  setupSocketEvents();
}

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

let tool = 'pen', drawing = false, lastX = 0, lastY = 0;
let penColor = '#000000', penSize = 3;
let micOn = false, localStream = null, textPos = { x: 0, y: 0 };
let panelOpen = true, chatLocked = false, myMuted = false;
let scale = 1, peerConnection = null;
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ===== Role =====
function setupRole() {
  const badge = document.getElementById('roleBadge');
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

  // نرجع الـ transform لـ default باش يحسب الحجم صح
  canvas.style.transform = '';
  canvas.width  = wrapper.clientWidth;
  canvas.height = wrapper.clientHeight;

  if (imgData) ctx.putImageData(imgData, 0, 0);
  resetCtx();

  // نرجع الـ scale
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

// ===== Mic =====
async function toggleMic() {
  if (ROLE !== 'teacher') return;
  if (!micOn) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micOn = true; micBtn.textContent = '🔴 إيقاف'; micBtn.classList.add('on');
      socket.emit('mic_status', { on: true }); showToast('🎙️ المايك شاغل');
      await startWebRTC();
    } catch { showToast('❌ تعذر فتح المايك'); }
  } else {
    stopWebRTC(); micOn = false; micBtn.textContent = '🎙️ مايك'; micBtn.classList.remove('on');
    socket.emit('mic_status', { on: false }); showToast('🔇 المايك موقوف');
  }
}
async function startWebRTC() {
  peerConnection = new RTCPeerConnection(RTC_CONFIG);
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
  peerConnection.onicecandidate = e => { if (e.candidate) socket.emit('webrtc_ice', e.candidate); };
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('webrtc_offer', offer);
}
function stopWebRTC() {
  localStream?.getTracks().forEach(t => t.stop());
  peerConnection?.close(); peerConnection = null; localStream = null;
}
async function handleOffer(offer) {
  peerConnection = new RTCPeerConnection(RTC_CONFIG);
  peerConnection.ontrack = e => {
    let audio = document.getElementById('teacherAudio');
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'teacherAudio'; audio.autoplay = true;
      document.body.appendChild(audio);
    }
    audio.srcObject = e.streams[0];
  };
  peerConnection.onicecandidate = e => { if (e.candidate) socket.emit('webrtc_ice', e.candidate); };
  await peerConnection.setRemoteDescription(offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('webrtc_answer', answer);
}

// ===== Chat =====
function sendChat() {
  if (myMuted || (chatLocked && ROLE !== 'teacher')) { showToast('🔇 الشات موقوف'); return; }
  const text = chatBox.value.trim();
  if (!text) return;
  socket.emit('chat', { text }); chatBox.value = '';
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
  div.innerHTML = `<div class="msg-name">${msg.name} · ${msg.time}</div><div class="msg-text">${msg.text}</div>`;
  chatMessagesEl.appendChild(div);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}
function removeMsgEl(id) {
  const el = chatMessagesEl.querySelector(`[data-id="${id}"]`);
  if (el) el.remove();
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
  if (ROLE !== 'teacher') chatBox.disabled = chatLocked || myMuted;
}

// ===== Students =====
function updateStudentsList(list) {
  if (!list || !list.length) {
    studentsList.innerHTML = '<span style="color:rgba(255,255,255,0.3);font-size:10px">لا يوجد تلاميذ</span>';
    return;
  }
  studentsList.innerHTML = list.map(s => {
    if (ROLE === 'teacher') {
      return `<div class="student-item ${s.muted ? 'muted' : ''}">
        <span>🟢 ${s.name}</span>
        <button onclick="muteStudent('${s.id}', ${!s.muted})">${s.muted ? '🔊' : '🔇'}</button>
        <button onclick="kickStudent('${s.id}')">🚫</button>
      </div>`;
    }
    return `<div class="student-item"><span>🟢 ${s.name}</span></div>`;
  }).join('');
}
function kickStudent(id) { socket.emit('kick_student', { id }); }
function muteStudent(id, muted) { socket.emit('mute_student', { id, muted }); }

// ===== Pending =====
function addPending(data) {
  pendingSection.style.display = 'block';
  const div = document.createElement('div');
  div.className = 'pending-item'; div.id = 'pending_' + data.id;
  div.innerHTML = `
    <span>⏳ ${data.name}</span>
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

// ===== Reactions =====
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

// ===== Toast =====
let toastTimer;
function showToast(msg) {
  toast.textContent = msg; toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
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
    chatLocked = state.chatLocked || false;
    updateLockBtn();
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
    if (d.on) showToast('🎙️ الأستاذ يتكلم');
  });
  socket.on('chat',       m => addChatMsg(m));
  socket.on('chat_clear', () => { chatMessagesEl.innerHTML = ''; });
  socket.on('delete_msg', d => removeMsgEl(d.id));
  socket.on('chat_lock',  d => {
    chatLocked = d.locked; updateLockBtn();
    showToast(d.locked ? '🔒 الشات مقفول' : '🔓 الشات مفتوح');
  });
  socket.on('students_list', list => updateStudentsList(list));
  socket.on('student_react', d => {
    showFloatingReaction(d.emoji, Math.random() * window.innerWidth * 0.7 + 50, window.innerHeight - 120);
    if (ROLE === 'teacher') showToast(`${d.name}: ${d.emoji}`);
  });
  socket.on('you_muted', d => {
    myMuted = d.muted;
    if (ROLE !== 'teacher') chatBox.disabled = d.muted || chatLocked;
    showToast(d.muted ? '🔇 تم كتمك' : '🔊 تم فتح الكتم');
  });
  socket.on('kicked', () => {
    document.getElementById('kickedScreen').style.display = 'flex';
  });
  socket.on('webrtc_offer',  async o => { if (ROLE === 'student') await handleOffer(o); });
  socket.on('webrtc_answer', async a => { if (peerConnection) await peerConnection.setRemoteDescription(a); });
  socket.on('webrtc_ice',    async c => { if (peerConnection) await peerConnection.addIceCandidate(c); });
}

// ===== Init =====
resizeCanvas();
if (ROLE === 'student') {
  showNamePopup();
} else {
  setupRole();
  initSocket();
}
