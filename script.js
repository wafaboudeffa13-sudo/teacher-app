// ===== الدور من URL =====
const params = new URLSearchParams(window.location.search);
const ROLE = params.get('role') === 'teacher' ? 'teacher' : 'student';
const NAME = params.get('name') || (ROLE === 'teacher' ? '👨‍🏫 الأستاذ' : '👨‍🎓 تلميذ');

// ===== Socket =====
const socket = io({ query: { role: ROLE, name: NAME } });

// ===== عناصر =====
const canvas       = document.getElementById('whiteboard');
const ctx          = canvas.getContext('2d');
const textInput    = document.getElementById('textInput');
const fileInput    = document.getElementById('fileInput');
const toast        = document.getElementById('toast');
const micBtn       = document.getElementById('micBtn');
const micIndicator = document.getElementById('micIndicator');

// ===== حالة =====
let tool    = 'pen';
let drawing = false;
let lastX = 0, lastY = 0;
let penColor = '#000000';
let penSize  = 3;
let textPos  = { x: 0, y: 0 };

// ===================================================
//  WebRTC للصوت
// ===================================================
let localStream   = null;
let peerConns     = {};   // { socketId: RTCPeerConnection }
let micOn         = false;

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// الأستاذ يفتح المايك ويرسل offer لكل تلميذ
async function toggleMic() {
  if (ROLE !== 'teacher') return;

  if (!micOn) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micOn = true;
      micBtn.textContent = '🔴 إيقاف المايك';
      micBtn.classList.add('on');
      socket.emit('mic_status', { on: true });
      showToast('🎙️ المايك شاغل');
    } catch (err) {
      showToast('❌ ما قدرش يفتح المايك');
      console.error(err);
    }
  } else {
    // إيقاف كل الاتصالات
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;
    Object.values(peerConns).forEach(pc => pc.close());
    peerConns = {};
    micOn = false;
    micBtn.textContent = '🎙️ مايك';
    micBtn.classList.remove('on');
    socket.emit('mic_status', { on: false });
    showToast('🔇 المايك موقوف');
  }
}

// الأستاذ ينشئ peer connection مع تلميذ جديد
async function createOfferForStudent(studentId) {
  if (!localStream) return;

  const pc = new RTCPeerConnection(RTC_CONFIG);
  peerConns[studentId] = pc;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('webrtc_ice', { to: studentId, candidate: e.candidate });
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc_offer', { to: studentId, offer });
  } catch (err) {
    console.error('خطأ في إنشاء offer:', err);
  }
}

// التلميذ يستقبل offer ويرد بـ answer
async function handleOffer(data) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  peerConns[data.from] = pc;

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('webrtc_ice', { to: data.from, candidate: e.candidate });
    }
  };

  pc.ontrack = e => {
    let audio = document.getElementById('teacher-audio');
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'teacher-audio';
      audio.autoplay = true;
      audio.controls = false;
      document.body.appendChild(audio);
    }
    audio.srcObject = e.streams[0];
  };

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc_answer', { to: data.from, answer });
  } catch (err) {
    console.error('خطأ في معالجة offer:', err);
  }
}

// ===================================================
//  إعداد الواجهة حسب الدور
// ===================================================
function setupRole() {
  const badge = document.getElementById('roleBadge');
  if (ROLE === 'teacher') {
    badge.textContent = '👨‍🏫 الأستاذ';
    badge.className = 'teacher';
    document.getElementById('teacherTools').style.display = 'flex';
  } else {
    badge.textContent = '👨‍🎓 التلميذ';
    badge.className = 'student';
    document.getElementById('studentTools').style.display = 'flex';
    document.getElementById('reactions').style.display = 'flex';
    canvas.style.cursor = 'default';
  }
}

// ===================================================
//  حجم الكانفاس
// ===================================================
function resizeCanvas() {
  const wrapper = document.getElementById('canvas-wrapper');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width  = wrapper.clientWidth;
  canvas.height = wrapper.clientHeight;
  ctx.putImageData(img, 0, 0);
  resetCtx();
}

function resetCtx() {
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.strokeStyle = penColor;
  ctx.lineWidth   = penSize;
}

window.addEventListener('resize', resizeCanvas);

// ===================================================
//  الأدوات
// ===================================================
function setTool(t) {
  if (ROLE !== 'teacher') return;
  tool = t;
  ['penBtn','eraserBtn','textBtn'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  document.getElementById(t + 'Btn')?.classList.add('active');
  canvas.style.cursor = t === 'text' ? 'text' : t === 'eraser' ? 'cell' : 'crosshair';
  if (t !== 'text') hideTextInput();
}

document.getElementById('colorPicker')?.addEventListener('input', e => {
  penColor = e.target.value; resetCtx();
});
document.getElementById('sizeSlider')?.addEventListener('input', e => {
  penSize = parseInt(e.target.value); resetCtx();
});

// ===================================================
//  رسم
// ===================================================
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * (canvas.width  / rect.width),
    y: (src.clientY - rect.top)  * (canvas.height / rect.height)
  };
}

function startDraw(e) {
  if (ROLE !== 'teacher') return;
  e.preventDefault();
  if (tool === 'text') { showTextInput(getPos(e)); return; }
  drawing = true;
  const p = getPos(e);
  lastX = p.x; lastY = p.y;
  socket.emit('draw_start', { x: p.x, y: p.y });
}

function moveDraw(e) {
  if (!drawing || ROLE !== 'teacher') return;
  e.preventDefault();
  const p = getPos(e);
  const data = { x1: lastX, y1: lastY, x2: p.x, y2: p.y, color: penColor, size: penSize, eraser: tool === 'eraser' };
  drawSeg(data);
  socket.emit('draw_move', data);
  lastX = p.x; lastY = p.y;
}

function endDraw() {
  if (!drawing) return;
  drawing = false;
  socket.emit('draw_end');
}

function drawSeg(d) {
  ctx.beginPath();
  ctx.moveTo(d.x1, d.y1);
  ctx.lineTo(d.x2, d.y2);
  if (d.eraser) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth  = d.size * 5;
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = d.color;
    ctx.lineWidth   = d.size;
  }
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}

canvas.addEventListener('mousedown',  startDraw);
canvas.addEventListener('mousemove',  moveDraw);
canvas.addEventListener('mouseup',    endDraw);
canvas.addEventListener('mouseleave', endDraw);
canvas.addEventListener('touchstart', startDraw, { passive: false });
canvas.addEventListener('touchmove',  moveDraw,  { passive: false });
canvas.addEventListener('touchend',   endDraw);

// ===================================================
//  نص
// ===================================================
function showTextInput(pos) {
  textPos = pos;
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width  / canvas.width;
  const sy = rect.height / canvas.height;
  textInput.style.display = 'block';
  textInput.style.left = (rect.left + pos.x * sx) + 'px';
  textInput.style.top  = (rect.top  + pos.y * sy - 18) + 'px';
  textInput.value = '';
  setTimeout(() => textInput.focus(), 10);
}

function hideTextInput() {
  textInput.style.display = 'none';
  textInput.value = '';
}

textInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const text = textInput.value.trim();
    if (!text) { hideTextInput(); return; }
    const d = { text, x: textPos.x, y: textPos.y, color: penColor, size: penSize };
    drawText(d);
    socket.emit('text', d);
    hideTextInput();
  }
  if (e.key === 'Escape') hideTextInput();
});

function drawText(d) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.font      = `${Math.max(16, d.size * 5)}px 'Segoe UI', Tahoma, sans-serif`;
  ctx.fillStyle = d.color || '#000';
  ctx.fillText(d.text, d.x, d.y);
}

// ===================================================
//  ملفات (صور + PDF + Word + غيرها)
// ===================================================
fileInput?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  const isImage = file.type.startsWith('image/');

  if (isImage) {
    // الصور: نحولها لـ base64 ونرسمها على الكانفاس
    const reader = new FileReader();
    reader.onload = ev => {
      const d = { type: 'image', data: ev.target.result, name: file.name, x: 60, y: 60, w: 380, h: 260 };
      drawImg(d);
      socket.emit('file', d);
      showToast('✅ تم رفع الصورة: ' + file.name);
    };
    reader.readAsDataURL(file);
  } else {
    // ملفات أخرى (PDF, Word, Excel...): نرسل اسمها ونعرض رابط تحميل
    const reader = new FileReader();
    reader.onload = ev => {
      const d = {
        type: 'document',
        data: ev.target.result,
        name: file.name,
        mime: file.type,
        size: file.size
      };
      socket.emit('file', d);
      showFileNotif(d, true);
      showToast('✅ تم رفع الملف: ' + file.name);
    };
    reader.readAsDataURL(file);
  }

  fileInput.value = '';
});

function drawImg(d) {
  const img = new Image();
  img.onload = () => ctx.drawImage(img, d.x, d.y, d.w, d.h);
  img.src = d.data;
}

function showFileNotif(d, isSender) {
  const notif = document.getElementById('fileNotif');
  const icon  = getFileIcon(d.name);
  const sizeTxt = d.size ? ` (${(d.size / 1024).toFixed(0)} KB)` : '';
  notif.style.display = 'block';
  notif.innerHTML = `
    <div>${icon} ${isSender ? 'أرسلت' : 'الأستاذ أرسل'} ملف: <strong>${d.name}</strong>${sizeTxt}</div>
    <a href="${d.data}" download="${d.name}" style="color:var(--green);display:block;margin-top:6px">
      ⬇️ تحميل الملف
    </a>
    <button onclick="document.getElementById('fileNotif').style.display='none'"
      style="margin-top:6px;padding:4px 12px;border-radius:6px;border:none;background:rgba(255,255,255,0.1);color:white;cursor:pointer">
      ✖ إغلاق
    </button>
  `;
  setTimeout(() => { if(notif.style.display !== 'none') notif.style.display = 'none'; }, 15000);
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = { pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', ppt: '📽️', pptx: '📽️', txt: '📃', zip: '🗜️', rar: '🗜️' };
  return map[ext] || '📁';
}

// ===================================================
//  مسح
// ===================================================
function clearBoard() {
  if (ROLE !== 'teacher') return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit('clear');
  showToast('🗑️ تم مسح السبورة');
}

// ===================================================
//  شات
// ===================================================
function sendChat() {
  const input = document.getElementById('chatBox');
  const text  = input.value.trim();
  if (!text) return;
  socket.emit('chat', { text });
  input.value = '';
}

document.getElementById('chatBox')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendChat();
});

function addChatMessage(msg) {
  const box = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${msg.role}`;
  div.innerHTML = `
    <div class="msg-name">${msg.name} · ${msg.time}</div>
    <div class="msg-text">${escapeHtml(msg.text)}</div>
  `;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ===================================================
//  قائمة التلاميذ
// ===================================================
function updateStudentsList(students) {
  const list = document.getElementById('studentsList');
  if (!students || students.length === 0) {
    list.innerHTML = '<span style="color:rgba(255,255,255,0.3);font-size:11px">لا يوجد تلاميذ بعد</span>';
    return;
  }
  list.innerHTML = students.map(name =>
    `<div class="student-item">🟢 ${escapeHtml(name)}</div>`
  ).join('');
}

// ===================================================
//  تفاعلات الطالب
// ===================================================
function sendReaction(emoji) {
  socket.emit('student_react', { emoji });
  showFloatingReaction(emoji, window.innerWidth / 2, window.innerHeight - 100);
}

function showFloatingReaction(emoji, x, y) {
  const el = document.createElement('div');
  el.className  = 'reaction-popup';
  el.textContent = emoji;
  el.style.left  = x + 'px';
  el.style.top   = y + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

// ===================================================
//  Toast
// ===================================================
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===================================================
//  Socket events
// ===================================================
socket.on('connect',    () => showToast('🟢 متصل'));
socket.on('disconnect', () => showToast('🔴 انقطع الاتصال'));

// استقبال الحالة الأولية
socket.on('init', state => {
  state.boardState?.strokes?.forEach(s => drawSeg(s));
  state.boardState?.texts?.forEach(t => drawText(t));
  state.boardState?.images?.forEach(i => drawImg(i));
  state.chatMessages?.forEach(m => addChatMessage(m));
  updateStudentsList(state.students);
});

// رسم
socket.on('draw_start', d => { ctx.beginPath(); ctx.moveTo(d.x, d.y); });
socket.on('draw_move',  d => drawSeg(d));
socket.on('draw_end',   () => {});
socket.on('text',       d => drawText(d));

// ملفات
socket.on('file', d => {
  if (d.type === 'image') {
    drawImg(d);
    showToast('📷 الأستاذ رفع صورة');
  } else {
    showFileNotif(d, false);
    showToast(`${getFileIcon(d.name)} الأستاذ أرسل: ${d.name}`);
  }
});

// مسح
socket.on('clear', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  showToast('🗑️ السبورة تمسحت');
});

// مايك
socket.on('mic_status', d => {
  micIndicator.style.display = d.on ? 'block' : 'none';
  if (d.on) showToast('🎙️ الأستاذ يتكلم');
});

// ===== WebRTC =====
// التلميذ يستقبل offer من الأستاذ
socket.on('webrtc_offer', async data => {
  if (ROLE !== 'student') return;
  await handleOffer(data);
});

// الأستاذ يستقبل answer من التلميذ
socket.on('webrtc_answer', async data => {
  if (ROLE !== 'teacher') return;
  const pc = peerConns[data.from];
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch(e) { console.error(e); }
  }
});

// ICE candidates
socket.on('webrtc_ice', async data => {
  const pc = peerConns[data.from];
  if (pc && data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch(e) { console.error(e); }
  }
});

// الأستاذ يعرف بدخول تلميذ جديد → يرسله offer إذا المايك شاغل
socket.on('student_joined', async data => {
  if (ROLE === 'teacher' && micOn) {
    await createOfferForStudent(data.id);
  }
});

// تحديث قائمة التلاميذ
socket.on('students_list', students => updateStudentsList(students));

// شات
socket.on('chat', msg => addChatMessage(msg));

// تفاعلات
socket.on('student_react', d => {
  showFloatingReaction(d.emoji, Math.random() * window.innerWidth * 0.8, window.innerHeight - 100);
  if (ROLE === 'teacher') showToast(`${d.name} أرسل: ${d.emoji}`);
});

// ===================================================
//  Init
// ===================================================
setupRole();
resizeCanvas();
