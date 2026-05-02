const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 50e6 });

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      boardState: { strokes: [], texts: [], images: [], files: [] },
      chatMessages: [],
      students: {},
      pendingStudents: {},
      chatLocked: false,
      raisedHands: {},
      micGrants: new Set(),
      activeMics: new Set()
    };
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
  return Object.entries(room.students).map(([id, s]) => ({
    id, name: s.name, muted: !!s.muted,
    handRaised: !!room.raisedHands[id],
    micGranted: room.micGrants.has(id),
    micActive: room.activeMics.has(id)
  }));
}
function getRaisedHandsList(room) {
  return Object.entries(room.raisedHands).map(([id, name]) => ({ id, name }));
}
function getPendingList(room) {
  return Object.entries(room.pendingStudents).map(([id, p]) => ({ id, name: p.name }));
}

io.on('connection', (socket) => {
  const role   = socket.handshake.query.role;
  const name   = socket.handshake.query.name || '👨‍🎓 تلميذ';
  const roomId = socket.handshake.query.room || 'default';
  socket.role = role; socket.userName = name; socket.roomId = roomId;
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
      raisedHands: getRaisedHandsList(room),
      pendingStudents: getPendingList(room),
      chatLocked: room.chatLocked,
      roomId
    });
  }

  socket.on('approve_student', d => {
    if (socket.role !== 'teacher') return;
    const p = room.pendingStudents[d.id];
    console.log('approve_student', d.id, 'found:', !!p);
    if (!p) { socket.emit('approve_failed', { id: d.id }); return; }
    delete room.pendingStudents[d.id];
    if (d.approved) {
      room.students[d.id] = { name: p.name, muted: false };
      p.socket.emit('approved');
      p.socket.emit('init', {
        boardState: room.boardState,
        chatMessages: room.chatMessages,
        students: getStudentsList(room),
        raisedHands: getRaisedHandsList(room),
        chatLocked: room.chatLocked,
        roomId
      });
      io.to(roomId).emit('students_list', getStudentsList(room));
    } else {
      p.socket.emit('rejected');
      p.socket.disconnect();
    }
  });

  socket.on('draw_start', d => { if (socket.role === 'teacher') socket.to(roomId).emit('draw_start', d); });
  socket.on('draw_move', d => {
    if (socket.role === 'teacher') {
      room.boardState.strokes.push(d);
      socket.to(roomId).emit('draw_move', d);
    }
  });
  socket.on('draw_end', () => { if (socket.role === 'teacher') socket.to(roomId).emit('draw_end'); });
  socket.on('text', d => {
    if (socket.role === 'teacher') { room.boardState.texts.push(d); socket.to(roomId).emit('text', d); }
  });
  socket.on('file', d => {
    if (socket.role !== 'teacher') return;
    if (d.type === 'image') room.boardState.images.push(d); else room.boardState.files.push(d);
    socket.to(roomId).emit('file', d);
  });
  socket.on('remove_file', d => {
    if (socket.role !== 'teacher') return;
    room.boardState.files = room.boardState.files.filter(f => f.name !== d.name);
    room.boardState.images = room.boardState.images.filter(f => f.name !== d.name);
    io.to(roomId).emit('remove_file', d);
  });
  socket.on('clear', () => {
    if (socket.role !== 'teacher') return;
    room.boardState = { strokes: [], texts: [], images: [], files: [] };
    socket.to(roomId).emit('clear');
  });

  // ===== الصوت — مايك الأستاذ =====
  socket.on('mic_status', d => { if (socket.role === 'teacher') socket.to(roomId).emit('mic_status', d); });
  socket.on('audio_chunk', d => { if (socket.role === 'teacher') socket.to(roomId).emit('audio_chunk', d); });

  // ===== كاميرا + مشاركة الشاشة =====
  socket.on('media_status', d => { if (socket.role === 'teacher') socket.to(roomId).emit('media_status', d); });
  socket.on('media_frame', d => { if (socket.role === 'teacher') socket.to(roomId).emit('media_frame', d); });

  // ===== مايك التلميذ (بعد إذن) =====
  socket.on('student_mic_status', d => {
    if (socket.role !== 'student' || !room.micGrants.has(socket.id)) return;
    if (d.on) room.activeMics.add(socket.id); else room.activeMics.delete(socket.id);
    io.to(roomId).emit('student_mic_status', { id: socket.id, on: !!d.on, name: socket.userName });
    io.to(roomId).emit('students_list', getStudentsList(room));
  });
  socket.on('student_audio_chunk', d => {
    if (socket.role !== 'student' || !room.micGrants.has(socket.id)) return;
    socket.to(roomId).emit('student_audio_chunk', { ...d, id: socket.id, name: socket.userName });
  });

  // ===== الشات =====
  socket.on('chat', d => {
    if (!d || typeof d.text !== 'string') return;
    if (socket.role === 'student') {
      const s = room.students[socket.id]; if (!s) return;
      if (s.muted) { socket.emit('chat_blocked', { reason: 'muted' }); return; }
      if (room.chatLocked) { socket.emit('chat_blocked', { reason: 'locked' }); return; }
    }
    const text = d.text.trim().slice(0, 500); if (!text) return;
    const msg = { name: socket.userName, role: socket.role, text,
      time: new Date().toLocaleTimeString('ar'),
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 7) };
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
    room.chatLocked = !!d.locked;
    io.to(roomId).emit('chat_lock', { locked: room.chatLocked });
  });
  socket.on('mute_student', d => {
    if (socket.role !== 'teacher') return;
    if (room.students[d.id]) {
      room.students[d.id].muted = !!d.muted;
      io.to(roomId).emit('students_list', getStudentsList(room));
      io.to(d.id).emit('you_muted', { muted: !!d.muted });
    }
  });
  socket.on('kick_student', d => {
    if (socket.role !== 'teacher') return;
    const t = io.sockets.sockets.get(d.id);
    if (t) { t.emit('kicked'); t.disconnect(); }
  });
  socket.on('student_react', d => {
    if (socket.role !== 'student') return;
    io.to(roomId).emit('student_react', { ...d, name: socket.userName });
  });

  // ===== رفع اليد =====
  socket.on('raise_hand', d => {
    if (socket.role !== 'student') return;
    if (d.raised) room.raisedHands[socket.id] = socket.userName;
    else delete room.raisedHands[socket.id];
    io.to(roomId).emit('raised_hands', getRaisedHandsList(room));
    io.to(roomId).emit('students_list', getStudentsList(room));
  });
  socket.on('grant_mic', d => {
    if (socket.role !== 'teacher') return;
    room.micGrants.add(d.id);
    delete room.raisedHands[d.id];
    const t = io.sockets.sockets.get(d.id); if (t) t.emit('mic_granted');
    io.to(roomId).emit('raised_hands', getRaisedHandsList(room));
    io.to(roomId).emit('students_list', getStudentsList(room));
  });
  socket.on('revoke_mic', d => {
    if (socket.role !== 'teacher') return;
    room.micGrants.delete(d.id);
    const wasActive = room.activeMics.has(d.id);
    room.activeMics.delete(d.id);
    delete room.raisedHands[d.id];
    const t = io.sockets.sockets.get(d.id); if (t) t.emit('mic_revoked');
    if (wasActive) io.to(roomId).emit('student_mic_status', { id: d.id, on: false, name: room.students[d.id]?.name || '' });
    io.to(roomId).emit('raised_hands', getRaisedHandsList(room));
    io.to(roomId).emit('students_list', getStudentsList(room));
  });

  socket.on('disconnect', () => {
    if (room.pendingStudents[socket.id]) {
      delete room.pendingStudents[socket.id];
      io.to(roomId).emit('pending_removed', { id: socket.id });
    }
    if (role === 'student') {
      const wasActive = room.activeMics.has(socket.id);
      delete room.students[socket.id];
      delete room.raisedHands[socket.id];
      room.micGrants.delete(socket.id);
      room.activeMics.delete(socket.id);
      if (wasActive) io.to(roomId).emit('student_mic_status', { id: socket.id, on: false, name });
      io.to(roomId).emit('students_list', getStudentsList(room));
      io.to(roomId).emit('raised_hands', getRaisedHandsList(room));
    }
    if (Object.keys(room.students).length === 0 && Object.keys(room.pendingStudents).length === 0) {
      delete rooms[roomId];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 شاغل على PORT ${PORT}`));
