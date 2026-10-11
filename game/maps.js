const { EMPTY, WALL, BLOCK, DIRS } = require('./constants');

// Mapas: tamanho (sempre ímpar), faixa de jogadores, densidade de caixas,
// paredes extras de labirinto, praça central sem caixas e segundos até o "Hurry Up".
const LAYOUTS = [
    { id: 'classic', name: 'Clássico',      w: 15, h: 13, min: 1, max: 4, blocks: 0.55, maze: 0,    plaza: 0, hurry: 90 },
    { id: 'maze',    name: 'Labirinto',     w: 17, h: 15, min: 1, max: 6, blocks: 0.40, maze: 0.35, plaza: 0, hurry: 90 },
    { id: 'plaza',   name: 'Praça Central', w: 19, h: 15, min: 2, max: 8, blocks: 0.55, maze: 0,    plaza: 3, hurry: 95 },
    { id: 'wide',    name: 'Campo Largo',   w: 25, h: 13, min: 3, max: 8, blocks: 0.50, maze: 0.10, plaza: 0, hurry: 100 },
    { id: 'islands', name: 'Ilhas',         w: 21, h: 17, min: 4, max: 8, blocks: 0.45, maze: 0.20, plaza: 2, hurry: 100 },
    { id: 'giant',   name: 'Arena Gigante', w: 27, h: 19, min: 6, max: 8, blocks: 0.50, maze: 0.08, plaza: 0, hurry: 110 }
];
const THEMES = ['grass', 'sand', 'snow', 'night'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
};
const key = (x, y) => `${x},${y}`;

function layoutById(id) { return LAYOUTS.find((l) => l.id === id); }

function chooseLayout(count, avoidId) {
    const n = Math.max(1, count);
    let options = LAYOUTS.filter((l) => n >= l.min && n <= l.max);
    if (options.length > 1) options = options.filter((l) => l.id !== avoidId); // não repete o mesmo seguido
    return pick(options.length ? options : LAYOUTS);
}

// Todas as casas sem parede precisam estar ligadas (ninguém pode ficar isolado)
function isConnected(grid, w, h) {
    let start = null, total = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (grid[y][x] !== WALL) { total++; if (!start) start = [x, y]; }
    }
    const seen = new Set([key(...start)]);
    const stack = [start];
    while (stack.length) {
        const [x, y] = stack.pop();
        for (const [dx, dy] of Object.values(DIRS)) {
            const nx = x + dx, ny = y + dy, k = key(nx, ny);
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && grid[ny][nx] !== WALL && !seen.has(k)) { seen.add(k); stack.push([nx, ny]); }
        }
    }
    return seen.size === total;
}

// Spawns espalhados: cada novo ponto fica longe dos já escolhidos (com um pouco de sorteio)
function pickSpawns(grid, w, h, n) {
    const cand = [];
    for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
        if (grid[y][x] !== WALL) cand.push([x, y]);
    }
    shuffle(cand);
    const chosen = [cand[0]];
    while (chosen.length < n && chosen.length < cand.length) {
        const scored = cand
            .filter((c) => !chosen.includes(c))
            .map((c) => [c, Math.min(...chosen.map((s) => Math.abs(s[0] - c[0]) + Math.abs(s[1] - c[1])))])
            .sort((a, b) => b[1] - a[1]);
        chosen.push(pick(scored.slice(0, 3))[0]);
    }
    return chosen;
}

// Libera espaço em volta do spawn, com uma "curva" para dar pra fugir da primeira bomba
function clearAround(grid, w, h, sx, sy) {
    const free = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < h && grid[y][x] === BLOCK) grid[y][x] = EMPTY; };
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) <= 2) free(sx + dx, sy + dy);
    }
    for (const [dx, dy] of Object.values(DIRS)) {
        const ex = sx + dx * 2, ey = sy + dy * 2;
        if (dx) free(ex, ey + (Math.random() < 0.5 ? -1 : 1));
        else free(ex + (Math.random() < 0.5 ? -1 : 1), ey);
    }
}

function buildMap(layout, playerCount) {
    const w = layout.w, h = layout.h;
    const grid = [];
    for (let y = 0; y < h; y++) {
        const row = [];
        for (let x = 0; x < w; x++) {
            const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
            const pillar = x % 2 === 0 && y % 2 === 0;
            row.push(border || pillar ? WALL : EMPTY);
        }
        grid.push(row);
    }

    // Paredes extras (estilo labirinto), sem nunca isolar uma parte do mapa
    if (layout.maze > 0) {
        const cand = [];
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
            if (grid[y][x] === EMPTY && (x % 2) !== (y % 2)) cand.push([x, y]);
        }
        for (const [x, y] of shuffle(cand)) {
            if (Math.random() >= layout.maze) continue;
            grid[y][x] = WALL;
            if (!isConnected(grid, w, h)) grid[y][x] = EMPTY;
        }
    }

    // Caixas (a praça central fica livre)
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        if (grid[y][x] !== EMPTY) continue;
        if (layout.plaza && Math.abs(x - cx) <= layout.plaza && Math.abs(y - cy) <= layout.plaza) continue;
        if (Math.random() < layout.blocks) grid[y][x] = BLOCK;
    }

    const spawns = pickSpawns(grid, w, h, Math.max(1, playerCount));
    spawns.forEach(([sx, sy]) => clearAround(grid, w, h, sx, sy));
    return { layout, w, h, grid, spawns, theme: pick(THEMES) };
}

// Ordem em que as paredes do "Hurry Up" caem: espiral de fora para dentro
function spiralOrder(grid, w, h) {
    const order = [];
    let x0 = 1, y0 = 1, x1 = w - 2, y1 = h - 2;
    while (x0 <= x1 && y0 <= y1) {
        for (let x = x0; x <= x1; x++) order.push([x, y0]);
        for (let y = y0 + 1; y <= y1; y++) order.push([x1, y]);
        if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) order.push([x, y1]);
        if (x1 > x0) for (let y = y1 - 1; y > y0; y--) order.push([x0, y]);
        x0++; y0++; x1--; y1--;
    }
    return order.filter(([x, y]) => grid[y][x] !== WALL);
}

module.exports = { LAYOUTS, THEMES, layoutById, chooseLayout, buildMap, spiralOrder };
