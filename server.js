const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 50e6 });

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let boardState = { strokes: [], texts: [], images: [] };
let chatMessages = [];
let students = {}; // { socketId: name }

io.on('connection', (socket) => {
  const role = socket.handshake.query.role;
  const name = socket.handshake.query.name || (role === 'teacher' ? '👨‍🏫 الأستاذ' : '👨‍🎓 تلميذ');
  socket.role = role;
  socket.userName = name;

  console.log(`✅ ${role} دخل: ${name}`);

  // إضافة للقائمة إذا تلميذ
  if (role === 'student') {
    students[socket.id] = name;
    io.emit('students_list', Object.values(students));
  }

  // إرسال الحالة للداخل الجديد
  socket.emit('init', { boardState, chatMessages, students: Object.values(students) });

  // ===== رسم =====
  socket.on('draw_start', (data) => { if (socket.role === 'teacher') socket.broadcast.emit('draw_start', data); });
  socket.on('draw_move',  (data) => { if (socket.role === 'teacher') { boardState.strokes.push(data); socket.broadcast.emit('draw_move', data); } });
  socket.on('draw_end',   ()     => { if (socket.role === 'teacher') socket.broadcast.emit('draw_end'); });

  // ===== نص =====
  socket.on('text', (data) => { if (socket.role === 'teacher') { boardState.texts.push(data); socket.broadcast.emit('text', data); } });

  // ===== ملفات (صور + PDF + غيرها) =====
  socket.on('file', (data) => {
    if (socket.role !== 'teacher') return;
    if (data.type === 'image') boardState.images.push(data);
    socket.broadcast.emit('file', data);
  });

  // ===== مسح =====
  socket.on('clear', () => {
    if (socket.role !== 'teacher') return;
    boardState = { strokes: [], texts: [], images: [] };
    socket.broadcast.emit('clear');
  });

  // ===== WebRTC صوت =====
  socket.on('webrtc_offer',     (data) => socket.broadcast.emit('webrtc_offer',     data));
  socket.on('webrtc_answer',    (data) => socket.broadcast.emit('webrtc_answer',    data));
  socket.on('webrtc_ice',       (data) => socket.broadcast.emit('webrtc_ice',       data));
  socket.on('mic_status',       (data) => { if (socket.role === 'teacher') socket.broadcast.emit('mic_status', data); });

  // ===== شات =====
  socket.on('chat', (data) => {
    const msg = { name: socket.userName, role: socket.role, text: data.text, time: new Date().toLocaleTimeString('ar') };
    chatMessages.push(msg);
    if (chatMessages.length > 100) chatMessages.shift();
    io.emit('chat', msg);
  });

  // ===== تفاعلات =====
  socket.on('student_react', (data) => { if (socket.role === 'student') io.emit('student_react', { ...data, name: socket.userName }); });

  // ===== قطع الاتصال =====
  socket.on('disconnect', () => {
    console.log(`❌ غادر: ${socket.userName}`);
    if (role === 'student') {
      delete students[socket.id];
      io.emit('students_list', Object.values(students));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 السيرفر شاغل على PORT ${PORT}`));
