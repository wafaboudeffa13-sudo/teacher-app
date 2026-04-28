const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 10e6 });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// حالة السبورة — يحفظ كل شي باش التلميذ الجديد يشوف
let boardState = { strokes: [], texts: [], images: [] };

io.on('connection', (socket) => {
  const role = socket.handshake.query.role;
  socket.role = role;
  console.log(`✅ ${role} دخل: ${socket.id}`);

  socket.emit('init', boardState); // يبعت الحالة الحالية

  socket.on('draw_move', (data) => {
    if (socket.role !== 'teacher') return;
    boardState.strokes.push(data);
    socket.broadcast.emit('draw_move', data);
  });

  socket.on('draw_start', (data) => { if (socket.role === 'teacher') socket.broadcast.emit('draw_start', data); });
  socket.on('draw_end',   ()     => { if (socket.role === 'teacher') socket.broadcast.emit('draw_end'); });

  socket.on('text', (data) => {
    if (socket.role !== 'teacher') return;
    boardState.texts.push(data);
    socket.broadcast.emit('text', data);
  });

  socket.on('image', (data) => {
    if (socket.role !== 'teacher') return;
    boardState.images.push(data);
    socket.broadcast.emit('image', data);
  });

  socket.on('clear', () => {
    if (socket.role !== 'teacher') return;
    boardState = { strokes: [], texts: [], images: [] };
    socket.broadcast.emit('clear');
  });

  socket.on('mic_status',    (d) => { if (socket.role === 'teacher') socket.broadcast.emit('mic_status', d); });
  socket.on('student_react', (d) => { if (socket.role === 'student') io.emit('student_react', { ...d, id: socket.id }); });
  socket.on('disconnect', () => console.log(`❌ غادر: ${socket.id}`));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 السيرفر شاغل!`);
  console.log(`👨‍🏫 الأستاذ : http://localhost:${PORT}?role=teacher`);
  console.log(`👨‍🎓 التلميذ : http://localhost:${PORT}?role=student`);
});