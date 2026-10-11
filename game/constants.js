// Todas as regras ajustáveis do jogo ficam aqui.
module.exports = {
    TICK_MS: 33,               // ~30 atualizações por segundo
    PLAYERS_LIMIT: 8,

    // Movimento (ms por casa). Velocidade reduz esse tempo.
    BASE_MOVE: 130,
    SPEED_STEP: 12,
    MAX_SPEED: 4,
    GHOST_MOVE: 150,

    // Bombas e fogo
    BOMB_TIMER: 2500,
    REMOTE_FALLBACK: 10000,    // bomba remota explode sozinha depois disso
    FLAME_TIME: 600,           // o cliente recebe esse valor e anima pelo mesmo tempo
    KICK_STEP: 60,
    MAX_BOMBS: 8,
    MAX_RANGE: 8,
    POWERUP_CHANCE: 0.32,
    POWERUP_WEIGHTS: { BOMB: 24, RANGE: 24, SPEED: 16, SKILL: 10, PIERCE: 8, REMOTE: 7, SKULL: 11 },

    // Habilidades
    SKILLS: ['DASH', 'SHIELD', 'KICK', 'TELEPORT'],
    SKILL_COOLDOWN: 8000,
    SHIELD_TIME: 3000,
    DASH_DIST: 3,

    // Maldições da caveira
    CURSES: ['slow', 'fast', 'reverse', 'diarrhea', 'nobomb', 'short'],
    CURSE_MS: 12000,

    // Fantasmas
    GHOST_COOLDOWN: 6000,
    GHOST_FIRST_DELAY: 2500,
    GHOST_FUSE: 2200,

    // Partida
    COUNTDOWN_MS: 3000,
    ROUND_END_MS: 3500,
    MATCH_END_MS: 9000,
    RESPAWN_MS: 2000,          // só no lobby (treino)
    HURRY_TICK: 150,
    TARGETS: [2, 3, 5],        // vitórias para ser campeão

    // Rede
    RECONNECT_GRACE: 60000,
    LOBBY_GRACE: 20000,
    EMOTE_COOLDOWN: 1200,
    EMOTE_COUNT: 6,

    COLORS: ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ecf0f1', '#ff6fb5', '#8d6e63'],
    HATS: ['sprout', 'cap', 'bow', 'tophat', 'horns', 'propeller', 'none'],
    TEAM_COLORS: { red: '#ff5d73', blue: '#4cc9f0' },
    BOT_NAMES: ['Bot Zeca', 'Bot Lili', 'Bot Tonho', 'Bot Bia', 'Bot Juca', 'Bot Nina', 'Bot Dudu', 'Bot Mel'],

    EMPTY: 0, WALL: 1, BLOCK: 2,
    DIRS: { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
};
