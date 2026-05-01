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
      students: {},                // { id: { name, muted } }
      pendingStudents: {},
      chatLocked: false,
      raisedHands: {},             // { socketId: name }
      micGrants: new Set(),        // socket IDs مع إذن مايك
      activeMics: new Set(),       // socket IDs اللي المايك مفتوح
      broadcasters: new Set(),     // socket IDs اللي يبثو الصوت (WebRTC)
      teacherMicOn: false
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
    id,
    name: s.name,
    muted: !!s.muted,
    handRaised: !!room.raisedHands[id],
    micGranted: room.micGrants.has(id),
    micActive: room.activeMics.has(id)
  }));
}

function getRaisedHandsList(room) {
  return Object.entries(room.raisedHands).map(([id, name]) => ({ id, name }));
}

// نجمع الـ listeners (الناس اللي راهم في الغرفة ماعدا الـ broadcaster والـ pending)
function getListenerIds(roomId, excludeId, room) {
  const ids = [];
  const roomSockets = io.sockets.adapter.rooms.get(roomId);
  if (!roomSockets) return ids;
  roomSockets.forEach(sid => {
    if (sid === excludeId) return;
    if (room.pendingStudents[sid]) return; // pending ما يسمعش
    ids.push(sid);
  });
  return ids;
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
      raisedHands: getRaisedHandsList(room),
      chatLocked: room.chatLocked,
      teacherMicOn: room.teacherMicOn,
      activeBroadcasters: Array.from(room.broadcasters),
      roomId
    });
  }

  // ===== موافقة التلميذ =====
  socket.on('approve_student', d => {
    if (socket.role !== 'teacher') return;
    const pending = room.pendingStudents[d.id];
    if (!pending) return;
    delete room.pendingStudents[d.id];
    if (d.approved) {
      room.students[d.id] = { name: pending.name, muted: false };
      pending.socket.emit('approved');
      pending.socket.emit('init', {
        boardState: room.boardState,
        chatMessages: room.chatMessages,
        students: getStudentsList(room),
        raisedHands: getRaisedHandsList(room),
        chatLocked: room.chatLocked,
        teacherMicOn: room.teacherMicOn,
        activeBroadcasters: Array.from(room.broadcasters),
        roomId
      });
      io.to(roomId).emit('students_list', getStudentsList(room));
      // نخبّر الـ broadcasters باش يربطو peer جديد للتلميذ الجديد
      room.broadcasters.forEach(bid => {
        io.to(bid).emit('new_listener', { id: pending.socket.id });
      });
    } else {
      pending.socket.emit('rejected');
      pending.socket.disconnect();
    }
  });

  // ===== الرسم =====
  socket.on('draw_start', d => { if (socket.role === 'teacher') socket.to(roomId).emit('draw_start', d); });
  socket.on('draw_move', d => {
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

  // ===== الملفات =====
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

  // ===== مايك الأستاذ — UI فقط، الصوت عبر WebRTC =====
  socket.on('mic_status', d => {
    if (socket.role !== 'teacher') return;
    room.teacherMicOn = !!d.on;
    socket.to(roomId).emit('mic_status', d);
  });

  // ===== WebRTC: بدء البث =====
  socket.on('start_broadcast', () => {
    const allowed = (socket.role === 'teacher') || (socket.role === 'student' && room.micGrants.has(socket.id));
    if (!allowed) return;
    room.broadcasters.add(socket.id);
    const listeners = getListenerIds(roomId, socket.id, room);
    socket.emit('broadcast_listeners', listeners);
    socket.to(roomId).emit('broadcaster_started', {
      id: socket.id,
      name: socket.userName,
      role: socket.role
    });
  });

  socket.on('stop_broadcast', () => {
    if (room.broadcasters.delete(socket.id)) {
      socket.to(roomId).emit('broadcaster_stopped', { id: socket.id, name: socket.userName });
    }
  });

  // ===== WebRTC: تمرير الإشارات بين الـ peers =====
  socket.on('webrtc_signal', d => {
    if (!d || !d.to || !d.signal) return;
    const target = io.sockets.sockets.get(d.to);
    if (!target) return;
    if (target.roomId !== socket.roomId) return; // أمان: نفس الغرفة فقط
    target.emit('webrtc_signal', { from: socket.id, signal: d.signal });
  });

  // ===== الشات (مع تحكم الأستاذ) =====
  socket.on('chat', d => {
    if (!d || typeof d.text !== 'string') return;
    if (socket.role === 'student') {
      const s = room.students[socket.id];
      if (!s) return;
      if (s.muted) { socket.emit('chat_blocked', { reason: 'muted' }); return; }
      if (room.chatLocked) { socket.emit('chat_blocked', { reason: 'locked' }); return; }
    }
    const text = d.text.trim().slice(0, 500);
    if (!text) return;
    const msg = {
      name: socket.userName,
      role: socket.role,
      text,
      time: new Date().toLocaleTimeString('ar'),
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 7)
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

  // ===== طرد التلميذ =====
  socket.on('kick_student', d => {
    if (socket.role !== 'teacher') return;
    const target = io.sockets.sockets.get(d.id);
    if (target) { target.emit('kicked'); target.disconnect(); }
  });

  // ===== Reactions =====
  socket.on('student_react', d => {
    if (socket.role !== 'student') return;
    io.to(roomId).emit('student_react', { ...d, name: socket.userName });
  });

  // ===== رفع اليد =====
  socket.on('raise_hand', d => {
    if (socket.role !== 'student') return;
    if (d.raised) {
      room.raisedHands[socket.id] = socket.userName;
    } else {
      delete room.raisedHands[socket.id];
    }
    io.to(roomId).emit('raised_hands', getRaisedHandsList(room));
    io.to(roomId).emit('students_list', getStudentsList(room));
  });

  // ===== الأستاذ يسمح/يلغي إذن المايك =====
  socket.on('grant_mic', d => {
    if (socket.role !== 'teacher') return;
    room.micGrants.add(d.id);
    delete room.raisedHands[d.id];
    const target = io.sockets.sockets.get(d.id);
    if (target) target.emit('mic_granted');
    io.to(roomId).emit('raised_hands', getRaisedHandsList(room));
    io.to(roomId).emit('students_list', getStudentsList(room));
  });

  socket.on('revoke_mic', d => {
    if (socket.role !== 'teacher') return;
    room.micGrants.delete(d.id);
    const wasActive = room.activeMics.has(d.id);
    room.activeMics.delete(d.id);
    delete room.raisedHands[d.id];
    if (room.broadcasters.has(d.id)) {
      room.broadcasters.delete(d.id);
      io.to(roomId).emit('broadcaster_stopped', { id: d.id, name: room.students[d.id]?.name || '' });
    }
    const target = io.sockets.sockets.get(d.id);
    if (target) target.emit('mic_revoked');
    if (wasActive) {
      const studentName = room.students[d.id]?.name || 'تلميذ';
      io.to(roomId).emit('student_mic_status', { id: d.id, on: false, name: studentName });
    }
    io.to(roomId).emit('raised_hands', getRaisedHandsList(room));
    io.to(roomId).emit('students_list', getStudentsList(room));
  });

  // ===== مؤشّر مايك التلميذ (UI فقط) =====
  socket.on('student_mic_status', d => {
    if (socket.role !== 'student') return;
    if (!room.micGrants.has(socket.id)) return;
    if (d.on) room.activeMics.add(socket.id);
    else      room.activeMics.delete(socket.id);
    io.to(roomId).emit('student_mic_status', { id: socket.id, on: !!d.on, name: socket.userName });
    io.to(roomId).emit('students_list', getStudentsList(room));
  });

  // ===== انفصال =====
  socket.on('disconnect', () => {
    delete room.pendingStudents[socket.id];
    const wasBroadcaster = room.broadcasters.delete(socket.id);
    if (wasBroadcaster) {
      socket.to(roomId).emit('broadcaster_stopped', { id: socket.id, name: socket.userName });
    }
    if (role === 'student') {
      const wasActive = room.activeMics.has(socket.id);
      delete room.students[socket.id];
      delete room.raisedHands[socket.id];
      room.micGrants.delete(socket.id);
      room.activeMics.delete(socket.id);
      if (wasActive) {
        io.to(roomId).emit('student_mic_status', { id: socket.id, on: false, name });
      }
      io.to(roomId).emit('students_list', getStudentsList(room));
      io.to(roomId).emit('raised_hands', getRaisedHandsList(room));
    }
    if (role === 'teacher') {
      room.teacherMicOn = false;
    }
    // نخبّر الـ broadcasters باش يحيدو الـ peer ديال هاد الواحد
    room.broadcasters.forEach(bid => {
      io.to(bid).emit('listener_left', { id: socket.id });
    });
    // إذا الغرفة فارغة نمسحها
    if (Object.keys(room.students).length === 0 && Object.keys(room.pendingStudents).length === 0) {
      delete rooms[roomId];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 شاغل على PORT ${PORT}`));
