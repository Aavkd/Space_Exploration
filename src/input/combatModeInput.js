const COMBAT_MODE_PLAYER_STATES = new Set([
    'walking',
    'piloting',
    'eva',
    'surface'
]);

const SURFACE_WEAPON_PLAYER_STATES = new Set([
    'walking',
    'eva',
    'surface'
]);

export const SURFACE_COMBAT_GAMEPAD_FIRE_BUTTON = 'r2';

export function canToggleCombatModeInPlayerState(state) {
    return COMBAT_MODE_PLAYER_STATES.has(state);
}

export function canEquipSurfaceWeaponInPlayerState(state) {
    return SURFACE_WEAPON_PLAYER_STATES.has(state);
}
