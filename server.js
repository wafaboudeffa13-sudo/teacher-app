const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 50e6 });

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// كل غرفة عندها حالتها الخاصة
const rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      boardState: { strokes: [], texts: [], images: [], files: [] },
      chatMessages: [],
      students: {},
      chatLocked: false,
      pendingStudents: {}
    };
    // مسح الشات كل 5 دقايق
    setInterval(() => {
      if (rooms[roomId]) {
        rooms[roomId].chatMessages = [];
        io.to(roomId).emit('chat_clear');
      }
    }, 5 * 60 * 1000);
  }
  return rooms[roomId];
}

function getStudentsList(room) {
  return Object.entries(room.students).map(([id, s]) => ({ id, ...s }));
}

io.on('connection', (socket) => {
  const role   = socket.handshake.query.role;
  const name   = socket.handshake.query.name || '👨‍🎓 تلميذ';
  const roomId = socket.handshake.query.room || 'default';

  socket.role     = role;
  socket.userName = name;
  socket.roomId   = roomId;

  socket.join(roomId);
  const room = getRoom(roomId);

  if (role === 'student') {
    room.pendingStudents[socket.id] = { name, socket };
    io.to(roomId).emit('student_pending', { id: socket.id, name });
    socket.emit('waiting_approval');
  } else {
    socket.emit('init', {
      boardState: room.boardState,
      chatMessages: room.chatMessages,
      students: getStudentsList(room),
      chatLocked: room.chatLocked,
      roomId
    });
  }

  socket.on('approve_student', d => {
    if (socket.role !== 'teacher') return;
    const pending = room.pendingStudents[d.id];
    if (!pending) return;
    delete room.pendingStudents[d.id];
    if (d.approved) {
      room.students[d.id] = { name: pending.name, muted: room.chatLocked };
      pending.socket.emit('approved');
      pending.socket.emit('init', {
        boardState: room.boardState,
        chatMessages: room.chatMessages,
        students: getStudentsList(room),
        chatLocked: room.chatLocked,
        roomId
      });
      io.to(roomId).emit('students_list', getStudentsList(room));
    } else {
      pending.socket.emit('rejected');
      pending.socket.disconnect();
    }
  });

  socket.on('draw_start', d => { if (socket.role === 'teacher') socket.to(roomId).emit('draw_start', d); });
  socket.on('draw_move',  d => {
    if (socket.role === 'teacher') {
      room.boardState.strokes.push(d);
      socket.to(roomId).emit('draw_move', d);
    }
  });
  socket.on('draw_end', () => { if (socket.role === 'teacher') socket.to(roomId).emit('draw_end'); });

  socket.on('text', d => {
    if (socket.role === 'teacher') {
      room.boardState.texts.push(d);
      socket.to(roomId).emit('text', d);
    }
  });

  socket.on('file', d => {
    if (socket.role !== 'teacher') return;
    if (d.type === 'image') room.boardState.images.push(d);
    else room.boardState.files.push(d);
    socket.to(roomId).emit('file', d);
  });

  socket.on('remove_file', d => {
    if (socket.role !== 'teacher') return;
    room.boardState.files  = room.boardState.files.filter(f => f.name !== d.name);
    room.boardState.images = room.boardState.images.filter(f => f.name !== d.name);
    io.to(roomId).emit('remove_file', d);
  });

  socket.on('clear', () => {
    if (socket.role !== 'teacher') return;
    room.boardState = { strokes: [], texts: [], images: [], files: [] };
    socket.to(roomId).emit('clear');
  });

  socket.on('mic_status',  d => { if (socket.role === 'teacher') socket.to(roomId).emit('mic_status', d); });
  socket.on('audio_chunk', d => { if (socket.role === 'teacher') socket.to(roomId).emit('audio_chunk', d); });

  socket.on('chat', d => {
    if (socket.role === 'student') {
      const s = room.students[socket.id];
      if (!s || s.muted || room.chatLocked) return;
    }
    const msg = {
      name: socket.userName,
      role: socket.role,
      text: d.text,
      time: new Date().toLocaleTimeString('ar'),
      id: Date.now()
    };
    room.chatMessages.push(msg);
    if (room.chatMessages.length > 100) room.chatMessages.shift();
    io.to(roomId).emit('chat', msg);
  });

  socket.on('delete_msg', d => {
    if (socket.role !== 'teacher') return;
    room.chatMessages = room.chatMessages.filter(m => m.id !== d.id);
    io.to(roomId).emit('delete_msg', d);
  });

  socket.on('chat_lock', d => {
    if (socket.role !== 'teacher') return;
    room.chatLocked = d.locked;
    io.to(roomId).emit('chat_lock', d);
  });

  socket.on('kick_student', d => {
    if (socket.role !== 'teacher') return;
    const target = io.sockets.sockets.get(d.id);
    if (target) { target.emit('kicked'); target.disconnect(); }
  });

  socket.on('mute_student', d => {
    if (socket.role !== 'teacher') return;
    if (room.students[d.id]) {
      room.students[d.id].muted = d.muted;
      io.to(roomId).emit('students_list', getStudentsList(room));
      io.to(d.id).emit('you_muted', { muted: d.muted });
    }
  });

  socket.on('student_react', d => {
    if (socket.role !== 'student') return;
    const s = room.students[socket.id];
    if (!s || s.muted) return;
    io.to(roomId).emit('student_react', { ...d, name: socket.userName });
  });

  socket.on('disconnect', () => {
    delete room.pendingStudents[socket.id];
    if (role === 'student') {
      delete room.students[socket.id];
      io.to(roomId).emit('students_list', getStudentsList(room));
    }
    // إذا الغرفة فارغة نمسحها
    if (Object.keys(room.students).length === 0 && Object.keys(room.pendingStudents).length === 0) {
      delete rooms[roomId];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 شاغل على PORT ${PORT}`));
