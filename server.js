require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const JUMPSCARE_DURATION = 5000;
const KNOCK_DURATION = 60000;

const rooms = new Map();

class Room {
  constructor(id, hostId) {
    this.id = id;
    this.hostId = hostId;
    this.players = new Map();
    this.state = 'lobby';
    this.map = 'hospital';
    this.ghost = {
      state: 'PATROL',
      position: { x: 0, y: 1.2, z: -20 },
      rotation: { y: 0 },
      targetId: null
    };
    this.objectives = {
      keysFound: 0,
      generatorOn: false,
      exitOpen: false
    };
    this.createdAt = Date.now();
  }

  addPlayer(socketId, name) {
    if (this.players.size >= MAX_PLAYERS) return false;
    this.players.set(socketId, {
      id: socketId,
      name: name || `Pemain-${socketId.slice(0, 4)}`,
      position: { x: (Math.random() - 0.5) * 4, y: 1.6, z: (Math.random() - 0.5) * 4 },
      rotation: { x: 0, y: 0 },
      anim: 'idle',
      flashlight: false,
      hp: 100,
      status: 'alive',
      knockTimer: null,
      micOn: false,
      isHost: socketId === this.hostId,
      ready: false
    });
    return true;
  }

  removePlayer(socketId) {
    const p = this.players.get(socketId);
    if (p && p.knockTimer) clearTimeout(p.knockTimer);
    this.players.delete(socketId);
    if (this.hostId === socketId && this.players.size > 0) {
      const next = this.players.keys().next().value;
      this.hostId = next;
      this.players.get(next).isHost = true;
    }
  }

  getPublicPlayers() {
    const list = [];
    for (const [id, p] of this.players) {
      list.push({
        id,
        name: p.name,
        position: p.position,
        rotation: p.rotation,
        anim: p.anim,
        flashlight: p.flashlight,
        status: p.status,
        isHost: p.isHost,
        ready: p.ready,
        micOn: p.micOn,
        hp: p.hp
      });
    }
    return list;
  }
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function checkGameOver(room) {
  let alive = 0;
  for (const p of room.players.values()) {
    if (p.status === 'alive' || p.status === 'knocked' || p.status === 'jumpscare') alive++;
  }
  if (alive === 0) {
    room.state = 'ended';
    io.to(room.id).emit('gameOver', { reason: 'Semua pemain mati' });
  }
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('createRoom', (data, cb) => {
    const roomId = generateRoomId();
    const room = new Room(roomId, socket.id);
    room.addPlayer(socket.id, data && data.name);
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.roomId = roomId;
    if (typeof cb === 'function') {
      cb({ ok: true, roomId, players: room.getPublicPlayers() });
    }
    io.to(roomId).emit('roomUpdate', { players: room.getPublicPlayers(), hostId: room.hostId });
  });

  socket.on('joinRoom', (data, cb) => {
    const room = rooms.get(data.roomId);
    if (!room) return typeof cb === 'function' && cb({ ok: false, error: 'Room tidak ditemukan' });
    if (room.state !== 'lobby') return typeof cb === 'function' && cb({ ok: false, error: 'Game sudah dimulai' });
    if (room.players.size >= MAX_PLAYERS) return typeof cb === 'function' && cb({ ok: false, error: 'Room penuh' });
    if (!room.addPlayer(socket.id, data.name)) return typeof cb === 'function' && cb({ ok: false, error: 'Gagal join' });
    socket.join(data.roomId);
    socket.roomId = data.roomId;
    if (typeof cb === 'function') {
      cb({ ok: true, roomId: data.roomId, players: room.getPublicPlayers() });
    }
    io.to(data.roomId).emit('roomUpdate', { players: room.getPublicPlayers(), hostId: room.hostId });
  });

  socket.on('quickJoin', (data, cb) => {
    let found = null;
    for (const [, room] of rooms) {
      if (room.state === 'lobby' && room.players.size < MAX_PLAYERS) {
        found = room;
        break;
      }
    }
    if (!found) return typeof cb === 'function' && cb({ ok: false, error: 'Tidak ada room tersedia. Buat room baru.' });
    if (!found.addPlayer(socket.id, data && data.name)) return typeof cb === 'function' && cb({ ok: false, error: 'Gagal join' });
    socket.join(found.id);
    socket.roomId = found.id;
    if (typeof cb === 'function') {
      cb({ ok: true, roomId: found.id, players: found.getPublicPlayers() });
    }
    io.to(found.id).emit('roomUpdate', { players: found.getPublicPlayers(), hostId: found.hostId });
  });

  socket.on('leaveRoom', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (room) {
      room.removePlayer(socket.id);
      socket.leave(roomId);
      if (room.players.size === 0) {
        rooms.delete(roomId);
      } else {
        io.to(roomId).emit('roomUpdate', { players: room.getPublicPlayers(), hostId: room.hostId });
      }
    }
    socket.roomId = null;
  });

  socket.on('setReady', (ready) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (p) p.ready = !!ready;
    io.to(socket.roomId).emit('roomUpdate', { players: room.getPublicPlayers(), hostId: room.hostId });
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.hostId !== socket.id) return;
    room.state = 'playing';
    let i = 0;
    for (const p of room.players.values()) {
      p.position = { x: (i - 1.5) * 2, y: 1.6, z: 5 };
      p.status = 'alive';
      p.hp = 100;
      p.anim = 'idle';
      i++;
    }
    io.to(socket.roomId).emit('gameStart', {
      players: room.getPublicPlayers(),
      ghost: room.ghost,
      objectives: room.objectives
    });
  });

  socket.on('playerUpdate', (data) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.state !== 'playing') return;
    const p = room.players.get(socket.id);
    if (!p || p.status === 'dead') return;
    if (data.position) p.position = data.position;
    if (data.rotation) p.rotation = data.rotation;
    if (data.anim) p.anim = data.anim;
    if (typeof data.flashlight === 'boolean') p.flashlight = data.flashlight;
    socket.to(socket.roomId).emit('playerMoved', {
      id: socket.id,
      position: p.position,
      rotation: p.rotation,
      anim: p.anim,
      flashlight: p.flashlight
    });
  });

  socket.on('requestJumpscare', (targetId) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const target = room.players.get(targetId || socket.id);
    if (!target || target.status !== 'alive') return;

    target.status = 'jumpscare';
    io.to(socket.roomId).emit('jumpscareStart', {
      targetId: target.id,
      duration: JUMPSCARE_DURATION
    });

    setTimeout(() => {
      if (target.status === 'jumpscare') {
        target.status = 'knocked';
        target.hp = 0;
        io.to(socket.roomId).emit('playerKnocked', {
          id: target.id,
          duration: KNOCK_DURATION
        });
        target.knockTimer = setTimeout(() => {
          if (target.status === 'knocked') {
            target.status = 'dead';
            io.to(socket.roomId).emit('playerDied', { id: target.id });
            checkGameOver(room);
          }
        }, KNOCK_DURATION);
      }
    }, JUMPSCARE_DURATION);
  });

  socket.on('knifeHit', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const attacker = room.players.get(socket.id);
    if (!attacker || attacker.status !== 'alive') return;

    const ghostPos = room.ghost.position;
    const dist = Math.hypot(
      attacker.position.x - ghostPos.x,
      attacker.position.z - ghostPos.z
    );
    if (dist > 4.0) return;

    for (const p of room.players.values()) {
      if (p.status === 'jumpscare') {
        p.status = 'alive';
        p.hp = Math.max(20, p.hp);
        room.ghost.state = 'STUNNED';
        io.to(socket.roomId).emit('jumpscareSuccess', { targetId: p.id });
        setTimeout(() => {
          room.ghost.state = 'PATROL';
          io.to(socket.roomId).emit('ghostState', room.ghost);
        }, 8000);
        return;
      }
    }
  });

  socket.on('startRevive', (targetId) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const helper = room.players.get(socket.id);
    const target = room.players.get(targetId);
    if (!helper || !target || helper.status !== 'alive' || target.status !== 'knocked') return;
    const dist = Math.hypot(
      helper.position.x - target.position.x,
      helper.position.z - target.position.z
    );
    if (dist > 2.5) return;
    io.to(socket.roomId).emit('reviveStart', { helperId: socket.id, targetId });
  });

  socket.on('finishRevive', (targetId) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const helper = room.players.get(socket.id);
    const target = room.players.get(targetId);
    if (!helper || !target || helper.status !== 'alive' || target.status !== 'knocked') return;
    const dist = Math.hypot(
      helper.position.x - target.position.x,
      helper.position.z - target.position.z
    );
    if (dist > 3.0) return;

    if (target.knockTimer) clearTimeout(target.knockTimer);
    target.status = 'alive';
    target.hp = 40;
    target.anim = 'idle';
    io.to(socket.roomId).emit('reviveSuccess', { targetId, helperId: socket.id });
  });

  // WebRTC signaling
  socket.on('webrtc-offer', (data) => {
    socket.to(data.to).emit('webrtc-offer', { from: socket.id, offer: data.offer });
  });
  socket.on('webrtc-answer', (data) => {
    socket.to(data.to).emit('webrtc-answer', { from: socket.id, answer: data.answer });
  });
  socket.on('webrtc-ice', (data) => {
    socket.to(data.to).emit('webrtc-ice', { from: socket.id, candidate: data.candidate });
  });
  socket.on('micState', (on) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (p) p.micOn = !!on;
    io.to(socket.roomId).emit('micUpdate', { id: socket.id, micOn: !!on });
  });

  // Demo: trigger jumpscare on self (for testing)
  socket.on('debugJumpscare', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const target = room.players.get(socket.id);
    if (!target || target.status !== 'alive') return;
    target.status = 'jumpscare';
    io.to(socket.roomId).emit('jumpscareStart', { targetId: target.id, duration: JUMPSCARE_DURATION });
    setTimeout(() => {
      if (target.status === 'jumpscare') {
        target.status = 'knocked';
        target.hp = 0;
        io.to(socket.roomId).emit('playerKnocked', { id: target.id, duration: KNOCK_DURATION });
        target.knockTimer = setTimeout(() => {
          if (target.status === 'knocked') {
            target.status = 'dead';
            io.to(socket.roomId).emit('playerDied', { id: target.id });
            checkGameOver(room);
          }
        }, KNOCK_DURATION);
      }
    }, JUMPSCARE_DURATION);
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.removePlayer(socket.id);
        if (room.players.size === 0) rooms.delete(roomId);
        else io.to(roomId).emit('roomUpdate', { players: room.getPublicPlayers(), hostId: room.hostId });
      }
    }
    console.log('Disconnected:', socket.id);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.players.size === 0 && now - room.createdAt > 60000) rooms.delete(id);
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`GELAP BERSAMA server running on http://localhost:${PORT}`);
});
