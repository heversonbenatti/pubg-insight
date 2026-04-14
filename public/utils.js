export function generateUniqueColor(index) {
    const hue = (index * 137.5) % 360;
    return `hsl(${hue}, 70%, 50%, 90%)`;
}

export function translateMapName(mapName) {
    const mapNames = {
        'Erangel_Main': 'Erangel',
        'Desert_Main': 'Miramar',
        'Savage_Main': 'Sanhok',
        'DihorOtok_Main': 'Vikendi',
        'Summerland_Main': 'Karakin',
        'Tiger_Main': 'Taego',
        'Kiki_Main': 'Deston',
        'Neon_Main': 'Rondo',
        'Baltic_Main': 'Erangel'
    };
    
    return mapNames[mapName] || mapName;
}