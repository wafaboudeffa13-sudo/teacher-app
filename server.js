const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 50e6 });

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let boardState = { strokes: [], texts: [], images: [], files: [] };
let chatMessages = [];
let students = {};
let chatLocked = false;
let pendingStudents = {};

setInterval(() => {
  chatMessages = [];
  io.emit('chat_clear');
}, 5 * 60 * 1000);

io.on('connection', (socket) => {
  const role = socket.handshake.query.role;
  const name = socket.handshake.query.name || '👨‍🎓 تلميذ';
  socket.role = role;
  socket.userName = name;

  if (role === 'student') {
    pendingStudents[socket.id] = { name, socket };
    io.emit('student_pending', { id: socket.id, name });
    socket.emit('waiting_approval');
  } else {
    socket.emit('init', { boardState, chatMessages, students: getStudentsList(), chatLocked });
  }

  socket.on('approve_student', d => {
    if (socket.role !== 'teacher') return;
    const pending = pendingStudents[d.id];
    if (!pending) return;
    delete pendingStudents[d.id];
    if (d.approved) {
      students[d.id] = { name: pending.name, muted: chatLocked };
      pending.socket.emit('approved');
      pending.socket.emit('init', { boardState, chatMessages, students: getStudentsList(), chatLocked });
      io.emit('students_list', getStudentsList());
    } else {
      pending.socket.emit('rejected');
      pending.socket.disconnect();
    }
  });

  socket.on('draw_start', d => { if (socket.role === 'teacher') socket.broadcast.emit('draw_start', d); });
  socket.on('draw_move',  d => { if (socket.role === 'teacher') { boardState.strokes.push(d); socket.broadcast.emit('draw_move', d); } });
  socket.on('draw_end',   () => { if (socket.role === 'teacher') socket.broadcast.emit('draw_end'); });
  socket.on('text', d => { if (socket.role === 'teacher') { boardState.texts.push(d); socket.broadcast.emit('text', d); } });

  socket.on('file', d => {
    if (socket.role !== 'teacher') return;
    if (d.type === 'image') boardState.images.push(d);
    else boardState.files.push(d);
    socket.broadcast.emit('file', d);
  });

  socket.on('remove_file', d => {
    if (socket.role !== 'teacher') return;
    boardState.files  = boardState.files.filter(f => f.name !== d.name);
    boardState.images = boardState.images.filter(f => f.name !== d.name);
    io.emit('remove_file', d);
  });

  socket.on('clear', () => {
    if (socket.role !== 'teacher') return;
    boardState = { strokes: [], texts: [], images: [], files: [] };
    socket.broadcast.emit('clear');
  });

  socket.on('mic_status',  d => { if (socket.role === 'teacher') socket.broadcast.emit('mic_status', d); });
  socket.on('audio_chunk', d => { if (socket.role === 'teacher') socket.broadcast.emit('audio_chunk', d); });

  socket.on('chat', d => {
    if (socket.role === 'student') {
      const s = students[socket.id];
      if (!s || s.muted || chatLocked) return;
    }
    const msg = { name: socket.userName, role: socket.role, text: d.text, time: new Date().toLocaleTimeString('ar'), id: Date.now() };
    chatMessages.push(msg);
    if (chatMessages.length > 100) chatMessages.shift();
    io.emit('chat', msg);
  });

  socket.on('delete_msg', d => {
    if (socket.role !== 'teacher') return;
    chatMessages = chatMessages.filter(m => m.id !== d.id);
    io.emit('delete_msg', d);
  });

  socket.on('chat_lock', d => {
    if (socket.role !== 'teacher') return;
    chatLocked = d.locked;
    io.emit('chat_lock', d);
  });

  socket.on('kick_student', d => {
    if (socket.role !== 'teacher') return;
    const target = io.sockets.sockets.get(d.id);
    if (target) { target.emit('kicked'); target.disconnect(); }
  });

  socket.on('mute_student', d => {
    if (socket.role !== 'teacher') return;
    if (students[d.id]) {
      students[d.id].muted = d.muted;
      io.emit('students_list', getStudentsList());
      io.to(d.id).emit('you_muted', { muted: d.muted });
    }
  });

  socket.on('student_react', d => {
    if (socket.role !== 'student') return;
    const s = students[socket.id];
    if (!s || s.muted) return;
    io.emit('student_react', { ...d, name: socket.userName });
  });

  socket.on('disconnect', () => {
    delete pendingStudents[socket.id];
    if (role === 'student') {
      delete students[socket.id];
      io.emit('students_list', getStudentsList());
    }
  });
});

function getStudentsList() {
  return Object.entries(students).map(([id, s]) => ({ id, ...s }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 شاغل على PORT ${PORT}`));
