'use strict';
/* ==========================================================
 *  draw.js — cenários, personagens, bombas, fogo e sons.
 *  Só desenha; quem decide o que desenhar é o game.js.
 * ========================================================== */

const TILE = 40;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ecf0f1', '#ff6fb5', '#8d6e63'];
const TEAM_COLORS = { red: '#ff5d73', blue: '#4cc9f0' };
const HATS = [
    ['sprout', '🌱', 'Brotinho'], ['cap', '🧢', 'Boné'], ['bow', '🎀', 'Laço'], ['tophat', '🎩', 'Cartola'],
    ['horns', '😈', 'Chifres'], ['propeller', '🚁', 'Hélice'], ['none', '⭕', 'Nenhum']
];

const THEMES = {
    grass: { label: 'Grama',   bg: '#2b2a4f', floorA: '#64b553', floorB: '#5aa64a', tuft: 'rgba(0,60,0,0.25)',
             wallSide: '#3d4663', wallTop: '#5c6890', wallHi: '#8390bd', wallBase: '#2a3047', mortar: '#7a3e12', brick: '#d9823b', brickHi: '#f2a65e' },
    sand:  { label: 'Deserto', bg: '#3a2a1a', floorA: '#f0d48a', floorB: '#e6c776', tuft: 'rgba(140,100,30,0.35)',
             wallSide: '#7a4f26', wallTop: '#b07842', wallHi: '#dba46c', wallBase: '#56361a', mortar: '#9c6b2f', brick: '#e8b25c', brickHi: '#f7d38f' },
    snow:  { label: 'Neve',    bg: '#22314a', floorA: '#eef6fb', floorB: '#dcecf6', tuft: 'rgba(120,160,200,0.4)',
             wallSide: '#4a6c8c', wallTop: '#7aa3c7', wallHi: '#b9dcf5', wallBase: '#2f4a63', mortar: '#8a3b2b', brick: '#d9694c', brickHi: '#f39a7c' },
    night: { label: 'Noite',   bg: '#15172e', floorA: '#3a3f6b', floorB: '#33385f', tuft: 'rgba(160,170,255,0.2)',
             wallSide: '#1c1f3a', wallTop: '#2c3060', wallHi: '#4a50a0', wallBase: '#121429', mortar: '#3b2a5a', brick: '#7b5cc4', brickHi: '#a98af0' }
};

const SKILL_INFO = {
    DASH:     { icon: '💨', name: 'Dash',      desc: 'Avança até 3 casas na direção em que você olha.' },
    SHIELD:   { icon: '🛡️', name: 'Escudo',    desc: 'Bolha que te deixa imune a explosões por 3 s.' },
    KICK:     { icon: '🦶', name: 'Chute',     desc: 'Chuta a bomba à sua frente até ela bater em algo.' },
    TELEPORT: { icon: '✨', name: 'Teleporte', desc: 'Teleporta para um lugar livre aleatório.' }
};
const PU_INFO = {
    BOMB:   { icon: '💣', color: '#ff5d73', label: '+1 bomba' },
    RANGE:  { icon: '🔥', color: '#ff8a3d', label: '+1 alcance' },
    SPEED:  { icon: '👟', color: '#3ddc84', label: '+velocidade' },
    SKILL:  { icon: '🎁', color: '#9b5cf6', label: 'Nova habilidade!' },
    PIERCE: { icon: '🗡️', color: '#e63946', label: 'Bomba perfurante!' },
    REMOTE: { icon: '📡', color: '#4cc9f0', label: 'Detonador remoto!' },
    SKULL:  { icon: '💀', color: '#5a189a', label: 'Maldição!' }
};
const CURSE_INFO = {
    slow:     { icon: '🐢', label: 'Lerdeza' },
    fast:     { icon: '🌪️', label: 'Turbo descontrolado' },
    reverse:  { icon: '🔄', label: 'Controles invertidos' },
    diarrhea: { icon: '💩', label: 'Bombas sem parar' },
    nobomb:   { icon: '🚫', label: 'Sem bombas' },
    short:    { icon: '🕯️', label: 'Fogo curtinho' }
};
const EMOTES = ['😂', '😡', '👍', 'GG', '😱', '❤️'];

// ---------------- utilidades ----------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOutBack = (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const hashStr = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
}
function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}
function ellipse(g, x, y, rx, ry) {
    g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); g.fill();
}
function star(g, cx, cy, r, points = 5, inner = 0.45) {
    g.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const a = -Math.PI / 2 + i * Math.PI / points;
        const rad = i % 2 ? r * inner : r;
        g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    g.closePath(); g.fill();
}
function emoji(g, ch, x, y, size) {
    g.font = `${size}px ${EMOJI_FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, x, y);
}
function textOutlined(g, text, x, y, font, fill, stroke = '#1d1b3a', lw = 4) {
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = stroke;
    g.strokeText(text, x, y);
    g.fillStyle = fill; g.fillText(text, x, y);
}

// ---------------- cenário ----------------
function drawFloor(g, T, px, py, x, y, grid) {
    g.fillStyle = (x + y) % 2 ? T.floorB : T.floorA;
    g.fillRect(px, py, TILE, TILE);
    if ((x * 7 + y * 13) % 4 === 0) {
        g.strokeStyle = T.tuft; g.lineWidth = 2; g.lineCap = 'round';
        const gx = px + 10 + (x * 5 % 18), gy = py + 26 - (y * 3 % 10);
        g.beginPath();
        g.moveTo(gx, gy); g.lineTo(gx - 3, gy - 6);
        g.moveTo(gx + 3, gy); g.lineTo(gx + 3, gy - 7);
        g.moveTo(gx + 6, gy); g.lineTo(gx + 9, gy - 5);
        g.stroke();
    }
    if (y > 0 && grid[y - 1][x] !== 0) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(px, py, TILE, 8); }
}
function drawWall(g, T, px, py) {
    g.fillStyle = T.wallSide; g.fillRect(px, py, TILE, TILE);
    g.fillStyle = T.wallTop; rr(g, px + 2, py + 2, TILE - 4, TILE - 11, 6); g.fill();
    g.fillStyle = T.wallHi; rr(g, px + 6, py + 5, TILE - 16, 4, 2); g.fill();
    g.fillStyle = T.wallBase; g.fillRect(px, py + TILE - 5, TILE, 5);
}
function drawBrick(g, T, px, py) {
    g.fillStyle = T.mortar; rr(g, px + 1, py + 1, TILE - 2, TILE - 2, 5); g.fill();
    for (let r = 0; r < 3; r++) {
        const by = py + 3 + r * 11.5, off = r % 2 ? -9 : 0;
        for (let bx = px + 2 + off; bx < px + TILE - 2; bx += 18) {
            const x1 = Math.max(px + 3, bx), x2 = Math.min(px + TILE - 3, bx + 16);
            if (x2 - x1 < 3) continue;
            g.fillStyle = T.brick; rr(g, x1, by, x2 - x1, 9.5, 2); g.fill();
            g.fillStyle = T.brickHi; g.fillRect(x1 + 1, by + 1, x2 - x1 - 2, 2);
        }
    }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px + 1, py + TILE - 5, TILE - 2, 4);
}
function drawMap(g, T, grid) {
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
            const px = x * TILE, py = y * TILE, t = grid[y][x];
            if (t === 1) drawWall(g, T, px, py);
            else {
                drawFloor(g, T, px, py, x, y, grid);
                if (t === 2) drawBrick(g, T, px, py);
            }
        }
    }
}

// ---------------- chapéus ----------------
function drawHat(g, hat, t, seed, dir) {
    const [dx] = DIRS[dir] || [0, 1];
    switch (hat) {
        case 'sprout': {
            g.strokeStyle = '#2f9e44'; g.lineWidth = 2; g.lineCap = 'round';
            g.beginPath(); g.moveTo(0, -17); g.quadraticCurveTo(1, -21, 0, -23); g.stroke();
            g.fillStyle = '#51cf66';
            for (const s of [-1, 1]) {
                g.save(); g.translate(0, -23); g.rotate(s * 0.6 + Math.sin(t / 300 + seed + (s > 0 ? 1 : 0)) * 0.15);
                ellipse(g, s * 4, 0, 4.5, 2.4); g.restore();
            }
            break;
        }
        case 'cap': {
            g.fillStyle = '#2b2d42';
            g.beginPath(); g.ellipse(0, -13, 12, 8, 0, Math.PI, 0); g.fill();
            g.fillStyle = '#ef233c'; g.fillRect(-12, -14, 24, 3);
            if (dir !== 'up') { g.fillStyle = '#2b2d42'; ellipse(g, dx * 9, -12, dx ? 7 : 9, 2.6); }
            g.fillStyle = '#fff'; ellipse(g, 0, -20, 1.6, 1.6);
            break;
        }
        case 'bow': {
            g.save(); g.translate(7, -15); g.rotate(0.3);
            g.fillStyle = '#ff6fb5';
            g.beginPath(); g.moveTo(0, 0); g.lineTo(-8, -5); g.lineTo(-8, 5); g.closePath(); g.fill();
            g.beginPath(); g.moveTo(0, 0); g.lineTo(8, -5); g.lineTo(8, 5); g.closePath(); g.fill();
            g.fillStyle = '#ff2e93'; ellipse(g, 0, 0, 2.6, 2.6);
            g.restore();
            break;
        }
        case 'tophat': {
            g.fillStyle = '#1b1b2b'; ellipse(g, 0, -15, 12, 3.2);
            rr(g, -7, -31, 14, 16, 2); g.fill();
            g.fillStyle = '#e63946'; g.fillRect(-7, -19, 14, 3);
            g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(-5, -29, 3, 9);
            break;
        }
        case 'horns': {
            g.fillStyle = '#f1e3c6';
            for (const s of [-1, 1]) {
                g.beginPath();
                g.moveTo(s * 5, -14); g.quadraticCurveTo(s * 13, -18, s * 12, -27); g.quadraticCurveTo(s * 9, -19, s * 10, -13);
                g.closePath(); g.fill();
            }
            break;
        }
        case 'propeller': {
            g.fillStyle = '#ffd23f'; g.beginPath(); g.ellipse(0, -15, 9, 6, 0, Math.PI, 0); g.fill();
            g.fillStyle = '#3a86ff'; g.fillRect(-9, -16, 18, 2);
            g.strokeStyle = '#555'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -20); g.lineTo(0, -25); g.stroke();
            const w = Math.cos(t / 45 + seed) * 11;
            g.fillStyle = '#ff5d73'; ellipse(g, w / 2, -25, Math.abs(w / 2) + 0.5, 1.8);
            g.fillStyle = '#4cc9f0'; ellipse(g, -w / 2, -25, Math.abs(w / 2) + 0.5, 1.8);
            break;
        }
    }
}

// ---------------- personagem ----------------
// Bolinha colorida com pezinhos, olhos que seguem a direção e um chapéu escolhido no lobby
function drawCharacter(g, cx, cy, color, dir, o = {}) {
    const { walk = false, phase = 0, t = 0, alpha = 1, seed = 0, scale = 1, rot = 0, deadEyes = false, hat = 'sprout', team = null, cursed = false } = o;
    const bob = walk ? Math.abs(Math.sin(phase)) * 3 : Math.sin(t / 420 + seed) * 0.8;
    const squash = walk ? 1 + Math.sin(phase * 2) * 0.05 : 1 + Math.sin(t / 420 + seed) * 0.025;
    const [dx, dy] = DIRS[dir] || [0, 1];

    g.save();
    g.globalAlpha *= alpha;
    g.translate(cx, cy);
    g.scale(scale, scale);
    g.rotate(rot);

    if (team) { // anel do time
        g.strokeStyle = TEAM_COLORS[team]; g.lineWidth = 3;
        g.beginPath(); g.ellipse(0, 15, 15, 5, 0, 0, Math.PI * 2); g.stroke();
    }
    if (cursed) { // aura roxa da maldição
        g.fillStyle = `rgba(150,60,220,${0.25 + Math.sin(t / 90) * 0.12})`;
        ellipse(g, 0, -2, 22, 22);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)'; ellipse(g, 0, 15, 12 - bob, 4);

    const lf = walk ? Math.max(0, Math.sin(phase)) * 3 : 0, rf = walk ? Math.max(0, -Math.sin(phase)) * 3 : 0;
    g.fillStyle = shade(color, -70);
    ellipse(g, -6, 13 - lf, 5, 3.5);
    ellipse(g, 6, 13 - rf, 5, 3.5);

    g.translate(0, 3 - bob);
    g.scale(1 / squash, squash);

    if (hat === 'sprout' || hat === 'horns') drawHat(g, hat, t, seed, dir); // atrás do corpo

    const grd = g.createRadialGradient(-5, -9, 2, 0, -3, 18);
    grd.addColorStop(0, shade(color, 60));
    grd.addColorStop(0.55, color);
    grd.addColorStop(1, shade(color, -45));
    g.fillStyle = grd;
    g.strokeStyle = shade(color, -80); g.lineWidth = 2;
    g.beginPath(); g.ellipse(0, -3, 14.5, 15, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.22)'; ellipse(g, 0, 4, 8, 5.5);
    g.fillStyle = 'rgba(255,255,255,0.5)'; ellipse(g, -6, -11, 3.5, 2.2);

    const blink = !deadEyes && ((t + seed * 37) % 3400) < 110;
    const ex = dx * 3.5, ey = -5 + dy * 2.5;
    if (deadEyes) {
        g.strokeStyle = '#222'; g.lineWidth = 2;
        for (const s of [-5, 5]) {
            g.beginPath();
            g.moveTo(s - 2.5 + ex, ey - 2.5); g.lineTo(s + 2.5 + ex, ey + 2.5);
            g.moveTo(s + 2.5 + ex, ey - 2.5); g.lineTo(s - 2.5 + ex, ey + 2.5);
            g.stroke();
        }
    } else if (dir !== 'up') {
        for (const s of [-5, 5]) {
            if (blink) {
                g.strokeStyle = '#222'; g.lineWidth = 2;
                g.beginPath(); g.moveTo(s - 3 + ex, ey); g.lineTo(s + 3 + ex, ey); g.stroke();
            } else {
                g.fillStyle = '#fff'; ellipse(g, s + ex, ey, 3.8, 4.6);
                g.fillStyle = '#1d1b3a'; ellipse(g, s + ex + dx * 1.3, ey + dy * 1.3 + 0.5, 2.2, 2.6);
                g.fillStyle = '#fff'; ellipse(g, s + ex + dx * 1.3 - 0.8, ey + dy * 1.3 - 0.6, 0.8, 0.8);
            }
        }
        g.fillStyle = 'rgba(255,120,150,0.45)';
        if (dx <= 0) ellipse(g, -9 + ex * 0.5, ey + 5, 2.8, 1.8);
        if (dx >= 0) ellipse(g, 9 + ex * 0.5, ey + 5, 2.8, 1.8);
        if (dy >= 0) {
            g.strokeStyle = '#3b1d1d'; g.lineWidth = 1.5;
            g.beginPath(); g.arc(ex * 0.8, ey + 5, 2.5, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
        }
    }
    if (hat !== 'sprout' && hat !== 'horns') drawHat(g, hat, t, seed, dir);
    g.restore();
}

// Fantasma (jogador eliminado que anda pela borda)
function drawGhost(g, cx, cy, color, t, o = {}) {
    const { alpha = 0.85, ready = false, seed = 0 } = o;
    const fy = cy + Math.sin(t / 250 + seed) * 2.5;
    g.save();
    g.globalAlpha *= alpha;
    if (ready) { g.shadowColor = color; g.shadowBlur = 14; }
    g.fillStyle = '#f4f2ff';
    g.beginPath();
    g.arc(cx, fy - 2, 12, Math.PI, 0);
    g.lineTo(cx + 12, fy + 10);
    for (let i = 0; i < 4; i++) g.quadraticCurveTo(cx + 9 - i * 6, fy + (i % 2 ? 6 : 15), cx + 6 - i * 6, fy + 10);
    g.closePath(); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = color; g.lineWidth = 2.5; g.stroke();
    g.fillStyle = '#1d1b3a'; ellipse(g, cx - 4, fy - 3, 2.2, 2.8); ellipse(g, cx + 4, fy - 3, 2.2, 2.8);
    g.fillStyle = color; ellipse(g, cx, fy + 3, 2.5, 1.6);
    g.restore();
}

// ---------------- objetos ----------------
function drawPowerup(g, u, t) {
    const info = PU_INFO[u.type] || PU_INFO.BOMB;
    const cx = u.x * TILE + TILE / 2, bob = Math.sin(t / 250 + u.x) * 2.5, cy = u.y * TILE + TILE / 2 + bob;
    g.fillStyle = 'rgba(0,0,0,0.2)'; ellipse(g, cx, u.y * TILE + TILE / 2 + 15, 11 - bob / 2, 3);
    g.save();
    g.shadowColor = info.color; g.shadowBlur = 10 + Math.sin(t / 200) * 4;
    g.fillStyle = u.type === 'SKULL' && Math.floor(t / 250) % 2 ? '#7b2cbf' : info.color;
    rr(g, cx - 14, cy - 14, 28, 28, 8); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2; rr(g, cx - 14, cy - 14, 28, 28, 8); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.3)'; rr(g, cx - 11, cy - 11, 22, 7, 4); g.fill();
    g.fillStyle = '#000';
    emoji(g, info.icon, cx, cy + 1, 17);
}

function drawBomb(g, cx, cy, o) {
    const { t, fuse = 2500, total = 2500, pop = 1, remote = false, pierce = false, ghost = false, alpha = 1 } = o;
    const urgent = !remote && fuse < 800;
    const pulse = Math.sin(t / (urgent ? 45 : 130));
    const sx = (1 + pulse * 0.07) * pop, sy = (1 - pulse * 0.07) * pop;
    const flash = urgent && Math.floor(t / 90) % 2;
    const by = cy + 3;

    g.save();
    g.globalAlpha *= alpha;
    g.fillStyle = 'rgba(0,0,0,0.28)'; ellipse(g, cx, cy + 15, 13 * pop, 4 * pop);
    g.translate(cx, by); g.scale(sx, sy);
    if (pierce) { // espinhos da bomba perfurante
        g.fillStyle = '#ffd23f';
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4 + t / 600;
            g.beginPath();
            g.moveTo(Math.cos(a - 0.25) * 12, Math.sin(a - 0.25) * 12);
            g.lineTo(Math.cos(a) * 19, Math.sin(a) * 19);
            g.lineTo(Math.cos(a + 0.25) * 12, Math.sin(a + 0.25) * 12);
            g.closePath(); g.fill();
        }
    }
    const base = pierce ? ['#ff8a8a', '#7a0010'] : ghost ? ['#d9ccff', '#3a2470'] : ['#5b5b7a', '#15152a'];
    const grd = g.createRadialGradient(-4, -5, 2, 0, 0, 15);
    grd.addColorStop(0, flash ? '#ff9aa8' : base[0]);
    grd.addColorStop(1, flash ? '#b0001f' : base[1]);
    g.fillStyle = grd; ellipse(g, 0, 0, 14, 14);
    g.fillStyle = 'rgba(255,255,255,0.45)'; ellipse(g, -5, -6, 4.5, 3);
    g.fillStyle = '#2b2b40'; rr(g, -5, -17, 10, 6, 2); g.fill();

    let tip = null;
    if (remote) { // antena com luz piscando
        g.strokeStyle = '#ccc'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, -17); g.lineTo(0, -27); g.stroke();
        g.fillStyle = Math.floor(t / 300) % 2 ? '#ff3b3b' : '#3ddc84';
        ellipse(g, 0, -28, 3, 3);
    } else {
        const lf = clamp(fuse / total, 0.15, 1);
        const ex = 9 * lf, ey = -17 - 7 * lf;
        g.strokeStyle = '#d6b07a'; g.lineWidth = 2.5; g.lineCap = 'round';
        g.beginPath(); g.moveTo(0, -17); g.quadraticCurveTo(ex * 0.3, ey - 3, ex, ey); g.stroke();
        tip = [cx + ex * sx, by + ey * sy];
    }
    g.restore();
    if (tip) {
        g.save(); g.globalAlpha *= alpha;
        g.fillStyle = Math.random() < 0.5 ? '#ffd23f' : '#ff8a3d';
        star(g, tip[0], tip[1], 4 + Math.random() * 2.5, 4, 0.35);
        g.fillStyle = '#fff'; ellipse(g, tip[0], tip[1], 1.6, 1.6);
        g.restore();
    }
}

// Fogo em cruz. O tamanho segue o tempo REAL restante enviado pelo servidor,
// então a chama só some quando o servidor também apagou (sem "fogo invisível").
function drawFlames(g, flames, t, elapsed, flameTime) {
    if (!flames.length) return;
    const set = new Set(flames.map((f) => f.x + ',' + f.y));
    const layers = [['#ff4d1f', 0.62], ['#ffb703', 0.42], ['#fff6c8', 0.2]];
    for (const [color, wf] of layers) {
        g.fillStyle = color;
        for (const f of flames) {
            const left = f.left - elapsed;
            if (left <= 0) continue;
            const age = flameTime - left;
            const s = age < 80 ? 0.45 + 0.55 * age / 80 : left < 160 ? 0.45 + 0.55 * left / 160 : 1;
            const flick = 1 + Math.sin(t / 28 + f.x * 3 + f.y * 5) * 0.09;
            const w = TILE * wf * s * flick;
            const cx = f.x * TILE + TILE / 2, cy = f.y * TILE + TILE / 2;
            ellipse(g, cx, cy, w * 0.62, w * 0.62);
            if (set.has((f.x - 1) + ',' + f.y)) g.fillRect(cx - TILE / 2 - 1, cy - w / 2, TILE / 2 + 1, w);
            if (set.has((f.x + 1) + ',' + f.y)) g.fillRect(cx, cy - w / 2, TILE / 2 + 1, w);
            if (set.has(f.x + ',' + (f.y - 1))) g.fillRect(cx - w / 2, cy - TILE / 2 - 1, w, TILE / 2 + 1);
            if (set.has(f.x + ',' + (f.y + 1))) g.fillRect(cx - w / 2, cy, w, TILE / 2 + 1);
        }
    }
}

// ---------------- som (gerado na hora, sem arquivos) ----------------
const Sound = (() => {
    let ac = null, enabled = true;
    function audio() {
        if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ac = new A(); }
        if (ac.state === 'suspended') ac.resume();
        return ac;
    }
    function tone(f1, f2, dur, type = 'sine', vol = 0.15, delay = 0) {
        if (!enabled) return; const a = audio(); if (!a) return;
        const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f1, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(a.destination);
        o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol = 0.3, cutoff = 1500, delay = 0) {
        if (!enabled) return; const a = audio(); if (!a) return;
        const t = a.currentTime + delay, len = Math.floor(a.sampleRate * dur);
        const buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = a.createBufferSource(); src.buffer = buf;
        const f = a.createBiquadFilter(); f.type = 'lowpass';
        f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(80, t + dur);
        const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(f).connect(g).connect(a.destination);
        src.start(t);
    }
    return {
        unlock: () => audio(),
        setEnabled(v) { enabled = v; },
        place()     { tone(330, 140, 0.12, 'sine', 0.22); },
        boom(k = 1) { noise(0.55, 0.45 * k, 1800); tone(130, 40, 0.4, 'sine', 0.3 * k); },
        pickup()    { tone(660, 660, 0.07, 'square', 0.06); tone(990, 990, 0.12, 'square', 0.06, 0.07); },
        curse()     { tone(300, 120, 0.4, 'sawtooth', 0.07); tone(310, 110, 0.4, 'sawtooth', 0.05, 0.05); },
        death()     { tone(520, 70, 0.6, 'sawtooth', 0.09); },
        skill()     { noise(0.25, 0.12, 4000); tone(300, 900, 0.2, 'triangle', 0.08); },
        tick()      { tone(660, 660, 0.09, 'square', 0.05); },
        go()        { tone(880, 880, 0.3, 'square', 0.06); tone(1320, 1320, 0.25, 'square', 0.04, 0.05); },
        thud()      { tone(110, 45, 0.12, 'sine', 0.1); },
        alarm()     { [0, 0.3, 0.6].forEach((d) => tone(880, 440, 0.25, 'sawtooth', 0.06, d)); },
        throw()     { tone(200, 700, 0.25, 'triangle', 0.08); },
        revive()    { [523, 784, 1047].forEach((f, i) => tone(f, f, 0.15, 'triangle', 0.08, i * 0.08)); },
        emote()     { tone(900, 1200, 0.08, 'sine', 0.06); },
        win()       { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.2, 'square', 0.06, i * 0.12)); },
        fanfare()   { [523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'square', 0.06, i * 0.14)); }
    };
})();
