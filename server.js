const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const C = require('./game/constants');
const Room = require('./game/room');
const { LAYOUTS } = require('./game/maps');

const app = express();
// Serve o cliente: os jogadores só precisam abrir a URL do servidor (ou do Ngrok) no navegador
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 8000 });

const rooms = new Map();     // código → Room
const sessions = new Map();  // token do navegador → { code, pid }  (permite reconectar sem perder nada)

// Configuração que o cliente precisa saber (antes ficava fixa no cliente)
const CFG = {
    flameTime: C.FLAME_TIME,
    skillCooldown: C.SKILL_COOLDOWN,
    ghostCooldown: C.GHOST_COOLDOWN,
    ghostMove: C.GHOST_MOVE,
    countdown: C.COUNTDOWN_MS,
    limit: C.PLAYERS_LIMIT,
    targets: C.TARGETS,
    colors: C.COLORS,
    teamColors: C.TEAM_COLORS,
    layouts: LAYOUTS.map(({ id, name, w, h, min, max }) => ({ id, name, w, h, min, max }))
};

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I e O para não confundir
function newCode() {
    let code;
    do { code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
    while (rooms.has(code));
    return code;
}

function createRoom() {
    const room = new Room(newCode());
    room.onRemoved = (p) => {
        const s = p.token && sessions.get(p.token);
        if (s && s.pid === p.pid) sessions.delete(p.token);
    };
    rooms.set(room.code, room);
    console.log(`Sala ${room.code} criada`);
    return room;
}

// Valida a entrada antes de aceitar a conexão
io.use((socket, next) => {
    const a = socket.handshake.auth || {};
    const token = typeof a.token === 'string' ? a.token.slice(0, 80) : '';
    if (token.length < 10) return next(new Error('Sessão inválida. Recarregue a página.'));
    const action = a.action === 'create' ? 'create' : 'join';
    const code = String(a.room || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

    // Reconexão: mesmo navegador voltando para a mesma sala → recupera o jogador
    const sess = sessions.get(token);
    if (sess) {
        const r = rooms.get(sess.code);
        if (r && r.players[sess.pid] && action === 'join' && code === sess.code) {
            socket.data = { room: r, pid: sess.pid, token };
            return next();
        }
        if (r && r.players[sess.pid]) r.removePlayer(sess.pid); // foi para outra sala: sai da antiga
        sessions.delete(token);
    }

    let room;
    if (action === 'create') {
        room = createRoom();
    } else {
        if (code.length !== 4) return next(new Error('Digite o código da sala (4 letras).'));
        room = rooms.get(code);
        if (!room) return next(new Error(`Sala ${code} não encontrada.`));
        if (room.list().length >= C.PLAYERS_LIMIT) return next(new Error('Sala cheia! Máximo de 8 jogadores.'));
    }
    socket.data = { room, pid: null, token, profile: { name: a.name, color: a.color, hat: a.hat } };
    next();
});

io.on('connection', (socket) => {
    const { room, token } = socket.data;
    let p = socket.data.pid && room.players[socket.data.pid];
    if (p) {
        p.connected = true;
        room.dirty = true;
        console.log(`[${room.code}] ${p.name} reconectou`);
    } else {
        p = room.addPlayer({ token, ...socket.data.profile });
        sessions.set(token, { code: room.code, pid: p.pid });
        console.log(`[${room.code}] ${p.name} entrou (${room.list().length} na sala)`);
    }
    p.socketId = socket.id;
    const pid = p.pid;

    socket.join(room.code);
    socket.emit('welcome', { pid, code: room.code, cfg: CFG });
    socket.emit('state', room.snapshot(true));

    // Só aceita comandos do socket atual daquele jogador
    const on = (name, fn) => socket.on(name, (...args) => {
        const pl = room.players[pid];
        if (!pl || pl.socketId !== socket.id) return;
        try { fn(pl, ...args); } catch (err) { console.error(`Erro em "${name}":`, err); }
    });

    on('move', (pl, m) => { if (m && typeof m === 'object') room.move(pl, m.d, m.s, !!m.f); });
    on('bomb', (pl) => room.placeBomb(pl));
    on('skill', (pl) => room.useSkill(pl));
    on('detonate', (pl) => room.detonate(pl));
    on('emote', (pl, n) => room.emote(pl, n));
    on('ready', (pl, v) => room.setReady(pl, !!v));
    on('vote', (pl, id) => room.setVote(pl, String(id)));
    on('settings', (pl, s) => room.updateSettings(pl, s));
    on('bot', (pl, d) => room.changeBots(pl, d > 0 ? 1 : -1));
    on('team', (pl) => room.switchTeam(pl));
    on('leave', (pl) => {
        room.removePlayer(pl.pid);
        sessions.delete(token);
        socket.leave(room.code);
        socket.disconnect(true);
    });

    socket.on('disconnect', () => {
        const pl = room.players[pid];
        if (pl && pl.socketId === socket.id) {
            pl.connected = false;
            pl.discAt = Date.now();
            room.dirty = true;
            console.log(`[${room.code}] ${pl.name} caiu (tem ${C.RECONNECT_GRACE / 1000}s para voltar)`);
        }
    });
});

// Laço principal: ~30 vezes por segundo, atualiza todas as salas e envia o estado
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
        try {
            room.tick(now);
            room.flush(io, now);
        } catch (err) {
            console.error(`Erro na sala ${code}:`, err);
        }
        if (room.isDead(now)) {
            rooms.delete(code);
            console.log(`Sala ${code} encerrada`);
        }
    }
}, C.TICK_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
