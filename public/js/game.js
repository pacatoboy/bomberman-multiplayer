'use strict';
/* ==========================================================
 *  game.js — conexão, predição de movimento, controles
 *  (teclado, toque, gamepad), efeitos e interface.
 * ========================================================== */

// ================= armazenamento seguro =================
const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* modo privado */ } }
};
function getToken() {
    let t = store.get('bm_token', '');
    if (!t || t.length < 16) {
        t = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
            : Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
        store.set('bm_token', t);
    }
    return t;
}

const prefs = {
    sound: store.get('bm_sound', '1') === '1',
    shake: store.get('bm_shake', '1') === '1',
    touch: store.get('bm_touch', 'auto')            // auto | on | off
};
Sound.setEnabled(prefs.sound);

const profile = {
    name: store.get('bm_name', ''),
    color: store.get('bm_color', COLORS[Math.floor(Math.random() * 8)]),
    hat: store.get('bm_hat', 'sprout')
};

// ================= DOM e canvas =================
const $ = (id) => document.getElementById(id);
const canvas = $('gameCanvas');
const ctx = canvas.getContext('2d');
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const gridCanvas = document.createElement('canvas');
const gctx = gridCanvas.getContext('2d');
let GW = 15, GH = 13, WPX = TILE * GW, HPX = TILE * GH, TH = THEMES.grass;
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// ================= rede =================
let socket = null, myPid = null, roomCode = null, cfg = null, serverUrl = '';
let S = null;          // último estado recebido
let stateTime = 0;     // quando chegou (para animar tempos)
const authData = { token: '', name: '', color: '', hat: '', action: 'create', room: '' };

// ================= predição =================
const pred = { x: 0, y: 0, dir: 'down', mode: 'none' };
let pending = [];      // comandos enviados ainda não confirmados pelo servidor
let seq = 0;
let lastStepAt = 0;
let lastMoveDir = null;
let buffer = null;     // próximo comando guardado (input buffer)
let localBombs = [];   // bombas mostradas antes da confirmação do servidor

// ================= entrada =================
const KEY_DIR = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
let keyStack = [];
let touchDir = null;
let padDir = null;
const padPrev = [];

// ================= efeitos =================
const rp = {};         // posição desenhada de cada jogador
const rb = {};         // posição desenhada de cada bomba
let particles = [], floaters = [], deaths = [], throws = [], bubbles = [];
let banner = null, shake = 0, lastCount = null, lastT = performance.now();

// =========================================================
//  Tela inicial
// =========================================================
function markProfile() {
    document.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('on', b.dataset.c === profile.color));
    document.querySelectorAll('.hatBtn').forEach((b) => b.classList.toggle('on', b.dataset.h === profile.hat));
}

function setupHome() {
    $('playerName').value = profile.name;
    for (const c of COLORS) {
        const b = document.createElement('button');
        b.className = 'swatch'; b.style.background = c; b.dataset.c = c; b.title = 'Cor';
        b.onclick = () => { profile.color = c; store.set('bm_color', c); markProfile(); };
        $('colorPick').appendChild(b);
    }
    for (const [id, icon, label] of HATS) {
        const b = document.createElement('button');
        b.className = 'hatBtn'; b.dataset.h = id; b.title = label; b.textContent = icon;
        b.onclick = () => { profile.hat = id; store.set('bm_hat', id); markProfile(); };
        $('hatPick').appendChild(b);
    }
    markProfile();

    const http = location.protocol.startsWith('http');
    $('serverUrl').value = http ? location.origin : 'http://localhost:3000';
    if (!http) $('advanced').open = true;

    const qs = new URLSearchParams(location.search).get('sala');
    const last = store.get('bm_room', '');
    if (qs) $('roomCode').value = qs.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    else if (last) { $('roomCode').value = last; $('rejoinHint').textContent = `Última sala: ${last} (entre de novo para continuar de onde parou)`; }

    $('roomCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
    $('roomCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
    $('playerName').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('roomCode').value.length === 4 ? $('joinBtn') : $('createBtn')).click(); });
    $('createBtn').onclick = () => connect('create');
    $('joinBtn').onclick = () => connect('join', $('roomCode').value.trim());
}

function startPreview() {
    const pc = $('preview'), pg = pc.getContext('2d');
    const dirs = ['down', 'right', 'down', 'left'];
    function loop(t) {
        requestAnimationFrame(loop);
        if ($('home').classList.contains('hidden')) return;
        pg.setTransform(1, 0, 0, 1, 0, 0);
        pg.clearRect(0, 0, pc.width, pc.height);
        pg.setTransform(3.4, 0, 0, 3.4, 0, 0);
        drawCharacter(pg, 32, 38, profile.color, dirs[Math.floor(t / 1500) % 4], { walk: true, phase: t / 70, t, seed: 3, hat: profile.hat });
    }
    requestAnimationFrame(loop);
}

function setError(msg) { $('error').textContent = msg || ''; }

function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

function showScreen(game) {
    $('home').classList.toggle('hidden', game);
    $('game').classList.toggle('hidden', !game);
    document.body.classList.toggle('in-game', game);
    updateTouchVisibility();
    if (game) fitCanvas();
}

// =========================================================
//  Conexão
// =========================================================
async function connect(action, code) {
    const name = $('playerName').value.trim();
    profile.name = name; store.set('bm_name', name);
    if (action === 'join' && !/^[A-Z]{4}$/.test(code || '')) { setError('O código da sala tem 4 letras.'); return; }
    Sound.unlock();
    setError('Conectando...');
    try { await window.ioReady; } catch (e) { setError(e.message); return; }

    serverUrl = $('serverUrl').value.trim() || location.origin;
    Object.assign(authData, { token: getToken(), name, color: profile.color, hat: profile.hat, action, room: code || '' });
    if (socket) { socket.off(); socket.disconnect(); }
    myPid = null; S = null;

    socket = io(serverUrl, {
        auth: (cb) => cb(authData), // função: na reconexão manda o token atualizado e recupera o jogador
        extraHeaders: { 'ngrok-skip-browser-warning': 'true' }
    });
    socket.on('welcome', onWelcome);
    socket.on('state', onState);
    socket.on('connect_error', (err) => {
        if (!myPid) { setError('Não consegui entrar: ' + err.message); socket.disconnect(); return; }
        if (/não encontrada|cheia|inválida/i.test(err.message)) { goHome('A sala não existe mais (o servidor pode ter reiniciado).'); return; }
        showToast('Reconectando...');
    });
    socket.on('disconnect', (reason) => {
        if (myPid && reason !== 'io client disconnect') showToast('Conexão perdida... tentando voltar');
    });
}

function onWelcome(w) {
    const firstTime = !myPid;
    myPid = w.pid; roomCode = w.code; cfg = w.cfg;
    authData.action = 'join'; authData.room = w.code; // reconexões voltam para a mesma sala
    store.set('bm_room', w.code);
    if (location.protocol.startsWith('http')) history.replaceState(null, '', '?sala=' + w.code);
    $('roomLbl').textContent = w.code;
    if (firstTime) { buildLobbyControls(); pending = []; seq = 0; showToast(`Você está na sala ${w.code}`); }
    else showToast('Reconectado!');
    setError('');
    showScreen(true);
}

function goHome(msg) {
    if (socket) { socket.off(); socket.disconnect(); socket = null; }
    myPid = null; S = null;
    showScreen(false);
    setError(msg || '');
}

function leaveRoom() {
    if (socket) socket.emit('leave');
    store.set('bm_room', '');
    $('rejoinHint').textContent = '';
    if (location.protocol.startsWith('http')) history.replaceState(null, '', location.pathname);
    setTimeout(() => goHome(''), 50);
}

function myPlayer() { return S && myPid ? S.players[myPid] : null; }
function myMode(me) {
    if (!me) return 'none';
    if (me.alive) return 'body';
    if (me.ghost && S.phase === 'playing') return 'ghost';
    return 'none';
}

// =========================================================
//  Estado do servidor
// =========================================================
function onState(pk) {
    const t = performance.now();
    const prev = S;
    if (!pk.grid) { if (!prev) return; pk.grid = prev.grid; }
    S = pk;
    stateTime = t;

    if (S.map.w !== GW || S.map.h !== GH) resizeBoard(S.map.w, S.map.h);
    const theme = THEMES[S.map.theme] || THEMES.grass;
    if (!prev || pk.grid !== prev.grid || theme !== TH) { TH = theme; buildGrid(); }

    for (const p of Object.values(S.players)) if (!rp[p.pid]) rp[p.pid] = newRender(p);
    for (const id of Object.keys(rp)) if (!S.players[id]) delete rp[id];

    if (pk.ev) for (const e of pk.ev) handleEvent(e, t);
    reconcile();
    // bombas previstas: some quando o servidor confirmar ou depois de um tempo
    localBombs = localBombs.filter((b) => t - b.born < 700 && !S.bombs.some((s) => s.x === b.x && s.y === b.y));
    updateUI();
}

// Reconciliação: parte da posição oficial e reaplica os comandos ainda não confirmados
function reconcile() {
    const me = myPlayer();
    if (!me) return;
    const mode = myMode(me);
    if (mode !== pred.mode) { pending = []; buffer = null; pred.mode = mode; }
    pending = pending.filter((i) => i.s > me.ack);
    const pos = mode === 'ghost' ? { x: me.ghost.x, y: me.ghost.y } : { x: me.x, y: me.y };
    let dir = me.dir;
    for (const i of pending) {
        dir = i.d;
        if (!i.f && canMove(pos, i.d, mode)) { pos.x += DIRS[i.d][0]; pos.y += DIRS[i.d][1]; }
    }
    pred.x = pos.x; pred.y = pos.y;
    pred.dir = pending.length ? dir : me.dir;
}

function canMove(pos, d, mode) {
    const v = DIRS[d];
    if (!v || !S) return false;
    const nx = pos.x + v[0], ny = pos.y + v[1];
    if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) return false;
    if (mode === 'ghost') return nx === 0 || ny === 0 || nx === GW - 1 || ny === GH - 1;
    if (S.grid[ny][nx] !== 0) return false;
    if (S.bombs.some((b) => b.x === nx && b.y === ny)) return false;
    if (localBombs.some((b) => b.x === nx && b.y === ny)) return false;
    return true;
}

// =========================================================
//  Entrada: direção desejada, buffer e ajuda nas quinas
// =========================================================
function mapDir(d) {
    const me = myPlayer();
    return d && me && me.alive && me.curse && me.curse.t === 'reverse' ? OPPOSITE[d] : d;
}
function wantedDir() {
    return mapDir(touchDir || padDir || (keyStack.length ? keyStack[keyStack.length - 1] : null));
}
function pressDir(raw) {
    buffer = { d: mapDir(raw), until: performance.now() + 250 };
    inputStep(performance.now());
}

function chooseStep(mode, desired) {
    const now = performance.now();
    const buffered = buffer && now < buffer.until ? buffer.d : null;
    const target = desired || buffered;
    const cands = [];
    if (buffered) cands.push(buffered);
    if (desired && desired !== buffered) cands.push(desired);
    for (const d of cands) if (canMove(pred, d, mode)) { if (d === buffered) buffer = null; return d; }

    if (mode === 'body' && target) {
        // Ajuda nas quinas: se o corredor está a uma casa de distância, desliza até ele
        const perps = target === 'up' || target === 'down' ? ['left', 'right'] : ['up', 'down'];
        if (lastMoveDir && perps.includes(lastMoveDir)) perps.sort((a) => (a === lastMoveDir ? -1 : 1));
        for (const p of perps) {
            if (!canMove(pred, p, mode)) continue;
            const n = { x: pred.x + DIRS[p][0], y: pred.y + DIRS[p][1] };
            if (canMove(n, target, mode)) return p;
        }
    }
    // Duas teclas seguradas (ex.: cima + direita): anda pela que estiver livre
    if (desired) {
        for (const raw of keyStack.slice().reverse()) {
            const d = mapDir(raw);
            if (d !== desired && canMove(pred, d, mode)) return d;
        }
    }
    return null;
}

function sendFace(d) {
    pred.dir = d;
    pending.push({ s: ++seq, d, f: 1 });
    socket.emit('move', { d, s: seq, f: 1 });
}

function inputStep(now) {
    if (!S || !socket || !myPid || !cfg) return;
    const me = myPlayer();
    const mode = myMode(me);
    if (mode === 'none') return;
    if (buffer && now > buffer.until) buffer = null;
    const desired = wantedDir();
    const acting = S.phase === 'lobby' || S.phase === 'playing';
    if (!acting) {
        if (desired && mode === 'body' && desired !== pred.dir) sendFace(desired);
        return;
    }
    const interval = mode === 'ghost' ? cfg.ghostMove : me.mi;
    if (now - lastStepAt < interval) return;
    if (!desired && !buffer) return;
    const d = chooseStep(mode, desired);
    if (d) {
        // Predição: anda na hora, sem esperar o servidor
        pred.x += DIRS[d][0]; pred.y += DIRS[d][1];
        pred.dir = d; lastMoveDir = d;
        pending.push({ s: ++seq, d });
        socket.emit('move', { d, s: seq });
        lastStepAt = now;
    } else if (desired && mode === 'body' && desired !== pred.dir) {
        sendFace(desired); // vira para a direção (importa para chute e dash)
    }
}

function actBomb() {
    if (!socket || !S) return;
    const me = myPlayer();
    if (me && me.alive && (S.phase === 'lobby' || S.phase === 'playing')) {
        const mine = S.bombs.filter((b) => b.owner === myPid && !b.ghost).length + localBombs.length;
        const busy = S.bombs.some((b) => b.x === pred.x && b.y === pred.y) || localBombs.some((b) => b.x === pred.x && b.y === pred.y);
        if (mine < me.bombs && !busy && !(me.curse && me.curse.t === 'nobomb')) {
            localBombs.push({ x: pred.x, y: pred.y, born: performance.now() });
            Sound.place();
        }
    }
    socket.emit('bomb');
}
const actSkill = () => { if (socket) socket.emit('skill'); };
const actDetonate = () => { if (socket) socket.emit('detonate'); };
const actEmote = (n) => { if (socket) socket.emit('emote', n); };

// ---------- teclado ----------
window.addEventListener('keydown', (e) => {
    if (!myPid || $('game').classList.contains('hidden')) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    const dir = KEY_DIR[k];
    if (dir || e.code === 'Space') e.preventDefault();
    if (dir) {
        if (!keyStack.includes(dir)) { keyStack.push(dir); pressDir(dir); }
        return;
    }
    if (e.repeat) return;
    Sound.unlock();
    if (e.code === 'Space') actBomb();
    else if (k === 'e') actSkill();
    else if (k === 'r' || k === 'q') actDetonate();
    else if (/^[1-6]$/.test(k)) actEmote(Number(k) - 1);
});
window.addEventListener('keyup', (e) => {
    const dir = KEY_DIR[e.key.toLowerCase()];
    if (dir) keyStack = keyStack.filter((d) => d !== dir);
});
window.addEventListener('blur', () => { keyStack = []; touchDir = null; });

// ---------- toque ----------
function touchVisible() { return prefs.touch === 'on' || (prefs.touch === 'auto' && isTouchDevice); }
function updateTouchVisibility() {
    const show = touchVisible() && !$('game').classList.contains('hidden');
    $('touch').classList.toggle('hidden', !show);
    document.body.classList.toggle('touch-mode', show);
    $('helpCard').classList.toggle('hidden', show);
}

function setupTouch() {
    const stick = $('stick'), knob = $('knob');
    let sid = null, ox = 0, oy = 0;
    const moveStick = (e) => {
        let dx = e.clientX - ox, dy = e.clientY - oy;
        const len = Math.hypot(dx, dy), max = 46;
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        let d = null;
        if (len > 14) d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        const changed = d && d !== touchDir;
        touchDir = d;
        if (changed) pressDir(d);
    };
    stick.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        Sound.unlock();
        sid = e.pointerId;
        try { stick.setPointerCapture(sid); } catch (err) { /* alguns navegadores recusam; segue sem captura */ }
        const r = stick.getBoundingClientRect();
        ox = r.left + r.width / 2; oy = r.top + r.height / 2;
        moveStick(e);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) moveStick(e); });
    const end = (e) => { if (e.pointerId !== sid) return; sid = null; knob.style.transform = ''; touchDir = null; };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    const tap = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); Sound.unlock(); fn(); });
    tap('tBomb', actBomb);
    tap('tSkill', actSkill);
    tap('tDet', actDetonate);
    tap('tEmote', () => $('emoteBar').classList.toggle('hidden'));
    EMOTES.forEach((em, i) => {
        const b = document.createElement('button');
        b.textContent = em;
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); actEmote(i); $('emoteBar').classList.add('hidden'); });
        $('emoteBar').appendChild(b);
    });
}

// ---------- gamepad ----------
window.addEventListener('gamepadconnected', () => showToast('🎮 Controle conectado!'));
function pollGamepad() {
    if (!navigator.getGamepads) return;
    const gp = [...navigator.getGamepads()].find((g) => g && g.connected);
    if (!gp) { padDir = null; return; }
    const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    let d = pressed(12) ? 'up' : pressed(13) ? 'down' : pressed(14) ? 'left' : pressed(15) ? 'right' : null;
    if (!d) {
        const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
        if (Math.max(Math.abs(ax), Math.abs(ay)) > 0.5) d = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : (ay > 0 ? 'down' : 'up');
    }
    const changed = d && d !== padDir;
    padDir = d;
    if (changed) pressDir(d);
    const edge = (i) => { const now = pressed(i), was = padPrev[i]; padPrev[i] = now; return now && !was; };
    const a = edge(0), b = edge(1), x = edge(2), y = edge(3), lb = edge(4), rbtn = edge(5), start = edge(9);
    if (!myPid || $('game').classList.contains('hidden')) return;
    if (a) actBomb();
    if (b || x) actSkill();
    if (y) actDetonate();
    if (lb) actEmote(2);
    if (rbtn) actEmote(3);
    if (start && S && S.phase === 'lobby') toggleReady();
}

// =========================================================
//  Eventos explícitos do servidor → efeitos
// =========================================================
function newRender(p) {
    const g = p.ghost;
    return { x: p.x, y: p.y, gx: g ? g.x : p.x, gy: g ? g.y : p.y, phase: 0, lastMove: -1e9, dash: false, trail: [], seed: hashStr(p.pid) };
}
function snapAll() {
    if (!S) return;
    for (const p of Object.values(S.players)) rp[p.pid] = newRender(p);
}

// 1 = perto do jogador local, ~0 = longe (para som e tremor)
function proximity(x, y) {
    const me = myPlayer(), r = me && rp[myPid];
    let rx = GW / 2, ry = GH / 2;
    if (me && r) { if (me.alive) { rx = r.x; ry = r.y; } else if (me.ghost) { rx = r.gx; ry = r.gy; } }
    return clamp(1 - Math.hypot(x - rx, y - ry) / 10, 0.08, 1);
}
function addShake(amount) { if (prefs.shake) shake = Math.min(14, shake + amount); }

function handleEvent(e, t) {
    const p = e.pid ? S.players[e.pid] : null;
    const r = e.pid ? rp[e.pid] : null;
    switch (e.e) {
        case 'bomb':
            if (!(e.pid === myPid && localBombs.some((b) => b.x === e.x && b.y === e.y))) Sound.place();
            break;
        case 'boom': {
            const k = proximity(e.x, e.y);
            Sound.boom(0.3 + 0.7 * k);
            addShake(10 * k);
            for (const [x, y] of e.tiles) if (Math.random() < 0.45) sparks(x, y, 3, ['#ffd23f', '#ff8a3d', '#fff3b0']);
            break;
        }
        case 'blocks': e.tiles.forEach(([x, y]) => burstDebris(x, y)); break;
        case 'burn': e.tiles.forEach(([x, y]) => poof(x, y, '#bbbbbb')); break;
        case 'pickup': {
            const info = PU_INFO[e.type] || PU_INFO.BOMB;
            const curse = e.curse && CURSE_INFO[e.curse];
            floaters.push({ text: curse ? `${curse.icon} ${curse.label}` : info.label, x: e.x * TILE + TILE / 2, y: e.y * TILE, born: t, color: e.type === 'SKULL' ? '#d9b8ff' : '#fff' });
            sparks(e.x, e.y, 10, ['#ffd23f', '#ffffff', p ? p.color : '#fff']);
            if (e.pid === myPid) (e.type === 'SKULL' ? Sound.curse() : Sound.pickup());
            break;
        }
        case 'curse': {
            const c = CURSE_INFO[e.t];
            if (p && c) floaters.push({ text: `${c.icon} ${c.label}`, x: p.x * TILE + TILE / 2, y: p.y * TILE, born: t, color: '#d9b8ff' });
            if (e.pid === myPid) Sound.curse();
            break;
        }
        case 'death': {
            const x = r ? r.x : e.x, y = r ? r.y : e.y;
            deaths.push({ x, y, color: p ? p.color : '#fff', hat: p ? p.hat : 'none', born: t, seed: r ? r.seed : 0 });
            sparks(x, y, 14, ['#ffffff', p ? p.color : '#fff', '#ffd23f']);
            Sound.death();
            if (r) { r.gx = x; r.gy = y; } // o fantasma sai flutuando do lugar onde morreu
            if (e.pid === myPid && S.phase === 'playing') {
                banner = { text: 'Virou fantasma!', sub: 'Ande pela borda e jogue bombas 👻', born: t, dur: 2400, color: '#d9ccff' };
            }
            break;
        }
        case 'revive':
            if (r) { r.x = e.x; r.y = e.y; r.trail = []; }
            poof(e.x, e.y, '#ffd23f');
            if (!e.quiet) {
                floaters.push({ text: 'VINGANÇA! Voltou à vida', x: e.x * TILE + TILE / 2, y: e.y * TILE, born: t, color: '#ffd23f' });
                Sound.revive();
            }
            if (e.pid === myPid) { pending = []; buffer = null; }
            break;
        case 'throw': throws.push({ id: e.id, from: e.from, to: e.to, born: t }); Sound.throw(); break;
        case 'teleport':
            poof(e.from[0], e.from[1], '#c084fc'); poof(e.to[0], e.to[1], '#c084fc');
            if (r) { r.x = e.to[0]; r.y = e.to[1]; }
            Sound.skill();
            break;
        case 'dash': if (r) r.dash = true; Sound.skill(); break;
        case 'skill': if (e.pid === myPid || e.skill === 'SHIELD') Sound.skill(); break;
        case 'walls':
            e.tiles.forEach(([x, y]) => poof(x, y, '#9aa0b8'));
            addShake(2 * proximity(e.tiles[0][0], e.tiles[0][1]));
            Sound.thud();
            break;
        case 'hurry':
            banner = { text: 'HURRY UP!', sub: 'As paredes estão fechando', born: t, dur: 2200, color: '#ff5d73' };
            Sound.alarm();
            break;
        case 'round':
            snapAll(); pending = []; buffer = null; lastCount = null;
            deaths = []; throws = []; particles = []; floaters = []; bubbles = [];
            break;
        case 'go':
            banner = { text: 'VAI!', sub: `${S.map.name} · ${TH.label}`, born: t, dur: 1300, color: '#ffd23f' };
            Sound.go();
            break;
        case 'roundEnd': {
            const w = e.winner;
            const mine = w && (w.pid === myPid || (w.team && myPlayer() && myPlayer().team === w.team));
            banner = {
                text: !w ? 'Empate!' : mine ? (w.team ? 'Seu time venceu!' : 'Você venceu!') : `${w.name} venceu!`,
                sub: w ? '🏆 +1 vitória' : 'Ninguém sobrou...', born: t, dur: 3300, color: w ? w.color : '#fff', big: true
            };
            if (w) Sound.win();
            break;
        }
        case 'matchEnd': {
            const c = e.champion;
            const me = myPlayer();
            const mine = c.pid === myPid || (c.team && me && me.team === c.team);
            banner = { text: `🏆 ${c.name}`, sub: mine ? 'CAMPEÃO! Você ganhou a partida!' : 'é o campeão da partida!', born: t, dur: 8600, color: c.color, big: true };
            confetti(c.color);
            Sound.fanfare();
            break;
        }
        case 'lobby':
            snapAll(); pending = []; buffer = null;
            banner = { text: 'Lobby', sub: 'Aperte PRONTO para a próxima partida', born: t, dur: 2000, color: '#ffffff' };
            break;
        case 'emote':
            bubbles = bubbles.filter((b) => b.pid !== e.pid);
            bubbles.push({ pid: e.pid, n: e.n, born: t });
            if (e.pid !== myPid) Sound.emote();
            break;
    }
}

// ---------- partículas ----------
function burstDebris(tx, ty) {
    for (let i = 0; i < 9; i++) {
        particles.push({
            x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, vx: (Math.random() - 0.5) * 220, vy: -Math.random() * 220 - 40,
            g: 600, life: 0, max: 0.6 + Math.random() * 0.3, size: 4 + Math.random() * 4,
            color: Math.random() < 0.5 ? TH.brick : TH.mortar, kind: 'square', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12
        });
    }
}
function sparks(tx, ty, n, colors) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 140;
        particles.push({
            x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0,
            life: 0, max: 0.35 + Math.random() * 0.3, size: 2 + Math.random() * 3, color: colors[i % colors.length], kind: 'star'
        });
    }
}
function poof(tx, ty, color) {
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        particles.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, g: 0, life: 0, max: 0.45, size: 7, color, kind: 'puff' });
    }
}
function confetti(color) {
    const colors = [color, '#ffd23f', '#ff5d73', '#3ddc84', '#4cc9f0', '#ffffff'];
    for (let i = 0; i < 110; i++) {
        particles.push({
            x: Math.random() * WPX, y: -10 - Math.random() * 140, vx: (Math.random() - 0.5) * 60, vy: 60 + Math.random() * 90, g: 40,
            life: 0, max: 3.5 + Math.random(), size: 5 + Math.random() * 4, color: colors[i % colors.length], kind: 'confetti',
            rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10
        });
    }
}

// =========================================================
//  Canvas
// =========================================================
function resizeBoard(gw, gh) {
    GW = gw; GH = gh; WPX = TILE * GW; HPX = TILE * GH;
    canvas.width = WPX * dpr; canvas.height = HPX * dpr;
    gridCanvas.width = WPX * dpr; gridCanvas.height = HPX * dpr;
    fitCanvas();
}
function fitCanvas() {
    const narrow = window.innerWidth <= 900;
    const availW = narrow ? window.innerWidth - 24 : window.innerWidth - 340;
    const availH = narrow ? window.innerHeight * (touchVisible() ? 0.56 : 0.72) : window.innerHeight - 80;
    const k = clamp(Math.min(availW / WPX, availH / HPX), 0.3, 1.25);
    canvas.style.width = Math.floor(WPX * k) + 'px';
    canvas.style.height = Math.floor(HPX * k) + 'px';
}
window.addEventListener('resize', fitCanvas);
resizeBoard(15, 13);

function buildGrid() {
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gctx.clearRect(0, 0, WPX, HPX);
    drawMap(gctx, TH, S.grid);
}

// Onde a bomba do meu fantasma cairia (mesma regra do servidor) — para mostrar a mira
function ghostLandingLocal(gx, gy) {
    let v = null;
    if (gy === 0 && gx > 0 && gx < GW - 1) v = [0, 1];
    else if (gy === GH - 1 && gx > 0 && gx < GW - 1) v = [0, -1];
    else if (gx === 0 && gy > 0 && gy < GH - 1) v = [1, 0];
    else if (gx === GW - 1 && gy > 0 && gy < GH - 1) v = [-1, 0];
    if (!v) return null;
    for (let i = 1; i <= 4; i++) {
        const x = gx + v[0] * i, y = gy + v[1] * i;
        if (x <= 0 || y <= 0 || x >= GW - 1 || y >= GH - 1) return null;
        if (S.grid[y][x] === 0 && !S.bombs.some((b) => b.x === x && b.y === y)) return [x, y];
    }
    return null;
}

function updateAnim(dt, t) {
    for (const p of Object.values(S.players)) {
        const r = rp[p.pid];
        if (!r) continue;
        const isMe = p.pid === myPid;
        if (p.alive) {
            const tx = isMe && pred.mode === 'body' ? pred.x : p.x;
            const ty = isMe && pred.mode === 'body' ? pred.y : p.y;
            const dx = tx - r.x, dy = ty - r.y, d = Math.hypot(dx, dy);
            if (d > 3.5) { r.x = tx; r.y = ty; }
            else if (d > 0.001) {
                const speed = r.dash ? 30 : (1000 / p.mi) * 1.15;
                const step = Math.min(d, speed * dt);
                r.x += dx / d * step; r.y += dy / d * step;
                r.lastMove = t; r.phase += dt * 15;
                if (r.dash) r.trail.push({ x: r.x, y: r.y, t });
            } else { r.x = tx; r.y = ty; r.dash = false; }
        }
        if (p.ghost) {
            const tx = isMe && pred.mode === 'ghost' ? pred.x : p.ghost.x;
            const ty = isMe && pred.mode === 'ghost' ? pred.y : p.ghost.y;
            const dx = tx - r.gx, dy = ty - r.gy, d = Math.hypot(dx, dy);
            if (d > 14) { r.gx = tx; r.gy = ty; }
            else if (d > 0.001) { const step = Math.min(d, 9 * dt); r.gx += dx / d * step; r.gy += dy / d * step; }
        }
        r.trail = r.trail.filter((q) => t - q.t < 220);
    }

    const alive = new Set();
    for (const b of S.bombs) {
        alive.add(b.id);
        let r = rb[b.id];
        if (!r) {
            const lb = b.owner === myPid && localBombs.find((l) => l.x === b.x && l.y === b.y);
            r = rb[b.id] = { x: b.x, y: b.y, born: lb ? lb.born : t };
        }
        const dx = b.x - r.x, dy = b.y - r.y, d = Math.hypot(dx, dy);
        if (d > 0.001) { const step = Math.min(d, 17 * dt); r.x += dx / d * step; r.y += dy / d * step; }
    }
    for (const id of Object.keys(rb)) if (!alive.has(Number(id))) delete rb[id];

    for (const p of particles) {
        p.life += dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.vr) p.rot += p.vr * dt;
        if (p.kind === 'puff') { p.vx *= 0.9; p.vy *= 0.9; }
    }
    particles = particles.filter((p) => p.life < p.max);
    floaters = floaters.filter((f) => t - f.born < 1100);
    deaths = deaths.filter((d) => t - d.born < 900);
    throws = throws.filter((th) => t - th.born < 400);
    bubbles = bubbles.filter((b) => t - b.born < 2200);
    shake = Math.max(0, shake - dt * 40);
}

function drawNameTag(p, cx, top, isMe, t) {
    ctx.font = '600 11px Fredoka, sans-serif';
    const label = p.bot ? '🤖 ' + p.name : p.name;
    const tw = ctx.measureText(label).width;
    let bg = 'rgba(20,18,45,0.75)';
    if (isMe) bg = p.color;
    else if (S.settings.mode === 'teams' && p.team) bg = TEAM_COLORS[p.team];
    ctx.fillStyle = bg;
    rr(ctx, cx - tw / 2 - 6, top - 8, tw + 12, 16, 8); ctx.fill();
    ctx.fillStyle = isMe || (S.settings.mode === 'teams' && p.team) ? '#111' : '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, top + 0.5);
    if (isMe) {
        const ay = top - 14 + Math.sin(t / 180) * 2.5;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.moveTo(cx - 5, ay - 4); ctx.lineTo(cx + 5, ay - 4); ctx.lineTo(cx, ay + 2); ctx.closePath(); ctx.fill();
    }
}

function drawPlayer(p, r, t) {
    const isMe = p.pid === myPid;
    const cx = r.x * TILE + TILE / 2, cy = r.y * TILE + TILE / 2;
    const walking = t - r.lastMove < 140;
    const team = S.settings.mode === 'teams' ? p.team : null;
    for (const q of r.trail) {
        const a = 1 - (t - q.t) / 220;
        if (a > 0) drawCharacter(ctx, q.x * TILE + TILE / 2, q.y * TILE + TILE / 2, p.color, p.dir, { t, alpha: a * 0.35, seed: r.seed, hat: p.hat });
    }
    const dir = isMe && pred.mode === 'body' ? pred.dir : p.dir;
    drawCharacter(ctx, cx, cy, p.color, dir, { walk: walking, phase: r.phase, t, seed: r.seed, hat: p.hat, team, cursed: !!p.curse, alpha: p.conn ? 1 : 0.5 });
    if (p.shield) {
        ctx.fillStyle = 'rgba(120,220,255,0.18)'; ellipse(ctx, cx, cy - 1, 22, 22);
        ctx.strokeStyle = `rgba(160,240,255,${0.7 + Math.sin(t / 90) * 0.3})`; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx, cy - 1, 22, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx, cy - 1, 17, t / 300, t / 300 + 0.9); ctx.stroke();
    }
    if (p.curse && CURSE_INFO[p.curse.t]) emoji(ctx, CURSE_INFO[p.curse.t].icon, cx + 15, cy - 20, 13);
    if (!p.conn) emoji(ctx, '📶', cx - 15, cy - 20, 12);
    drawNameTag(p, cx, cy - 42, isMe, t);
}

function drawGhosts(t) {
    for (const p of Object.values(S.players)) {
        if (!p.ghost) continue;
        const r = rp[p.pid];
        if (!r) continue;
        const isMe = p.pid === myPid;
        const cx = r.gx * TILE + TILE / 2, cy = r.gy * TILE + TILE / 2;
        const ready = p.ghost.cd - (t - stateTime) <= 0;
        if (isMe && ready && pred.mode === 'ghost') {
            const land = ghostLandingLocal(pred.x, pred.y);
            if (land) {
                const a = 0.5 + Math.sin(t / 120) * 0.25;
                ctx.strokeStyle = `rgba(217,204,255,${a})`; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
                rr(ctx, land[0] * TILE + 4, land[1] * TILE + 4, TILE - 8, TILE - 8, 8); ctx.stroke();
                ctx.setLineDash([]);
            }
        }
        drawGhost(ctx, cx, cy, p.color, t, { ready, seed: r.seed, alpha: isMe ? 0.95 : 0.8 });
        if (isMe && !ready) { // anel de recarga do fantasma
            const k = 1 - clamp((p.ghost.cd - (t - stateTime)) / cfg.ghostCooldown, 0, 1);
            ctx.strokeStyle = '#d9ccff'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(cx, cy + 1, 18, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke();
        }
        ctx.font = '600 10px Fredoka, sans-serif';
        textOutlined(ctx, p.name, cx, cy - 22, '600 10px Fredoka, sans-serif', '#fff', 'rgba(20,18,45,0.9)', 3);
    }
}

function drawDeaths(t) {
    for (const d of deaths) {
        const k = (t - d.born) / 500;
        if (k > 1) continue;
        drawCharacter(ctx, d.x * TILE + TILE / 2, d.y * TILE + TILE / 2 - k * 8, d.color, 'down',
            { t, deadEyes: true, scale: 1 - k * 0.6, rot: k * Math.PI * 3, alpha: 1 - k * 0.6, seed: d.seed, hat: d.hat });
    }
}

function drawThrows(t) {
    for (const th of throws) {
        const k = clamp((t - th.born) / 380, 0, 1);
        const x = (th.from[0] + (th.to[0] - th.from[0]) * k) * TILE + TILE / 2;
        const y = (th.from[1] + (th.to[1] - th.from[1]) * k) * TILE + TILE / 2 - Math.sin(k * Math.PI) * 40;
        drawBomb(ctx, x, y, { t, ghost: true, pop: 0.8, fuse: 2200, total: 2200 });
    }
}

function drawParticles() {
    for (const p of particles) {
        const k = p.life / p.max;
        ctx.save();
        ctx.globalAlpha = p.kind === 'confetti' ? Math.min(1, (1 - k) * 3) : 1 - k;
        ctx.fillStyle = p.color;
        if (p.kind === 'square' || p.kind === 'confetti') {
            ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.kind === 'confetti' ? p.size / 2 : p.size);
        } else if (p.kind === 'star') star(ctx, p.x, p.y, p.size * (1 - k * 0.5), 4, 0.4);
        else ellipse(ctx, p.x, p.y, p.size * (0.6 + k), p.size * (0.6 + k));
        ctx.restore();
    }
}

function drawFloaters(t) {
    for (const f of floaters) {
        const k = (t - f.born) / 1100;
        ctx.save();
        ctx.globalAlpha = 1 - k;
        textOutlined(ctx, f.text, f.x, f.y - k * 32, '700 14px Fredoka, sans-serif', f.color, 'rgba(20,18,45,0.9)', 4);
        ctx.restore();
    }
}

function drawBubbles(t) {
    for (const b of bubbles) {
        const p = S.players[b.pid], r = rp[b.pid];
        if (!p || !r) continue;
        const ghost = !p.alive && p.ghost;
        if (!p.alive && !ghost) continue;
        const x = (ghost ? r.gx : r.x) * TILE + TILE / 2;
        const y = (ghost ? r.gy : r.y) * TILE + TILE / 2 - (ghost ? 40 : 62);
        const age = t - b.born;
        const s = age < 200 ? easeOutBack(age / 200) : 1;
        const a = age > 1800 ? 1 - (age - 1800) / 400 : 1;
        ctx.save();
        ctx.globalAlpha = a; ctx.translate(x, y); ctx.scale(s, s);
        ctx.fillStyle = '#fff';
        rr(ctx, -20, -16, 40, 30, 12); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-5, 13); ctx.lineTo(5, 13); ctx.lineTo(0, 20); ctx.closePath(); ctx.fill();
        const em = EMOTES[b.n] || '?';
        if (em === 'GG') textOutlined(ctx, 'GG', 0, -1, '700 17px Fredoka, sans-serif', '#ff8a3d', '#fff', 1);
        else { ctx.fillStyle = '#000'; emoji(ctx, em, 0, 0, 20); }
        ctx.restore();
    }
}

function pill(text, y, bg) {
    ctx.font = '600 15px Fredoka, sans-serif';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = bg;
    rr(ctx, WPX / 2 - tw / 2 - 16, y - 15, tw + 32, 30, 15); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, WPX / 2, y + 1);
}

function drawOverlay(t) {
    const me = myPlayer();
    const el = t - stateTime;
    if (S.phase === 'lobby') {
        const hs = Object.values(S.players).filter((p) => !p.bot && p.conn);
        pill(`Lobby · treino livre · ${hs.filter((p) => p.ready).length}/${hs.length} prontos`, 24, 'rgba(20,18,45,0.75)');
    } else if (S.phase === 'countdown') {
        const left = S.phaseLeft - el;
        const n = Math.max(1, Math.ceil(left / 1000));
        if (n !== lastCount) { lastCount = n; Sound.tick(); }
        const frac = (left % 1000) / 1000;
        const s = 1 + (frac > 0.75 ? (frac - 0.75) * 2 : 0);
        ctx.save();
        ctx.fillStyle = 'rgba(20,18,45,0.35)'; ctx.fillRect(0, 0, WPX, HPX);
        ctx.translate(WPX / 2, HPX / 2); ctx.scale(s, s);
        textOutlined(ctx, String(n), 0, 0, '700 110px Fredoka, sans-serif', '#ffd23f', '#1d1b3a', 12);
        ctx.restore();
        pill(`Rodada ${S.round} · ${S.map.name}`, HPX / 2 + 90, 'rgba(20,18,45,0.85)');
    } else if (S.phase === 'playing') {
        if (S.hurry) pill('⚠️ HURRY UP!', 24, Math.floor(t / 300) % 2 ? 'rgba(255,93,115,0.95)' : 'rgba(180,30,60,0.95)');
        else if (S.hurryIn != null) {
            const sec = Math.ceil(Math.max(0, S.hurryIn - el) / 1000);
            const txt = `⏱ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
            pill(sec <= 10 ? `Hurry Up em ${txt}` : txt, 24, sec <= 10 ? 'rgba(255,93,115,0.9)' : 'rgba(20,18,45,0.7)');
        }
        if (me && me.ghost) {
            const left = Math.max(0, me.ghost.cd - el);
            const key = touchVisible() ? '💣' : 'ESPAÇO';
            // fica no lado oposto ao fantasma para não cobri-lo
            const y = pred.y > GH / 2 ? 64 : HPX - 64;
            pill(left > 0 ? `👻 Fantasma · bomba em ${(left / 1000).toFixed(1)}s` : `👻 Fantasma · ${key} arremessa bomba!`, y,
                left > 0 ? 'rgba(20,18,45,0.8)' : 'rgba(110,70,200,0.9)');
        } else if (me && me.spec) pill('Você entra na próxima rodada', HPX - 24, 'rgba(20,18,45,0.85)');
    } else if (S.phase === 'matchEnd') {
        pill(`Voltando ao lobby em ${Math.ceil(Math.max(0, S.phaseLeft - el) / 1000)}s`, HPX - 24, 'rgba(20,18,45,0.85)');
    }

    if (banner) {
        const age = t - banner.born;
        if (age > banner.dur) banner = null;
        else {
            const inK = clamp(age / 350, 0, 1), outK = clamp((banner.dur - age) / 300, 0, 1);
            const s = easeOutBack(inK) * (0.9 + 0.1 * outK);
            ctx.save();
            ctx.globalAlpha = outK;
            if (banner.big) { ctx.fillStyle = 'rgba(20,18,45,0.55)'; ctx.fillRect(0, HPX / 2 - 70, WPX, 140); }
            ctx.translate(WPX / 2, HPX / 2 - 8); ctx.scale(s, s);
            ctx.rotate(Math.sin(t / 300) * 0.03);
            const size = clamp(Math.floor(WPX / Math.max(6, banner.text.length * 0.62)), 26, banner.big ? 46 : 64);
            textOutlined(ctx, banner.text, 0, 0, `700 ${size}px Fredoka, sans-serif`, banner.color, '#1d1b3a', 10);
            if (banner.sub) textOutlined(ctx, banner.sub, 0, banner.big ? 42 : 48, '600 19px Fredoka, sans-serif', '#fff', '#1d1b3a', 6);
            ctx.restore();
        }
    }
}

function render(t) {
    const el = t - stateTime;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = TH.bg; ctx.fillRect(0, 0, WPX, HPX);
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);
    ctx.drawImage(gridCanvas, 0, 0, WPX, HPX);

    // aviso das próximas casas do Hurry Up
    if (S.hurryNext && S.hurryNext.length) {
        const a = 0.35 + Math.sin(t / 80) * 0.2;
        for (const [x, y] of S.hurryNext) {
            ctx.fillStyle = `rgba(255,60,80,${a})`;
            rr(ctx, x * TILE + 3, y * TILE + 3, TILE - 6, TILE - 6, 6); ctx.fill();
            textOutlined(ctx, '!', x * TILE + TILE / 2, y * TILE + TILE / 2 + 1, '700 18px Fredoka, sans-serif', '#fff', 'rgba(0,0,0,0.3)', 2);
        }
    }

    for (const u of S.powerups) drawPowerup(ctx, u, t);

    for (const lb of localBombs) {
        if (S.bombs.some((b) => b.x === lb.x && b.y === lb.y)) continue;
        drawBomb(ctx, lb.x * TILE + TILE / 2, lb.y * TILE + TILE / 2, { t, pop: easeOutBack(clamp((t - lb.born) / 220, 0, 1)), alpha: 0.75 });
    }
    for (const b of S.bombs) {
        const r = rb[b.id];
        if (!r) continue;
        if (throws.some((th) => th.id === b.id)) continue; // ainda voando
        const total = b.ghost ? 2200 : 2500;
        drawBomb(ctx, r.x * TILE + TILE / 2, r.y * TILE + TILE / 2, {
            t, fuse: b.fuse - el, total, remote: b.remote, pierce: b.pierce, ghost: b.ghost,
            pop: t - r.born < 220 ? easeOutBack((t - r.born) / 220) : 1
        });
    }

    const list = Object.values(S.players).filter((p) => p.alive && rp[p.pid]).sort((a, b) => rp[a.pid].y - rp[b.pid].y);
    for (const p of list) drawPlayer(p, rp[p.pid], t);
    drawDeaths(t);
    drawFlames(ctx, S.flames, t, el, cfg ? cfg.flameTime : 600);
    drawGhosts(t);
    drawThrows(t);
    drawParticles();
    drawFloaters(t);
    drawBubbles(t);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverlay(t);
}

function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    pollGamepad();
    if (!S || $('game').classList.contains('hidden')) return;
    inputStep(t);
    updateAnim(dt, t);
    render(t);
    updateLiveUI(t);
}

// =========================================================
//  Interface lateral (atualiza só o que mudou)
// =========================================================
const setText = (el, txt) => { if (el.textContent !== txt) el.textContent = txt; };
function makeEl(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

function buildLobbyControls() {
    const vl = $('voteList');
    vl.innerHTML = '';
    const opts = [{ id: 'random', name: '🎲 Aleatório', sub: 'muda a cada rodada' }]
        .concat(cfg.layouts.map((l) => ({ id: l.id, name: l.name, sub: `${l.w}×${l.h} · ${l.min}-${l.max} jog.` })));
    for (const o of opts) {
        const b = makeEl('button', 'vote');
        b.dataset.id = o.id;
        b.append(makeEl('span', 'count', ''), document.createTextNode(o.name), makeEl('small', null, o.sub));
        b.onclick = () => socket && socket.emit('vote', o.id);
        vl.appendChild(b);
    }
    const tr = $('targetRow');
    tr.innerHTML = '';
    tr.appendChild(makeEl('span', 'muted', 'Vitórias p/ campeão:'));
    for (const n of cfg.targets) {
        const b = makeEl('button', 'chip', String(n));
        b.dataset.target = n;
        b.onclick = () => socket && socket.emit('settings', { target: n });
        tr.appendChild(b);
    }
    document.querySelectorAll('#modeRow .chip').forEach((b) => { b.onclick = () => socket && socket.emit('settings', { mode: b.dataset.mode }); });
}

function toggleReady() {
    const me = myPlayer();
    if (socket && me) socket.emit('ready', !me.ready);
}

const playerRows = new Map();
function updatePlayerList() {
    const ul = $('playerList');
    const players = Object.values(S.players);
    const top = Math.max(0, ...players.map((p) => p.wins));
    const order = players.slice().sort((a, b) => b.wins - a.wins || (a.team || '').localeCompare(b.team || ''));
    for (const [pid, row] of playerRows) if (!S.players[pid]) { row.li.remove(); playerRows.delete(pid); }
    order.forEach((p, i) => {
        let row = playerRows.get(p.pid);
        if (!row) {
            const li = makeEl('li');
            row = { li, dot: makeEl('span', 'dot'), nm: makeEl('span', 'nm'), sk: makeEl('span', 'sk'), w: makeEl('span'), sig: '' };
            li.append(row.dot, row.nm, row.sk, row.w);
            playerRows.set(p.pid, row);
        }
        const status = S.phase === 'lobby' ? (p.bot ? '🤖' : p.ready ? '✅' : '⏳') : (p.alive ? '' : p.ghost ? '👻' : '💤');
        const nameTxt = `${status} ${p.name}${p.pid === myPid ? ' (você)' : ''}${p.pid === S.host ? ' ⭐' : ''}${p.conn ? '' : ' 📶'}`.trim();
        const sig = [p.color, nameTxt, p.skill, p.wins, p.alive, p.team, S.settings.mode, top].join('|');
        if (sig !== row.sig) {
            row.sig = sig;
            row.dot.style.background = p.color;
            row.dot.style.outline = S.settings.mode === 'teams' && p.team ? `2px solid ${TEAM_COLORS[p.team]}` : 'none';
            setText(row.nm, nameTxt);
            setText(row.sk, (SKILL_INFO[p.skill] || {}).icon || '');
            row.sk.title = (SKILL_INFO[p.skill] || {}).name || '';
            setText(row.w, (top > 0 && p.wins === top ? '👑 ' : '🏆 ') + p.wins);
            row.li.classList.toggle('dead', !p.alive && S.phase !== 'lobby');
        }
        if (ul.children[i] !== row.li) ul.insertBefore(row.li, ul.children[i] || null);
    });
}

let lastScoreSig = '';
function updateScore() {
    const show = S.phase !== 'lobby';
    $('scoreCard').classList.toggle('hidden', !show);
    if (!show) return;
    const target = S.settings.target;
    const sig = JSON.stringify([S.round, target, S.settings.mode, S.teamWins, Object.values(S.players).map((p) => [p.pid, p.name, p.wins, p.color])]);
    if (sig === lastScoreSig) return;
    lastScoreSig = sig;
    setText($('scoreTitle'), `Placar · rodada ${S.round} · primeiro a ${target}`);
    const box = $('scoreRows');
    box.innerHTML = '';
    const pips = (n) => '●'.repeat(Math.min(n, target)) + '○'.repeat(Math.max(0, target - n));
    if (S.settings.mode === 'teams') {
        for (const team of ['red', 'blue']) {
            const row = makeEl('div', 'score');
            const dot = makeEl('span', 'dot'); dot.style.cssText = `width:14px;height:14px;border-radius:50%;background:${TEAM_COLORS[team]}`;
            row.append(dot, makeEl('span', 'nm', team === 'red' ? 'Time Vermelho' : 'Time Azul'), makeEl('span', 'pips', pips(S.teamWins[team])));
            box.appendChild(row);
        }
    } else {
        for (const p of Object.values(S.players).sort((a, b) => b.wins - a.wins)) {
            const row = makeEl('div', 'score');
            const dot = makeEl('span'); dot.style.cssText = `width:14px;height:14px;border-radius:50%;background:${p.color}`;
            row.append(dot, makeEl('span', 'nm', p.name + (p.pid === myPid ? ' (você)' : '')), makeEl('span', 'pips', pips(p.wins)));
            box.appendChild(row);
        }
    }
}

function updateLobby() {
    const lobby = S.phase === 'lobby';
    $('lobbyCard').classList.toggle('hidden', !lobby);
    if (!lobby) return;
    const me = myPlayer();
    const isHost = S.host === myPid;
    const players = Object.values(S.players);
    const humans = players.filter((p) => !p.bot && p.conn);
    const ready = humans.filter((p) => p.ready).length;
    const readyEl = $('readyBtn');
    setText(readyEl, me && me.ready ? 'CANCELAR PRONTO' : 'ESTOU PRONTO!');
    readyEl.className = 'btn ' + (me && me.ready ? 'gray' : 'green');
    let status;
    if (players.length < 2) status = 'Precisa de pelo menos 2 jogadores. Chame amigos (botão 🔗 Link) ou adicione bots.';
    else if (ready < humans.length) status = `${ready}/${humans.length} prontos. A partida começa quando todos estiverem prontos.`;
    else status = 'Começando...';
    setText($('lobbyStatus'), status);

    const tally = {};
    players.filter((p) => !p.bot).forEach((p) => { tally[p.vote] = (tally[p.vote] || 0) + 1; });
    document.querySelectorAll('#voteList .vote').forEach((b) => {
        b.classList.toggle('on', !!me && me.vote === b.dataset.id);
        setText(b.querySelector('.count'), tally[b.dataset.id] ? String(tally[b.dataset.id]) : '');
    });
    const host = S.players[S.host];
    setText($('hostHint'), isHost ? '(você é o anfitrião)' : host ? `(quem muda: ${host.name})` : '');
    document.querySelectorAll('#modeRow .chip').forEach((b) => { b.classList.toggle('on', S.settings.mode === b.dataset.mode); b.disabled = !isHost; });
    document.querySelectorAll('#targetRow .chip').forEach((b) => { b.classList.toggle('on', S.settings.target === Number(b.dataset.target)); b.disabled = !isHost; });
    const bots = players.filter((p) => p.bot).length;
    setText($('botCount'), String(bots));
    $('botMinus').disabled = !isHost || bots === 0;
    $('botPlus').disabled = !isHost || players.length >= (cfg ? cfg.limit : 8);
    $('teamBtn').classList.toggle('hidden', S.settings.mode !== 'teams');
}

function updateUI() {
    updateLobby();
    updateScore();
    updatePlayerList();
    const me = myPlayer();
    setText($('mapLbl'), `· ${S.map.name} ${S.map.w}×${S.map.h}`);
    if (!me) return;
    const info = SKILL_INFO[me.skill] || { icon: '❔', name: '-', desc: '' };
    setText($('skillIcon'), info.icon);
    setText($('skillName'), info.name);
    setText($('skillDesc'), info.desc);
    setText($('statBombs'), String(me.bombs));
    setText($('statRange'), String(me.range));
    setText($('statSpeed'), String(me.speed));
    $('tDet').classList.toggle('hidden', !me.remote);
}

let lastBadgeSig = '';
function updateLiveUI(t) {
    const me = myPlayer();
    if (!me || !cfg) return;
    const el = t - stateTime;
    const left = Math.max(0, me.cd - el);
    const fill = $('cdFill');
    fill.style.width = (100 * (1 - left / cfg.skillCooldown)) + '%';
    fill.style.background = left > 0 ? '#7a74b8' : '#3ddc84';
    setText($('cdText'), left > 0 ? `Recarregando... ${(left / 1000).toFixed(1)}s` : `Pronta! Aperte ${touchVisible() ? '⚡' : 'E'}`);

    const badges = [];
    if (me.pierce) badges.push(['🗡️ Perfurante', '']);
    if (me.remote) badges.push([`📡 Remoto (${touchVisible() ? 'botão 📡' : 'tecla R'})`, '']);
    if (me.curse && CURSE_INFO[me.curse.t]) {
        const c = CURSE_INFO[me.curse.t];
        badges.push([`${c.icon} ${c.label} ${Math.ceil(Math.max(0, me.curse.left - el) / 1000)}s`, 'curse']);
    }
    const sig = JSON.stringify(badges);
    if (sig !== lastBadgeSig) {
        lastBadgeSig = sig;
        const box = $('badges');
        box.innerHTML = '';
        for (const [txt, cls] of badges) box.appendChild(makeEl('span', 'badge ' + cls, txt));
    }
}

// ---------- configurações ----------
function refreshSettings() {
    setText($('optSound'), prefs.sound ? 'Ligado' : 'Desligado');
    setText($('optShake'), prefs.shake ? 'Ligado' : 'Desligado');
    setText($('optTouch'), { auto: 'Automático', on: 'Sempre', off: 'Nunca' }[prefs.touch]);
}
function setupSettings() {
    $('settingsBtn').onclick = () => { refreshSettings(); $('settingsModal').classList.remove('hidden'); };
    $('closeSettings').onclick = () => $('settingsModal').classList.add('hidden');
    $('settingsModal').onclick = (e) => { if (e.target.id === 'settingsModal') $('settingsModal').classList.add('hidden'); };
    $('optSound').onclick = () => { prefs.sound = !prefs.sound; store.set('bm_sound', prefs.sound ? '1' : '0'); Sound.setEnabled(prefs.sound); refreshSettings(); };
    $('optShake').onclick = () => { prefs.shake = !prefs.shake; store.set('bm_shake', prefs.shake ? '1' : '0'); refreshSettings(); };
    $('optTouch').onclick = () => {
        prefs.touch = { auto: 'on', on: 'off', off: 'auto' }[prefs.touch];
        store.set('bm_touch', prefs.touch);
        refreshSettings(); updateTouchVisibility(); fitCanvas();
    };
    $('copyBtn').onclick = async () => {
        const base = (serverUrl || location.origin).replace(/\/$/, '');
        const link = `${base}/?sala=${roomCode}`;
        try { await navigator.clipboard.writeText(link); showToast('Link copiado! Mande para os amigos'); }
        catch (e) { window.prompt('Copie o link da sala:', link); }
    };
    $('leaveBtn').onclick = leaveRoom;
    $('readyBtn').onclick = toggleReady;
    $('botPlus').onclick = () => socket && socket.emit('bot', 1);
    $('botMinus').onclick = () => socket && socket.emit('bot', -1);
    $('teamBtn').onclick = () => socket && socket.emit('team');
}

// =========================================================
//  Início: espera a fonte carregar antes de desenhar texto no canvas
// =========================================================
setupHome();
setupTouch();
setupSettings();
const fontsReady = Promise.race([
    document.fonts && document.fonts.load ? document.fonts.load('600 16px Fredoka').then(() => document.fonts.ready) : Promise.resolve(),
    new Promise((r) => setTimeout(r, 2500))
]);
fontsReady.catch(() => {}).then(() => {
    startPreview();
    requestAnimationFrame(frame);
});
