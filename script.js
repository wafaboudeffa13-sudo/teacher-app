// ===== الدور من URL =====
const params = new URLSearchParams(window.location.search);
const ROLE = params.get('role') === 'teacher' ? 'teacher' : 'student';

// ===== Socket =====
const socket = io({ query: { role: ROLE } });

// ===== عناصر =====
const canvas    = document.getElementById('whiteboard');
const ctx       = canvas.getContext('2d');
const textInput = document.getElementById('textInput');
const fileInput = document.getElementById('fileInput');
const toast     = document.getElementById('toast');
const micBtn    = document.getElementById('micBtn');
const micIndicator = document.getElementById('micIndicator');

// ===== حالة =====
let tool     = 'pen';
let drawing  = false;
let lastX = 0, lastY = 0;
let penColor = '#000000';
let penSize  = 3;
let micOn    = false;
let mediaStream = null;
let textPos  = { x: 0, y: 0 };

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
//  حجم الكانفاس يملأ الشاشة
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
  ctx.lineCap    = 'round';
  ctx.lineJoin   = 'round';
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
  const src = e.touches ? e.touches[0] : e;
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
    ctx.lineWidth = d.size * 5;
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.size;
  }
  ctx.lineCap = 'round';
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
  ctx.font = `${Math.max(16, d.size * 5)}px 'Segoe UI', Tahoma, sans-serif`;
  ctx.fillStyle = d.color || '#000';
  ctx.fillText(d.text, d.x, d.y);
}

// ===================================================
//  صور
// ===================================================
fileInput?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const d = { data: ev.target.result, x: 60, y: 60, w: 380, h: 260 };
    drawImg(d);
    socket.emit('image', d);
    showToast('✅ تم رفع الصورة');
  };
  reader.readAsDataURL(file);
  fileInput.value = '';
});

function drawImg(d) {
  const img = new Image();
  img.onload = () => ctx.drawImage(img, d.x, d.y, d.w, d.h);
  img.src = d.data;
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
//  مايك
// ===================================================
async function toggleMic() {
  if (ROLE !== 'teacher') return;
  if (!micOn) {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micOn = true;
      micBtn.textContent = '🔴 إيقاف المايك';
      micBtn.classList.add('on');
      socket.emit('mic_status', { on: true });
      showToast('🎙️ المايك شاغل');
    } catch { showToast('❌ ما قدرش يفتح المايك'); }
  } else {
    mediaStream?.getTracks().forEach(t => t.stop());
    micOn = false;
    micBtn.textContent = '🎙️ مايك';
    micBtn.classList.remove('on');
    socket.emit('mic_status', { on: false });
    showToast('🔇 المايك موقوف');
  }
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
  el.className = 'reaction-popup';
  el.textContent = emoji;
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
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

socket.on('init', state => {
  state.strokes?.forEach(s => drawSeg(s));
  state.texts?.forEach(t => drawText(t));
  state.images?.forEach(i => drawImg(i));
});

socket.on('draw_start', d => { ctx.beginPath(); ctx.moveTo(d.x, d.y); });
socket.on('draw_move',  d => drawSeg(d));
socket.on('draw_end',   () => {});
socket.on('text',       d => drawText(d));
socket.on('image',      d => { drawImg(d); showToast('📷 الأستاذ رفع صورة'); });
socket.on('clear',      () => { ctx.clearRect(0, 0, canvas.width, canvas.height); showToast('🗑️ السبورة تمسحت'); });
socket.on('mic_status', d => {
  micIndicator.style.display = d.on ? 'block' : 'none';
  if (d.on) showToast('🎙️ الأستاذ يتكلم');
});
socket.on('student_react', d => {
  showFloatingReaction(d.emoji, Math.random() * window.innerWidth * 0.8, window.innerHeight - 100);
  if (ROLE === 'teacher') showToast(`تلميذ أرسل: ${d.emoji}`);
});

// ===================================================
//  Init
// ===================================================
setupRole();
resizeCanvas();