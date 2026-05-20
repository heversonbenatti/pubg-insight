export function generateUniqueColor(index) {
    const hue = (index * 137.5) % 360;
    return `hsl(${hue}, 70%, 50%, 90%)`;
}

export function translateMapName(mapName) {
    const mapNames = {
        'Baltic_Main':    'Erangel',
        'Erangel_Main':   'Erangel',
        'Desert_Main':    'Miramar',
        'Savage_Main':    'Sanhok',
        'DihorOtok_Main': 'Vikendi',
        'Summerland_Main':'Karakin',
        'Tiger_Main':     'Taego',
        'Kiki_Main':      'Deston',
        'Neon_Main':      'Rondo',
        'Chimera_Main':   'Paramo',
        'Heaven_Main':    'Haven',
        'Range_Main':     'Camp Jackal',
    };
    return mapNames[mapName] || mapName;
}

// Mapas Battle Royale ativos — todos com imagem em public/images/ e tile em public/tiles/.
// Qualquer partida em mapa fora dessa lista é minigame, treino (Camp Jackal,
// SafeHouse_Main) ou um mapa removido sem assets (Paramo, Haven).
export const PLAYABLE_MAPS = new Set([
    'Baltic_Main',
    'Erangel_Main',
    'Desert_Main',
    'Savage_Main',
    'DihorOtok_Main',
    'Summerland_Main',
    'Tiger_Main',
    'Kiki_Main',
    'Neon_Main',
]);

// matchType BR clássico (`official` = casual, `competitive` = ranked).
// Filtra TDM/Heist/IntenseBR/AirRoyale/eventos/custom/treino mesmo que sejam
// jogados em mapas playable — esses sujam stats por terem regras diferentes
// (round-based, sem zona, modos especiais).
export const PLAYABLE_MATCH_TYPES = new Set([
    'official',
    'competitive',
]);

export function isPlayableMap(mapName) {
    return PLAYABLE_MAPS.has(mapName);
}

// Aceita match completo (objeto JSON:API) ou já o `attributes`.
export function isPlayableMatch(matchOrAttrs) {
    const a = matchOrAttrs?.data?.attributes || matchOrAttrs?.attributes || matchOrAttrs || {};
    return PLAYABLE_MAPS.has(a.mapName) && PLAYABLE_MATCH_TYPES.has(a.matchType);
}