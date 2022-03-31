import { AugmentationStats, Player, PlayerSkills } from '/../NetscriptDefinitions';


/**
 * Guard to ensure type: number
 * @param u Object to test.
 * @returns True if the object is of type number.
 */
export function isNumber(u : unknown) : u is number {
	return (u as number) !== undefined;
}


/**
 * Guard to ensure type: Player
 * @param u Object to test.
 * @returns True if the object is of type Player.
 */
export function isPlayer(u : unknown) : u is Player {
    return (u as Player).bitNodeN !== undefined;
}


/**
 * Guard to ensure type: PlayerSkills
 * @param u Object to test.
 * @returns True if the object is of type PlayerSkills.
 */
export function isPlayerSkills(u : unknown) : u is PlayerSkills {
    return (u as PlayerSkills).intelligence !== undefined;
}

/**
 * Guard to ensure type: AugmentationStats
 * @param u Object to test.
 * @returns True if the object is of type AugmentationStats.
 */
export function isTypeAugmentationStats(u : unknown) : u is AugmentationStats {
	return (u as AugmentationStats) !== undefined;
}
