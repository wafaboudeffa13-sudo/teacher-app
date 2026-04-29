const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 50e6   // 50MB للملفات الكبيرة
});

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ===== الحالة =====
let boardState    = { strokes: [], texts: [], images: [] };
let chatMessages  = [];
let students      = {};  // { socketId: { name, id } }
let teacherSocketId = null;

// ===================================================
io.on('connection', (socket) => {
  const role = socket.handshake.query.role || 'student';
  const name = socket.handshake.query.name  || (role === 'teacher' ? '👨‍🏫 الأستاذ' : '👨‍🎓 تلميذ');

  socket.role     = role;
  socket.userName = name;
  console.log(`✅ ${role} دخل: ${name} [${socket.id}]`);

  // ===== سجّل الأستاذ =====
  if (role === 'teacher') {
    teacherSocketId = socket.id;
  }

  // ===== سجّل التلميذ =====
  if (role === 'student') {
    students[socket.id] = { name, id: socket.id };
    io.emit('students_list', Object.values(students).map(s => s.name));

    // أخبر الأستاذ بالتلميذ الجديد (لإرسال WebRTC offer)
    if (teacherSocketId) {
      io.to(teacherSocketId).emit('student_joined', { id: socket.id, name });
    }
  }

  // ===== إرسال الحالة للداخل الجديد =====
  socket.emit('init', {
    boardState,
    chatMessages,
    students: Object.values(students).map(s => s.name)
  });

  // ===================================================
  //  رسم
  // ===================================================
  socket.on('draw_start', data => {
    if (socket.role !== 'teacher') return;
    socket.broadcast.emit('draw_start', data);
  });

  socket.on('draw_move', data => {
    if (socket.role !== 'teacher') return;
    boardState.strokes.push(data);
    socket.broadcast.emit('draw_move', data);
  });

  socket.on('draw_end', () => {
    if (socket.role !== 'teacher') return;
    socket.broadcast.emit('draw_end');
  });

  // ===================================================
  //  نص
  // ===================================================
  socket.on('text', data => {
    if (socket.role !== 'teacher') return;
    boardState.texts.push(data);
    socket.broadcast.emit('text', data);
  });

  // ===================================================
  //  ملفات (صور + PDF + Word + Excel + غيرها)
  // ===================================================
  socket.on('file', data => {
    if (socket.role !== 'teacher') return;
    if (data.type === 'image') {
      boardState.images.push(data);
    }
    // نرسل لكل التلاميذ
    socket.broadcast.emit('file', data);
  });

  // ===================================================
  //  مسح
  // ===================================================
  socket.on('clear', () => {
    if (socket.role !== 'teacher') return;
    boardState = { strokes: [], texts: [], images: [] };
    socket.broadcast.emit('clear');
  });

  // ===================================================
  //  WebRTC — routing الصوت بين الأستاذ والتلاميذ
  // ===================================================

  // الأستاذ يرسل offer لتلميذ معين
  socket.on('webrtc_offer', data => {
    if (socket.role !== 'teacher') return;
    // data.to = socketId التلميذ
    io.to(data.to).emit('webrtc_offer', {
      from: socket.id,
      offer: data.offer
    });
  });

  // التلميذ يرد بـ answer للأستاذ
  socket.on('webrtc_answer', data => {
    if (socket.role !== 'student') return;
    // data.to = socketId الأستاذ
    io.to(data.to).emit('webrtc_answer', {
      from: socket.id,
      answer: data.answer
    });
  });

  // ICE candidates — في الاتجاهين
  socket.on('webrtc_ice', data => {
    // data.to = socketId الطرف الآخر
    io.to(data.to).emit('webrtc_ice', {
      from: socket.id,
      candidate: data.candidate
    });
  });

  // ===================================================
  //  مايك (إشعار فقط — الصوت الحقيقي عبر WebRTC)
  // ===================================================
  socket.on('mic_status', data => {
    if (socket.role !== 'teacher') return;
    socket.broadcast.emit('mic_status', data);

    // إذا الأستاذ فتح المايك، يرسل offer لكل التلاميذ الموجودين
    // (هذا يصير من طرف client عند استقبال student_joined)
    // لكن إذا في تلاميذ موجودين بالفعل، نخبر الأستاذ بهم
    if (data.on) {
      Object.keys(students).forEach(studentId => {
        io.to(socket.id).emit('student_joined', {
          id: studentId,
          name: students[studentId].name
        });
      });
    }
  });

  // ===================================================
  //  شات
  // ===================================================
  socket.on('chat', data => {
    const msg = {
      name: socket.userName,
      role: socket.role,
      text: data.text,
      time: new Date().toLocaleTimeString('ar')
    };
    chatMessages.push(msg);
    if (chatMessages.length > 100) chatMessages.shift();
    io.emit('chat', msg);
  });

  // ===================================================
  //  تفاعلات التلاميذ
  // ===================================================
  socket.on('student_react', data => {
    if (socket.role !== 'student') return;
    io.emit('student_react', { ...data, name: socket.userName });
  });

  // ===================================================
  //  قطع الاتصال
  // ===================================================
  socket.on('disconnect', () => {
    console.log(`❌ غادر: ${socket.userName} [${socket.id}]`);
    if (role === 'student') {
      delete students[socket.id];
      io.emit('students_list', Object.values(students).map(s => s.name));
    }
    if (role === 'teacher') {
      teacherSocketId = null;
    }
  });
});

// ===================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 السيرفر شاغل على PORT ${PORT}`));
