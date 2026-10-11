const C = require('./constants');
const { EMPTY, WALL, BLOCK, DIRS } = C;
const { layoutById, chooseLayout, buildMap, spiralOrder } = require('./maps');
const { botThink } = require('./bots');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
};
const key = (x, y) => `${x},${y}`;

function weightedPowerup() {
    const entries = Object.entries(C.POWERUP_WEIGHTS);
    let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [type, w] of entries) { if ((r -= w) < 0) return type; }
    return 'BOMB';
}

function cleanName(name, fallback) {
    return String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) || fallback;
}

let pidCounter = 1;

/*
 * Uma sala = uma partida independente, identificada por um código de 4 letras.
 * Fases: lobby (treino livre + pronto) → countdown (3-2-1) → playing → roundEnd → ... → matchEnd → lobby
 */
class Room {
    constructor(code) {
        this.code = code;
        this.createdAt = Date.now();
        this.players = {};               // pid → jogador
        this.hostPid = null;
        this.phase = 'lobby';
        this.phaseUntil = 0;
        this.settings = { mode: 'ffa', target: 3 };
        this.teamWins = { red: 0, blue: 0 };
        this.round = 0;
        this.matchMap = 'random';
        this.lastLayoutId = null;
        this.winner = null;
        this.champion = null;
        this.events = [];
        this.dirty = true;
        this.gridDirty = true;
        this.lastSent = 0;
        this.nextBombId = 1;
        this.onRemoved = null;           // callback do server.js (limpa a sessão)
        this.newMap(null);
    }

    // ================= utilidades =================
    list() { return Object.values(this.players); }
    humans() { return this.list().filter((p) => !p.bot); }
    connectedHumans() { return this.humans().filter((p) => p.connected); }
    inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    onBorder(x, y) { return this.inside(x, y) && (x === 0 || y === 0 || x === this.w - 1 || y === this.h - 1); }
    bombAt(x, y) { return this.bombs.find((b) => b.x === x && b.y === y); }
    flameAt(x, y) { return this.flames.find((f) => f.x === x && f.y === y); }
    powerupAt(x, y) { return this.powerups.find((u) => u.x === x && u.y === y); }
    walkable(x, y) { return this.inside(x, y) && this.grid[y][x] === EMPTY && !this.bombAt(x, y); }
    playerAt(x, y, except) { return this.list().find((p) => p.alive && p !== except && p.x === x && p.y === y); }
    canAct() { return this.phase === 'lobby' || this.phase === 'playing'; }
    ev(e) { this.events.push(e); this.dirty = true; }
    isTeams() { return this.settings.mode === 'teams'; }
    enemies(p) { return this.list().filter((o) => o !== p && o.alive && !(this.isTeams() && o.team && o.team === p.team)); }

    // Casas que uma bomba atingiria (usado pelos bots e para prever perigo)
    blastTiles(b) {
        const out = [[b.x, b.y]];
        for (const [dx, dy] of Object.values(DIRS)) {
            for (let i = 1; i <= b.range; i++) {
                const x = b.x + dx * i, y = b.y + dy * i;
                if (!this.inside(x, y) || this.grid[y][x] === WALL) break;
                out.push([x, y]);
                if (this.grid[y][x] === BLOCK && !b.pierce) break;
                const other = this.bombAt(x, y);
                if (other && other !== b) break;
            }
        }
        return out;
    }

    hurryNext(n) {
        return this.hurryOrder.length ? this.hurryOrder.slice(this.hurryIdx, this.hurryIdx + n) : [];
    }

    // ================= mapa =================
    newMap(layoutId) {
        const count = Math.max(1, this.list().length);
        const layout = (layoutId && layoutId !== 'random' && layoutById(layoutId)) || chooseLayout(count, this.lastLayoutId);
        this.lastLayoutId = layout.id;
        const m = buildMap(layout, count);
        this.layout = m.layout; this.w = m.w; this.h = m.h; this.grid = m.grid; this.spawns = m.spawns; this.theme = m.theme;
        this.bombs = []; this.flames = []; this.powerups = [];
        this.hurryAt = 0; this.hurryOrder = []; this.hurryIdx = 0; this.hurryNextAt = 0;
        this.gridDirty = true; this.dirty = true;
    }

    // Lugar seguro para (re)nascer: um spawn livre, fora da linha de bombas
    safeSpawn() {
        const inBlast = (x, y) => this.bombs.some((b) =>
            (b.x === x && Math.abs(b.y - y) <= b.range) || (b.y === y && Math.abs(b.x - x) <= b.range));
        const ok = ([x, y]) => this.grid[y][x] === EMPTY && !this.bombAt(x, y) && !this.flameAt(x, y) && !this.playerAt(x, y) && !inBlast(x, y);
        const free = this.spawns.filter(ok);
        if (free.length) return pick(free);
        const any = [];
        for (let y = 1; y < this.h - 1; y++) for (let x = 1; x < this.w - 1; x++) if (ok([x, y])) any.push([x, y]);
        return any.length ? pick(any) : this.spawns[0];
    }

    nearestBorder(x, y) {
        const opts = [
            { x, y: 0, d: y }, { x, y: this.h - 1, d: this.h - 1 - y },
            { x: 0, y, d: x }, { x: this.w - 1, y, d: this.w - 1 - x }
        ];
        const best = opts.sort((a, b) => a.d - b.d)[0];
        return { x: best.x, y: best.y };
    }

    // ================= jogadores =================
    freeColor(pref, except) {
        const used = new Set(this.list().filter((p) => p !== except).map((p) => p.color));
        if (C.COLORS.includes(pref) && !used.has(pref)) return pref;
        return C.COLORS.find((c) => !used.has(c)) || C.COLORS[0];
    }

    smallerTeam(except) {
        const others = this.list().filter((p) => p !== except);
        const red = others.filter((p) => p.team === 'red').length;
        const blue = others.filter((p) => p.team === 'blue').length;
        return red === blue ? pick(['red', 'blue']) : red < blue ? 'red' : 'blue';
    }

    resetStats(p) {
        Object.assign(p, {
            maxBombs: 1, range: 2, speedLv: 0, pierce: false, remote: false,
            skill: pick(C.SKILLS), cdUntil: 0, shieldUntil: 0, curse: null,
            tokens: 2, lastRefill: Date.now(), ghost: null, revived: false, respawnAt: 0,
            dir: 'down', autoBombAt: 0
        });
    }

    spawn(p, [x, y]) {
        p.x = x; p.y = y; p.alive = true; p.spectator = false; p.ghost = null; p.respawnAt = 0;
    }

    addPlayer({ token, name, color, hat, bot }) {
        const pid = 'p' + (pidCounter++);
        const p = {
            pid, token: token || null, bot: !!bot,
            name: cleanName(name, bot ? 'Bot' : 'Jogador'),
            hat: C.HATS.includes(hat) ? hat : 'sprout',
            connected: true, discAt: 0, socketId: null,
            ready: !!bot, vote: 'random', wins: 0, ack: 0, emoteAt: 0,
            team: null, x: 1, y: 1, alive: false, spectator: false
        };
        p.color = this.freeColor(color);
        this.resetStats(p);
        this.players[pid] = p;
        if (!bot && (!this.hostPid || !this.players[this.hostPid])) this.hostPid = pid;
        if (this.isTeams()) p.team = this.smallerTeam(p);
        if (this.phase === 'lobby') this.spawn(p, this.safeSpawn());
        else { p.spectator = true; p.alive = false; } // entra na próxima rodada
        this.dirty = true;
        return p;
    }

    removePlayer(pid) {
        const p = this.players[pid];
        if (!p) return;
        delete this.players[pid];
        if (this.hostPid === pid) {
            const h = this.connectedHumans()[0] || this.humans()[0];
            this.hostPid = h ? h.pid : null;
        }
        if (this.onRemoved) this.onRemoved(p);
        this.dirty = true;
        this.checkRoundEnd();
        this.checkStart();
    }

    isDead(now) {
        return this.humans().length === 0 && now - this.createdAt > 15000;
    }

    // ================= lobby =================
    setReady(p, v) {
        if (this.phase !== 'lobby' || p.bot) return;
        p.ready = v;
        this.dirty = true;
        this.checkStart();
    }

    setVote(p, id) {
        if (this.phase !== 'lobby') return;
        if (id !== 'random' && !layoutById(id)) return;
        p.vote = id;
        this.dirty = true;
    }

    updateSettings(p, s) {
        if (p.pid !== this.hostPid || this.phase !== 'lobby' || !s || typeof s !== 'object') return;
        if (s.mode === 'ffa' || s.mode === 'teams') {
            this.settings.mode = s.mode;
            if (s.mode === 'teams') shuffle(this.list()).forEach((o, i) => { o.team = i % 2 ? 'blue' : 'red'; });
            else this.list().forEach((o) => { o.team = null; });
        }
        if (C.TARGETS.includes(s.target)) this.settings.target = s.target;
        this.dirty = true;
    }

    changeBots(p, delta) {
        if (p.pid !== this.hostPid || this.phase !== 'lobby') return;
        if (delta > 0 && this.list().length < C.PLAYERS_LIMIT) {
            const used = new Set(this.list().map((o) => o.name));
            const name = C.BOT_NAMES.find((n) => !used.has(n)) || 'Bot';
            this.addPlayer({ name, bot: true, color: null, hat: pick(C.HATS.filter((h) => h !== 'none')) });
        } else if (delta < 0) {
            const bots = this.list().filter((o) => o.bot);
            if (bots.length) this.removePlayer(bots[bots.length - 1].pid);
        }
        this.checkStart();
    }

    switchTeam(p) {
        if (this.phase !== 'lobby' || !this.isTeams()) return;
        p.team = p.team === 'red' ? 'blue' : 'red';
        this.dirty = true;
    }

    checkStart() {
        if (this.phase !== 'lobby') return;
        const hs = this.connectedHumans();
        if (!hs.length || this.list().length < 2) return;
        if (hs.every((p) => p.ready)) this.startMatch();
    }

    startMatch() {
        this.list().forEach((p) => { p.wins = 0; p.spectator = false; });
        this.teamWins = { red: 0, blue: 0 };
        this.round = 0;
        this.champion = null;

        // Votação de mapa: o mais votado vence (empate = sorteio)
        const tally = {};
        this.humans().forEach((p) => { tally[p.vote] = (tally[p.vote] || 0) + 1; });
        const max = Math.max(0, ...Object.values(tally));
        const tops = Object.keys(tally).filter((k) => tally[k] === max);
        this.matchMap = tops.length ? pick(tops) : 'random';

        // Times equilibrados
        if (this.isTeams()) {
            this.list().forEach((p) => { if (!p.team) p.team = this.smallerTeam(p); });
            let red = this.list().filter((p) => p.team === 'red'), blue = this.list().filter((p) => p.team === 'blue');
            while (Math.abs(red.length - blue.length) > 1) {
                const [from, to] = red.length > blue.length ? [red, 'blue'] : [blue, 'red'];
                const moved = from.splice(Math.floor(Math.random() * from.length), 1)[0];
                moved.team = to;
                (to === 'red' ? red : blue).push(moved);
            }
        }
        this.ev({ e: 'match', map: this.matchMap });
        this.startRound();
    }

    startRound() {
        this.round++;
        this.newMap(this.matchMap);
        const order = shuffle([...this.spawns]); // cada rodada, cada um nasce num lugar diferente
        this.list().forEach((p, i) => { this.resetStats(p); this.spawn(p, order[i % order.length]); });
        this.winner = null;
        this.phase = 'countdown';
        this.phaseUntil = Date.now() + C.COUNTDOWN_MS;
        this.ev({ e: 'round', n: this.round, map: this.layout.name });
    }

    backToLobby() {
        this.phase = 'lobby';
        this.phaseUntil = 0;
        this.matchMap = 'random';
        this.humans().forEach((p) => { p.ready = false; });
        this.newMap(null);
        this.list().forEach((p) => { this.resetStats(p); p.alive = false; });
        this.list().forEach((p) => this.spawn(p, this.safeSpawn()));
        this.ev({ e: 'lobby' });
    }

    checkRoundEnd() {
        if (this.phase !== 'playing') return;
        const alive = this.list().filter((p) => !p.spectator && p.alive);
        if (this.isTeams()) {
            const teams = new Set(alive.map((p) => p.team));
            if (teams.size > 1) return;
            this.endRound(teams.size ? { team: [...teams][0] } : null);
        } else {
            if (alive.length > 1) return;
            this.endRound(alive[0] ? { pid: alive[0].pid } : null);
        }
    }

    endRound(w) {
        const now = Date.now();
        let champion = null;
        if (w && w.pid) {
            const p = this.players[w.pid];
            p.wins++;
            Object.assign(w, { name: p.name, color: p.color });
            if (p.wins >= this.settings.target) champion = { pid: p.pid, name: p.name, color: p.color };
        } else if (w && w.team) {
            this.teamWins[w.team]++;
            Object.assign(w, { name: w.team === 'red' ? 'Time Vermelho' : 'Time Azul', color: C.TEAM_COLORS[w.team] });
            if (this.teamWins[w.team] >= this.settings.target) champion = { team: w.team, name: w.name, color: w.color };
        }
        this.winner = w;
        if (champion) {
            this.champion = champion;
            this.phase = 'matchEnd';
            this.phaseUntil = now + C.MATCH_END_MS;
            this.ev({ e: 'matchEnd', champion });
        } else {
            this.phase = 'roundEnd';
            this.phaseUntil = now + C.ROUND_END_MS;
            this.ev({ e: 'roundEnd', winner: w });
        }
    }

    // ================= ações dos jogadores =================
    moveInterval(p) {
        if (!p.alive) return C.GHOST_MOVE;
        if (p.curse && p.curse.t === 'slow') return 240;
        if (p.curse && p.curse.t === 'fast') return 70;
        return C.BASE_MOVE - C.SPEED_STEP * p.speedLv;
    }

    // "Balde de fichas": tolera a oscilação da internet sem permitir speed-hack
    takeToken(p) {
        const now = Date.now();
        p.tokens = Math.min(2, p.tokens + (now - p.lastRefill) / this.moveInterval(p));
        p.lastRefill = now;
        if (p.tokens < 1) return false;
        p.tokens -= 1;
        return true;
    }

    move(p, d, seq, faceOnly) {
        if (Number.isInteger(seq) && seq > p.ack) p.ack = seq;
        this.dirty = true;
        const v = DIRS[d];
        if (!v) return;
        if (p.alive) {
            p.dir = d;
            if (faceOnly || !this.canAct()) return;
            if (!this.takeToken(p)) return;
            const nx = p.x + v[0], ny = p.y + v[1];
            if (!this.walkable(nx, ny)) return;
            p.x = nx; p.y = ny;
            this.enterTile(p);
            this.checkRoundEnd();
        } else if (p.ghost && this.phase === 'playing') {
            if (faceOnly || !this.takeToken(p)) return;
            const nx = p.ghost.x + v[0], ny = p.ghost.y + v[1];
            if (!this.onBorder(nx, ny)) return;
            p.ghost.x = nx; p.ghost.y = ny;
        }
    }

    enterTile(p) {
        const u = this.powerupAt(p.x, p.y);
        if (u) {
            this.powerups = this.powerups.filter((o) => o !== u);
            this.applyPowerup(p, u.type);
            this.ev({ e: 'pickup', pid: p.pid, type: u.type, x: u.x, y: u.y, curse: u.type === 'SKULL' && p.curse ? p.curse.t : undefined });
        }
        // A maldição passa para quem encostar
        const other = this.playerAt(p.x, p.y, p);
        if (other) {
            if (p.curse && !other.curse) { other.curse = { ...p.curse }; this.ev({ e: 'curse', pid: other.pid, t: other.curse.t }); }
            else if (other.curse && !p.curse) { p.curse = { ...other.curse }; this.ev({ e: 'curse', pid: p.pid, t: p.curse.t }); }
        }
        if (p.curse && p.curse.t === 'diarrhea') this.placeBomb(p, true);
        const f = this.flameAt(p.x, p.y);
        if (f && this.flameHurts(f, p)) this.kill(p, f.owner);
    }

    applyPowerup(p, type) {
        switch (type) {
            case 'BOMB': p.maxBombs = Math.min(C.MAX_BOMBS, p.maxBombs + 1); break;
            case 'RANGE': p.range = Math.min(C.MAX_RANGE, p.range + 1); break;
            case 'SPEED': p.speedLv = Math.min(C.MAX_SPEED, p.speedLv + 1); break;
            case 'SKILL': p.skill = pick(C.SKILLS.filter((s) => s !== p.skill)); p.cdUntil = 0; break;
            case 'PIERCE': p.pierce = true; break;
            case 'REMOTE': p.remote = true; break;
            case 'SKULL': p.curse = { t: pick(C.CURSES), until: Date.now() + C.CURSE_MS }; break;
        }
    }

    placeBomb(p, auto = false) {
        if (!this.canAct()) return;
        if (!p.alive) {
            if (!auto && p.ghost && this.phase === 'playing') this.ghostThrow(p);
            return;
        }
        if (p.curse && p.curse.t === 'nobomb') return;
        const now = Date.now();
        if (auto && now < p.autoBombAt) return;
        const mine = this.bombs.filter((b) => b.owner === p.pid && !b.ghost).length;
        if (mine >= p.maxBombs || this.bombAt(p.x, p.y)) return;
        const b = {
            id: this.nextBombId++, x: p.x, y: p.y, owner: p.pid, team: p.team,
            range: p.curse && p.curse.t === 'short' ? 1 : p.range,
            pierce: p.pierce, remote: p.remote, ghost: false,
            explodeAt: now + (p.remote ? C.REMOTE_FALLBACK : C.BOMB_TIMER), slide: null
        };
        if (auto) p.autoBombAt = now + 500;
        this.bombs.push(b);
        this.ev({ e: 'bomb', id: b.id, x: b.x, y: b.y, pid: p.pid });
    }

    // Onde cairia a bomba arremessada pelo fantasma (null nos cantos ou sem espaço)
    ghostLanding(p) {
        const g = p.ghost;
        if (!g) return null;
        let v = null;
        if (g.y === 0 && g.x > 0 && g.x < this.w - 1) v = [0, 1];
        else if (g.y === this.h - 1 && g.x > 0 && g.x < this.w - 1) v = [0, -1];
        else if (g.x === 0 && g.y > 0 && g.y < this.h - 1) v = [1, 0];
        else if (g.x === this.w - 1 && g.y > 0 && g.y < this.h - 1) v = [-1, 0];
        if (!v) return null;
        for (let i = 1; i <= 4; i++) {
            const x = g.x + v[0] * i, y = g.y + v[1] * i;
            if (!this.inside(x, y) || this.onBorder(x, y)) return null;
            if (this.grid[y][x] === EMPTY && !this.bombAt(x, y) && !this.flameAt(x, y)) return [x, y];
        }
        return null;
    }

    ghostThrow(p) {
        const now = Date.now();
        if (now < p.ghost.cdUntil) return;
        const land = this.ghostLanding(p);
        if (!land) return;
        const [x, y] = land;
        const b = {
            id: this.nextBombId++, x, y, owner: p.pid, team: p.team, range: 2,
            pierce: false, remote: false, ghost: true, explodeAt: now + C.GHOST_FUSE, slide: null
        };
        this.bombs.push(b);
        p.ghost.cdUntil = now + C.GHOST_COOLDOWN;
        this.ev({ e: 'throw', pid: p.pid, id: b.id, from: [p.ghost.x, p.ghost.y], to: [x, y] });
    }

    detonate(p) {
        if (!p.alive || !p.remote || !this.canAct()) return;
        const list = this.bombs.filter((b) => b.owner === p.pid && b.remote);
        if (!list.length) return;
        this.ev({ e: 'detonate', pid: p.pid });
        this.explode(list);
    }

    useSkill(p) {
        if (!p.alive || !this.canAct()) return;
        const now = Date.now();
        if (now < p.cdUntil) return;
        const v = DIRS[p.dir] || DIRS.down;
        let used = false;

        if (p.skill === 'SHIELD') {
            p.shieldUntil = now + C.SHIELD_TIME;
            this.ev({ e: 'skill', pid: p.pid, skill: 'SHIELD' });
            used = true;
        } else if (p.skill === 'TELEPORT') {
            const danger = new Set(this.hurryNext(12).map(([x, y]) => key(x, y)));
            const free = [];
            for (let y = 1; y < this.h - 1; y++) for (let x = 1; x < this.w - 1; x++) {
                if (this.walkable(x, y) && !this.flameAt(x, y) && !this.playerAt(x, y) && !danger.has(key(x, y))) free.push([x, y]);
            }
            if (free.length) {
                const from = [p.x, p.y];
                [p.x, p.y] = pick(free);
                this.ev({ e: 'teleport', pid: p.pid, from, to: [p.x, p.y] });
                this.enterTile(p);
                used = true;
            }
        } else if (p.skill === 'DASH') {
            const path = [];
            let x = p.x, y = p.y;
            for (let i = 0; i < C.DASH_DIST && this.walkable(x + v[0], y + v[1]); i++) { x += v[0]; y += v[1]; path.push([x, y]); }
            if (path.length) {
                this.ev({ e: 'dash', pid: p.pid, from: [p.x, p.y], to: [x, y] });
                for (const [px, py] of path) { if (!p.alive) break; p.x = px; p.y = py; this.enterTile(p); }
                used = true;
            }
        } else if (p.skill === 'KICK') {
            const b = this.bombAt(p.x + v[0], p.y + v[1]);
            if (b && !b.slide) {
                b.slide = { dx: v[0], dy: v[1], next: now + C.KICK_STEP };
                this.ev({ e: 'skill', pid: p.pid, skill: 'KICK' });
                used = true;
            }
        }
        if (!used) return; // habilidade sem efeito não gasta recarga
        p.cdUntil = now + C.SKILL_COOLDOWN;
        this.dirty = true;
        this.checkRoundEnd();
    }

    emote(p, n) {
        const now = Date.now();
        if (!Number.isInteger(n) || n < 0 || n >= C.EMOTE_COUNT || now < p.emoteAt) return;
        p.emoteAt = now + C.EMOTE_COOLDOWN;
        this.ev({ e: 'emote', pid: p.pid, n });
    }

    // ================= explosões e mortes =================
    explode(initial) {
        const now = Date.now();
        const queue = [...initial];
        const hit = new Map();
        const destroyed = new Map();
        let center = null;

        while (queue.length) {
            const b = queue.shift();
            if (!this.bombs.includes(b)) continue; // já explodiu
            this.bombs = this.bombs.filter((o) => o !== b);
            if (!center) center = [b.x, b.y];
            const mark = (x, y) => { const k = key(x, y); if (!hit.has(k)) hit.set(k, { x, y, owner: b.owner, team: b.team }); };
            mark(b.x, b.y);
            for (const [dx, dy] of Object.values(DIRS)) {
                for (let i = 1; i <= b.range; i++) {
                    const x = b.x + dx * i, y = b.y + dy * i;
                    if (!this.inside(x, y) || this.grid[y][x] === WALL) break;
                    mark(x, y);
                    if (this.grid[y][x] === BLOCK) {
                        destroyed.set(key(x, y), [x, y]);
                        if (!b.pierce) break; // bomba perfurante atravessa as caixas
                        continue;
                    }
                    const other = this.bombAt(x, y);
                    if (other) { queue.push(other); break; } // reação em cadeia
                }
            }
        }
        if (!hit.size) return;

        const burned = this.powerups.filter((u) => hit.has(key(u.x, u.y)));
        if (burned.length) {
            this.powerups = this.powerups.filter((u) => !hit.has(key(u.x, u.y)));
            this.ev({ e: 'burn', tiles: burned.map((u) => [u.x, u.y]) });
        }
        if (destroyed.size) {
            for (const [x, y] of destroyed.values()) {
                this.grid[y][x] = EMPTY;
                if (Math.random() < C.POWERUP_CHANCE) this.powerups.push({ x, y, type: weightedPowerup() });
            }
            this.gridDirty = true;
            this.ev({ e: 'blocks', tiles: [...destroyed.values()] });
        }
        const until = now + C.FLAME_TIME;
        for (const f of hit.values()) {
            const ex = this.flameAt(f.x, f.y);
            if (ex) Object.assign(ex, { until, owner: f.owner, team: f.team });
            else this.flames.push({ ...f, until });
        }
        this.ev({ e: 'boom', x: center[0], y: center[1], tiles: [...hit.values()].map((f) => [f.x, f.y]) });
        this.burnPlayers();
        this.checkRoundEnd();
    }

    flameHurts(f, p) {
        if (Date.now() < p.shieldUntil) return false;
        // Times: a bomba do colega não te machuca (a sua própria sim)
        if (this.isTeams() && f.team && f.team === p.team && f.owner !== p.pid) return false;
        return true;
    }

    burnPlayers() {
        for (const p of this.list()) {
            if (!p.alive) continue;
            const f = this.flameAt(p.x, p.y);
            if (f && this.flameHurts(f, p)) this.kill(p, f.owner);
        }
    }

    kill(p, by, force = false) {
        if (!p.alive) return;
        const now = Date.now();
        if (!force && now < p.shieldUntil) return;
        p.alive = false;
        this.ev({ e: 'death', pid: p.pid, x: p.x, y: p.y, by: by || null });
        if (this.phase === 'playing') {
            p.ghost = { ...this.nearestBorder(p.x, p.y), cdUntil: now + C.GHOST_FIRST_DELAY };
            // Vingança: se a bomba de um fantasma eliminar alguém, ele volta à vida (uma vez por rodada)
            const killer = by && this.players[by];
            if (killer && killer !== p && !killer.alive && killer.ghost && !killer.revived) this.revive(killer);
        } else if (this.phase === 'lobby') {
            p.respawnAt = now + C.RESPAWN_MS;
        }
    }

    revive(p) {
        const spot = this.safeSpawn();
        this.resetStats(p);
        p.revived = true;
        this.spawn(p, spot);
        this.ev({ e: 'revive', pid: p.pid, x: p.x, y: p.y });
    }

    // ================= Hurry Up =================
    tickHurry(now) {
        if (this.phase !== 'playing' || !this.hurryAt || now < this.hurryAt) return;
        if (!this.hurryOrder.length) {
            this.hurryOrder = spiralOrder(this.grid, this.w, this.h);
            this.hurryIdx = 0;
            this.hurryPerTick = Math.max(1, Math.round(this.hurryOrder.length / 160)); // fecha tudo em ~25s
            this.hurryNextAt = now + 1500; // dá um tempinho para ver o aviso
            this.ev({ e: 'hurry' });
            return;
        }
        if (now < this.hurryNextAt || this.hurryIdx >= this.hurryOrder.length) return;
        this.hurryNextAt = now + C.HURRY_TICK;
        const dropped = [];
        for (let i = 0; i < this.hurryPerTick && this.hurryIdx < this.hurryOrder.length; i++) {
            const [x, y] = this.hurryOrder[this.hurryIdx++];
            if (this.grid[y][x] === WALL) continue;
            this.grid[y][x] = WALL;
            dropped.push([x, y]);
            this.powerups = this.powerups.filter((u) => u.x !== x || u.y !== y);
            this.bombs = this.bombs.filter((b) => b.x !== x || b.y !== y);
            this.flames = this.flames.filter((f) => f.x !== x || f.y !== y);
            for (const p of this.list()) if (p.alive && p.x === x && p.y === y) this.kill(p, null, true);
        }
        if (dropped.length) { this.gridDirty = true; this.ev({ e: 'walls', tiles: dropped }); }
        this.checkRoundEnd();
    }

    // ================= laço principal =================
    tick(now) {
        // Quem caiu e não voltou a tempo sai da sala
        for (const p of this.humans()) {
            const grace = this.phase === 'lobby' ? C.LOBBY_GRACE : C.RECONNECT_GRACE;
            if (!p.connected && now - p.discAt > grace) this.removePlayer(p.pid);
        }

        if (this.phase === 'countdown' && now >= this.phaseUntil) {
            this.phase = 'playing';
            this.phaseUntil = 0;
            this.hurryAt = now + this.layout.hurry * 1000;
            this.ev({ e: 'go' });
        } else if (this.phase === 'roundEnd' && now >= this.phaseUntil) {
            this.startRound();
        } else if (this.phase === 'matchEnd' && now >= this.phaseUntil) {
            this.backToLobby();
        }

        // Bombas: deslizar (chute) e explodir
        const due = new Set();
        for (const b of this.bombs) {
            if (b.slide && now >= b.slide.next) {
                const nx = b.x + b.slide.dx, ny = b.y + b.slide.dy;
                if (!this.walkable(nx, ny) || this.playerAt(nx, ny)) b.slide = null;
                else {
                    b.x = nx; b.y = ny;
                    b.slide.next = now + C.KICK_STEP;
                    this.dirty = true;
                    if (this.flameAt(nx, ny)) due.add(b);
                }
            }
            if (now >= b.explodeAt) due.add(b);
        }
        if (due.size) this.explode([...due]);

        // Fogo: some no tempo certo e mata quem estiver dentro
        const before = this.flames.length;
        this.flames = this.flames.filter((f) => f.until > now);
        if (this.flames.length !== before) this.dirty = true;
        if (this.flames.length) this.burnPlayers();

        for (const p of this.list()) {
            if (p.shieldUntil && now >= p.shieldUntil) { p.shieldUntil = 0; this.dirty = true; }
            if (p.curse && now >= p.curse.until) { p.curse = null; this.dirty = true; }
            if (this.phase === 'lobby' && !p.alive && p.respawnAt && now >= p.respawnAt) {
                this.resetStats(p);
                this.spawn(p, this.safeSpawn());
                this.ev({ e: 'revive', pid: p.pid, x: p.x, y: p.y, quiet: true });
            }
        }

        this.tickHurry(now);
        for (const p of this.list()) if (p.bot) botThink(this, p, now);
        this.checkRoundEnd();
    }

    flush(io, now) {
        if (now - this.lastSent > 500) this.dirty = true; // batimento para manter todos sincronizados
        if (!this.dirty) return;
        io.to(this.code).emit('state', this.snapshot(this.gridDirty));
        this.gridDirty = false;
        this.dirty = false;
        this.events = [];
        this.lastSent = now;
    }

    snapshot(full) {
        const now = Date.now();
        const players = {};
        for (const p of this.list()) {
            players[p.pid] = {
                pid: p.pid, name: p.name, color: p.color, hat: p.hat, team: p.team, bot: p.bot,
                conn: p.connected, ready: p.ready, vote: p.vote,
                x: p.x, y: p.y, dir: p.dir, alive: p.alive, spec: p.spectator,
                ghost: p.ghost ? { x: p.ghost.x, y: p.ghost.y, cd: Math.max(0, p.ghost.cdUntil - now) } : null,
                skill: p.skill, cd: Math.max(0, p.cdUntil - now), shield: now < p.shieldUntil,
                bombs: p.maxBombs, range: p.range, speed: p.speedLv, pierce: p.pierce, remote: p.remote,
                curse: p.curse ? { t: p.curse.t, left: Math.max(0, p.curse.until - now) } : null,
                wins: p.wins, ack: p.ack, mi: this.moveInterval(p), revived: p.revived
            };
        }
        const hurrying = this.phase === 'playing' && this.hurryOrder.length > 0;
        const pk = {
            code: this.code, phase: this.phase,
            phaseLeft: this.phaseUntil ? Math.max(0, this.phaseUntil - now) : 0,
            host: this.hostPid, settings: this.settings, round: this.round, teamWins: this.teamWins,
            map: { id: this.layout.id, name: this.layout.name, w: this.w, h: this.h, theme: this.theme },
            matchMap: this.matchMap,
            players,
            bombs: this.bombs.map((b) => ({
                id: b.id, x: b.x, y: b.y, owner: b.owner, fuse: Math.max(0, b.explodeAt - now),
                remote: b.remote, pierce: b.pierce, ghost: b.ghost
            })),
            flames: this.flames.map((f) => ({ x: f.x, y: f.y, left: Math.max(0, f.until - now) })),
            powerups: this.powerups,
            hurryIn: this.phase === 'playing' && this.hurryAt && !hurrying ? Math.max(0, this.hurryAt - now) : null,
            hurry: hurrying,
            hurryNext: hurrying ? this.hurryNext(6) : [],
            winner: this.winner, champion: this.champion,
            ev: this.events
        };
        if (full) pk.grid = this.grid.map((r) => r.slice());
        return pk;
    }
}

module.exports = Room;
