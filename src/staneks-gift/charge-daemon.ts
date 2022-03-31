import { Fragment, NS } from '@ns'
import { genPlayer, IPlayerObject } from '/libraries/player-factory';
import { genServer, IServerObject } from '/libraries/server-factory';
import { ScriptLogger } from '/libraries/script-logger';
import { runDodgerScript, runDodgerScriptBulk } from '/helpers/dodger-helper';
import { IScriptRun } from '/data-types/dodger-data';

// Script logger
let logger : ScriptLogger;

// Script refresh period
const refreshPeriod = 1000;

// Flags
const flagSchema : [string, string | number | boolean | string[]][] = [
	["h", false],
	["help", false],
    ["v", false],
    ["verbose", false],
    ["d", false],
    ["debug", false]
];

// Flag set variables
let help = false; // Print help
let verbose = false; // Log in verbose mode
let debug = false; // Log in debug mode

/*
 * > SCRIPT VARIABLES <
*/

/** Player object */
let player : IPlayerObject;
/** This machine object */
let machine : IServerObject;

export enum FragmentType {
	// Special fragments for the UI
	None,
	Delete,

	// Stats boosting fragments
	HackingChance,
	HackingSpeed,
	HackingMoney,
	HackingGrow,
	Hacking,
	Strength,
	Defense,
	Dexterity,
	Agility,
	Charisma,
	HacknetMoney,
	HacknetCost,
	Rep,
	WorkMoney,
	Crime,
	Bladeburner,

	// utility fragments.
	Booster,
  }

  const fragmentRotations : { [key : number] : boolean[][][] } = [];



interface IFragmentPlacement {
	fragment : Fragment;
	rootX : number;
	rootY : number;
	rotation : number;
}

/*
 * ------------------------
 * > ENVIRONMENT SETUP FUNCTION
 * ------------------------
*/

/**
 * Set up the environment for this script.
 * @param ns NS object parameter.
 */
function setupEnvironment(ns : NS) : void {
    player = genPlayer(ns);
    machine = genServer(ns, ns.getHostname());

	player.money;
	machine.hostname;
}

async function constructStanekBoard(ns : NS) : Promise<void> {
	const scripts : IScriptRun[] = [
		{ script: "/staneks-gift/dodger/height.js", args: [] },
		{ script: "/staneks-gift/dodger/width.js", args: [] }
	];

	logger.log("Getting board size");
	const results = await runDodgerScriptBulk(ns, scripts);

	const height = results[0] as number;
	const width = results[1] as number;

	const hackingSpeed = true;

	const fragmentIdsToPlace : number[] = [];

	if (hackingSpeed) fragmentIdsToPlace.push(5);

	/*if (hackingSkill) fragmentsToPlace.push(0, 1);
	if (hackingPower) fragmentsToPlace.push(6);
	if (growPower) fragmentsToPlace.push(7);
	if (strengthSkill) fragmentsToPlace.push(10);
	if (defenceSkill) fragmentsToPlace.push(12);
	if (dexteritySkill) fragmentsToPlace.push(14);
	if (agilitySkill) fragmentsToPlace.push(16);
	if (charismaSkill) fragmentsToPlace.push(18);
	if (hacknetProduction) fragmentsToPlace.push(20);
	if (hacknetCost) fragmentsToPlace.push(21);
	if (reputationGain) fragmentsToPlace.push(25);
	if (workMoney) fragmentsToPlace.push(27);
	if (crimeMoney) fragmentsToPlace.push(28);
	if (bladeburnerStats) fragmentsToPlace.push(30);*/

	const board : number[][] = Array(height).fill([]).map((_row) => Array(width).fill(-1));
	const fragmentsToPlace = ns.stanek.fragmentDefinitions().filter((frag) => fragmentIdsToPlace.includes(frag.id));
	const boosterFragments = ns.stanek.fragmentDefinitions().filter((frag) => frag.id >= 100);

	for (const frag of ns.stanek.fragmentDefinitions()) {
		fragmentRotations[frag.id] = [
			calculateShapeRotation(frag, 0),
			calculateShapeRotation(frag, 1),
			calculateShapeRotation(frag, 2),
			calculateShapeRotation(frag, 3)
		];
	}

	logger.log("Pre-construction setup complete");

	await ns.asleep(2000);

	logger.log("Trying to create board");
	const fragmentPlacements = await tryPlaceFragments(ns, board, 0, [], fragmentsToPlace, boosterFragments);
	ns.print(fragmentPlacements);

	logger.log("Clearing old board");
	ns.stanek.clearGift();
	await ns.asleep(2000);
	logger.log("Placing fragments");

	for (const frag of fragmentPlacements) {
		logger.log(`Trying to place fragment ${frag.fragment.id}`);
		if (ns.stanek.canPlaceFragment(frag.rootX, frag.rootY, frag.rotation, frag.fragment.id)) {
			logger.log(`ns.stanek.place(${frag.rootX}, ${frag.rootY}, ${frag.rotation}, ${frag.fragment.id});`)
			await ns.asleep(1000);
			const placed = ns.stanek.placeFragment(frag.rootX, frag.rootY, frag.rotation, frag.fragment.id);
			if (placed) {
				logger.log(`Successfully placed fragment ${frag.fragment.id}`);
			} else {
				logger.log(`Unable to place fragment ${frag.fragment.id}`);
			}
		} else {
			logger.log(`Unable to place fragment ${frag.fragment.id}`);
		}
	}
}

/**
 * Calculate the rotation of a fragment's shape.
 * @param fragment Fragment.
 * @param rotation Number of 90 degree clockwise rotations.
 * @returns Rotated shape matrix.
 */
function calculateShapeRotation(fragment : Fragment, rotation : number) : boolean[][] {
	rotation = rotation % 4;

	const shape = fragment.shape;

	switch (rotation) {
		case 0: return shape;
		case 1: return shape[0].map((_val, index) => shape.map(row => row[index]).reverse());
		case 2: return shape.map((row) => row.reverse()).reverse();
		case 3: return shape[0].map((_val, index) => shape.map(row => row[index]).reverse()).map((row) => row.reverse()).reverse();
		default: return [];
	}
}

/**
 * Get the rotation of a fragment's shape.
 * @param fragment Fragment.
 * @param rotation Number of 90 degree clockwise rotations.
 * @returns Rotated shape matrix.
 */
function getShapeRotation(fragment : Fragment, rotation : number) : boolean[][] {
	rotation = rotation % 4;
	return fragmentRotations[fragment.id][rotation];
}

async function tryPlaceFragments(ns : NS, board : number[][], score : number, placements : IFragmentPlacement[], fragmentsToPlace : Fragment[], boosterFragments : Fragment[]) : Promise<IFragmentPlacement[]> {
	//logger.log(`${fragmentsToPlace.length} ${placements.length}`)

	await ns.asleep(1);

	let bestScore = 0;
	let bestPlacement = placements;

	if (fragmentsToPlace.length > 0) {
		const frag = fragmentsToPlace.pop() as Fragment;
		for (let rot = 0; rot <= 3; rot++) {
			const shape = getShapeRotation(frag, rot);
			const fragHeight = shape.length;
			const fragWidth = shape[0].length;
			for (let y = 0; y < board.length - fragHeight; y++) {
				for (let x = 0; x < board[0].length - fragWidth; x++) {
					if (mockCanPlace(board, x, y, shape)) {
						logger.log(`Placing frag ${frag.id} at ${x} ${y}`)
						const newBoard = doPlaceFragment(board, x, y, shape, frag.id);
						const deepPlacements = await tryPlaceFragments(ns, newBoard, 0, [...placements, { fragment: frag, rootX: x, rootY: y, rotation: rot }], fragmentsToPlace, boosterFragments);
						const deepScore = scoreBoard(newBoard, deepPlacements);

						if (deepScore > bestScore) {
							logger.log(`New best score ${deepScore}`);
							bestScore = deepScore;
							bestPlacement = deepPlacements;
						}
					}
				}
			}
		}
	} else if (shouldTryPlaceBoosterFragments(board)) {
		for (const frag of boosterFragments) {
			for (let rot = 0; rot <= 3; rot++) {
				const shape = getShapeRotation(frag, rot);
				const fragHeight = shape.length;
				const fragWidth = shape[0].length;
				for (let y = 0; y < board.length - fragHeight; y++) {
					for (let x = 0; x < board[0].length - fragWidth; x++) {
						if (mockCanPlace(board, x, y, shape) && fragmentTouchesNonBooster(board, x, y, shape)) {
							logger.log(`Placing frag ${frag.id} at ${x} ${y}`)
							const newBoard = doPlaceFragment(board, x, y, shape, frag.id);
							const deepPlacements = await tryPlaceFragments(ns, newBoard, 0, [...placements, { fragment: frag, rootX: x, rootY: y, rotation: rot }], fragmentsToPlace, boosterFragments);
							const deepScore = scoreBoard(newBoard, deepPlacements);

							if (deepScore > bestScore) {
								logger.log(`New best score ${deepScore}`);
								bestScore = deepScore;
								bestPlacement = deepPlacements;
							}
						}
					}
				}
			}
		}
	}

	//logger.log(`Exiting call with score: ${bestScore} and placements ${JSON.stringify(bestPlacement)}`);
	return bestPlacement;
}


/**
 * Get count of booster fragments touching non-boosters
 * @param placements
 * @returns
 */
function scoreBoard(board : number[][], placements : IFragmentPlacement[]) : number {
	return placements.filter((x) => x.fragment.id >= 100).length;

	const fragments = placements.filter((frag) => frag.fragment.id < 100);

	let score = 0;

	for (const frag of fragments) {
		const shape = getShapeRotation(frag.fragment, frag.rotation);

		let x = frag.rootX;
		let y = frag.rootY;

		let hitBoard = Array(board.length).fill([]).map((_row) => Array(board[0].length).fill(0));

		const orig_x = x;
		for (const row of shape) {
			for (const col of row) {
				if (col) {
					if (y > 0 					? board[y - 1][x] > 100 : false) hitBoard[y][x] = 1;
					if (y < board.length - 1 	? board[y + 1][x] > 100 : false) hitBoard[y][x] = 1;
					if (x > 0 					? board[y][x - 1] > 100 : false) hitBoard[y][x] = 1;
					if (x < board[0].length - 1 ? board[y][x + 1] > 100 : false) hitBoard[y][x] = 1;
				}

				x++;
			}
			x = orig_x;
			y++;
		}

		for (let y = 0; y < board[0].length; y++) {
			for (let x = 0; x < board.length; x++) {
				if (board[y][x] > 100) score++;
			}
		}
	}

	//logger.log(`Board score = ${score}`);

	return score;
}

function shouldTryPlaceBoosterFragments(board : number[][]) : boolean {
	for (let y = 0; y < board.length; y++) {
		for (let x = 0; x < board[0].length; x++) {
			if (board[y][x] < 100 && board[y][x] !== -1) {

				if (
					(y > 0 					 ? board[y - 1][x] === -1 : false) ||
					(y < board.length - 1 	 ? board[y + 1][x] === -1 : false) ||
					(x > 0 					 ? board[y][x - 1] === -1 : false) ||
					(x < board[0].length - 1 ? board[y][x + 1] === -1 : false)
				) return true;

			}
		}
	}

	return false;
}

function fragmentTouchesNonBooster(board : number[][], x : number, y : number, shape : boolean[][]) : boolean {
	const orig_x = x;
	for (const row of shape) {
		for (const col of row) {
			if (col) {
				if (
					(y > 0 					 ? board[y - 1][x] !== -1 && board[y - 1][x] < 100 : false) ||
					(y < board.length - 1 	 ? board[y + 1][x] !== -1 && board[y + 1][x] < 100 : false) ||
					(x > 0					 ? board[y][x - 1] !== -1 && board[y][x - 1] < 100 : false) ||
					(x < board[0].length - 1 ? board[y][x + 1] !== -1 && board[y][x + 1] < 100 : false)
				) return true;
			}
			x++;
		}
		x = orig_x;
		y++;
	}

	return false;
}

function mockCanPlace(board : number[][], x : number, y : number, shape : boolean[][]) : boolean {
	if (y + (shape.length - 1)    >= board.length)    return false;
	if (x + (shape[0].length - 1) >= board[0].length) return false;

	const orig_x = x;
	for (const row of shape) {
		for (const col of row) {
			if (col && board[y][x] !== -1) return false;
			x++;
		}
		x = orig_x;
		y++;
	}

	return true;
}

function doPlaceFragment(board : number[][], x : number, y : number, shape : boolean[][], fradId : number) : number[][] {
	const newBoard = JSON.parse(JSON.stringify(board));

	const orig_x = x;
	for (const row of shape) {
		for (const col of row) {
			if (col) {
				newBoard[y][x] = fradId;
			}
			x++;
		}
		x = orig_x;
		y++;
	}

	return newBoard;
}













/** @param {NS} ns 'ns' namespace parameter. */
export async function main(ns: NS) : Promise<void> {
	ns.disableLog("ALL");
    logger = new ScriptLogger(ns, "TEST", "TEST");

	// Parse args
	ns.args[0];

	// Parse flags
	const flags = ns.flags(flagSchema);
	help = flags.h || flags["help"];
	verbose = flags.v || flags["verbose"];
	debug = flags.d || flags["debug"];

	if (verbose) logger.setLogLevel(2);
	if (debug) 	 logger.setLogLevel(3);

	// Helper output
	if (help) {
		ns.tprintf('%s',
			`TEST Helper\n`+
			`Description:\n` +
			`   Test script.\n` +
			`Usage:\n` +
			`   run /.js [args] [flags]\n` +
			`Arguments:\n` +
			`   exampleArg : string |>> This is an argument.\n` +
			`Flags:\n` +
			`   -h or --help    : boolean |>> Prints this.\n` +
			`   -v or --verbose : boolean |>> Sets logging level to 2 - more verbosing logging.\n` +
			`   -d or --debug   : boolean |>> Sets logging level to 3 - even more verbosing logging.`
		);

		return;
	}

	setupEnvironment(ns);

	logger.initialisedMessage(true, false);

	logger.log("Starting board construction");
	await constructStanekBoard(ns);
	logger.log("Finished board construction");

	/*while (true) {
        for (const frag of ns.stanek.activeFragments().filter(x => x.id < 100)) {
            const threads = Math.floor(machine.ram.free / 2);
			if (threads > 0) {
				ns.run("/staneks-gift/charge.js", threads, frag.x, frag.y);
			}
			await ns.asleep(1250);
        }
	}*/

	/**
	 * need to stop this competeing with hacking for ram. one or the other only...............
	 * charge until good multupliers on staneks -> hack -> charge again only for rep push?
	 *
	 * General cleanup required obv, this script is uglyyyyy
	 */
}
