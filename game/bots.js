// Inteligência dos bots: fugir do perigo, pegar power-ups, quebrar caixas e caçar inimigos.
const C = require('./constants');

const key = (x, y) => `${x},${y}`;
const DIR_LIST = Object.entries(C.DIRS);
const shuffledDirs = () => {
    const a = [...DIR_LIST];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
};

// Mapa de perigo: casa → ms até ser atingida (considera reação em cadeia, fogo e paredes do Hurry Up)
function dangerMap(room, extra) {
    const now = Date.now();
    const bombs = extra ? room.bombs.concat([extra]) : room.bombs;
    const time = new Map(bombs.map((b) => [b, b.remote ? 3000 : Math.max(0, b.explodeAt - now)]));
    const tiles = new Map(bombs.map((b) => [b, room.blastTiles(b)]));
    for (let pass = 0; pass < 2; pass++) {
        for (const b of bombs) for (const [x, y] of tiles.get(b)) {
            const o = bombs.find((c) => c !== b && c.x === x && c.y === y);
            if (o && time.get(o) > time.get(b)) time.set(o, time.get(b));
        }
    }
    const m = new Map();
    for (const b of bombs) for (const [x, y] of tiles.get(b)) {
        const k = key(x, y), t = time.get(b);
        if (!m.has(k) || m.get(k) > t) m.set(k, t);
    }
    for (const f of room.flames) m.set(key(f.x, f.y), 0);
    for (const [x, y] of room.hurryNext(10)) m.set(key(x, y), 0);
    return m;
}

// Busca em largura: devolve a primeira direção do caminho até a casa-objetivo
function bfs(sx, sy, passable, goal, maxD = 12) {
    const seen = new Set([key(sx, sy)]);
    let frontier = [[sx, sy, null]];
    for (let d = 1; d <= maxD && frontier.length; d++) {
        const next = [];
        for (const [x, y, first] of frontier) {
            for (const [name, [dx, dy]] of shuffledDirs()) {
                const nx = x + dx, ny = y + dy, k = key(nx, ny);
                if (seen.has(k) || !passable(nx, ny)) continue;
                seen.add(k);
                const f = first || name;
                if (goal(nx, ny, d)) return f;
                next.push([nx, ny, f]);
            }
        }
        frontier = next;
    }
    return null;
}

function botThink(room, p, now) {
    if (now < (p.botNext || 0)) return;
    p.botNext = now + 70 + Math.random() * 90; // tempo de reação
    if (!room.canAct()) return;
    if (!p.alive) {
        if (p.ghost && room.phase === 'playing') ghostThink(room, p, now);
        return;
    }

    const danger = dangerMap(room);
    const enemies = room.enemies(p);
    const passable = (x, y) => room.walkable(x, y) && !room.flameAt(x, y);
    const safe = (x, y) => passable(x, y) && !danger.has(key(x, y));

    // 1) Em perigo: fugir
    if (danger.has(key(p.x, p.y))) {
        const d = bfs(p.x, p.y, passable, (x, y) => !danger.has(key(x, y)), 10);
        if (d) return room.move(p, d);
        if (now >= p.cdUntil && (p.skill === 'SHIELD' || p.skill === 'TELEPORT')) return room.useSkill(p);
        if (now >= p.cdUntil && p.skill === 'DASH') {
            for (const [name, [dx, dy]] of shuffledDirs()) {
                let x = p.x, y = p.y;
                for (let i = 0; i < C.DASH_DIST && room.walkable(x + dx, y + dy); i++) { x += dx; y += dy; }
                if ((x !== p.x || y !== p.y) && !danger.has(key(x, y))) { p.dir = name; return room.useSkill(p); }
            }
        }
        return;
    }

    // 2) Detonador remoto: explode quando pega alguém (e não ele mesmo)
    if (p.remote) {
        const mine = room.bombs.filter((b) => b.owner === p.pid && b.remote);
        if (mine.length) {
            const hit = new Set(mine.flatMap((b) => room.blastTiles(b).map(([x, y]) => key(x, y))));
            if (!hit.has(key(p.x, p.y)) && (enemies.some((e) => hit.has(key(e.x, e.y))) || Math.random() < 0.04)) return room.detonate(p);
        }
    }

    // 3) Soltar bomba se valer a pena e houver rota de fuga
    const myBombs = room.bombs.filter((b) => b.owner === p.pid && !b.ghost).length;
    if (myBombs < p.maxBombs && !room.bombAt(p.x, p.y) && !(p.curse && p.curse.t === 'nobomb')) {
        const hyp = { x: p.x, y: p.y, range: p.range, pierce: p.pierce, remote: false, explodeAt: now + C.BOMB_TIMER };
        const tiles = room.blastTiles(hyp);
        const hitsBlock = tiles.some(([x, y]) => room.grid[y][x] === C.BLOCK);
        const hitsEnemy = tiles.some(([x, y]) => enemies.some((e) => e.x === x && e.y === y));
        const nearEnemy = enemies.some((e) => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) <= 2);
        if (hitsEnemy || nearEnemy || (hitsBlock && Math.random() < 0.6)) {
            const d2 = dangerMap(room, hyp);
            const escape = bfs(p.x, p.y, passable, (x, y) => !d2.has(key(x, y)), 7);
            if (escape) return room.placeBomb(p);
        }
    }

    // 4) Andar: power-up > inimigo > caixa > passeio
    let d = bfs(p.x, p.y, safe, (x, y) => { const u = room.powerupAt(x, y); return u && u.type !== 'SKULL'; }, 8);
    if (!d && enemies.length) d = bfs(p.x, p.y, safe, (x, y) => enemies.some((e) => Math.abs(e.x - x) + Math.abs(e.y - y) <= 1), 14);
    if (!d) d = bfs(p.x, p.y, safe, (x, y) => DIR_LIST.some(([, [dx, dy]]) => room.inside(x + dx, y + dy) && room.grid[y + dy][x + dx] === C.BLOCK), 14);
    if (!d) {
        const opts = DIR_LIST.filter(([, [dx, dy]]) => safe(p.x + dx, p.y + dy));
        if (opts.length && Math.random() < 0.3) d = opts[Math.floor(Math.random() * opts.length)][0];
    }
    if (d) room.move(p, d);
}

// Bot fantasma: anda pela borda até ficar alinhado com alguém e arremessa
function ghostThink(room, p, now) {
    const enemies = room.enemies(p);
    if (!enemies.length) return;
    const g = p.ghost;
    if (now >= g.cdUntil) {
        const land = room.ghostLanding(p);
        if (land && enemies.some((e) => (e.x === land[0] && Math.abs(e.y - land[1]) <= 2) || (e.y === land[1] && Math.abs(e.x - land[0]) <= 2))) {
            if (Math.random() < 0.7) return room.placeBomb(p);
        }
    }
    const t = enemies.reduce((a, e) => (Math.abs(e.x - g.x) + Math.abs(e.y - g.y) < Math.abs(a.x - g.x) + Math.abs(a.y - g.y) ? e : a));
    let d = null;
    if (g.y === 0 || g.y === room.h - 1) d = t.x > g.x ? 'right' : t.x < g.x ? 'left' : null;
    else d = t.y > g.y ? 'down' : t.y < g.y ? 'up' : null;
    if (!d && Math.random() < 0.2) d = shuffledDirs()[0][0];
    if (d && Math.random() < 0.85) room.move(p, d);
}

module.exports = { botThink, dangerMap };
