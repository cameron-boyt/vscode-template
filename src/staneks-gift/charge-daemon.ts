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
}

async function constructStanekBoard(ns : NS) : Promise<void> {
	const scripts : IScriptRun[] = [
		{ script: "/staneks-gift/dodger/giftHeight.js", args: [] },
		{ script: "/staneks-gift/dodger/giftWidth.js", args: [] }
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

	const board : number[][] = Array(height).fill([]).map(() => Array(width).fill(-1));
	const fragmentsToPlace = ns.stanek.fragmentDefinitions().filter((frag) => fragmentIdsToPlace.includes(frag.id));
	const boosterFragments = ns.stanek.fragmentDefinitions().filter((frag) => frag.id >= 100);

	for (const frag of ns.stanek.fragmentDefinitions()) {
		fragmentRotations[frag.id] = calculateShapeRotations(frag);
	}

	/*

	for (let k = 0; k < 4; k++) {
		for (const a of fragmentRotations[102][k]) {
			ns.print(a.map((t) => (t ? 'X' : ' ')));
		}
		ns.print("");
	}
	*/

	logger.log("Pre-construction setup complete");

	await ns.asleep(2000);

	logger.log("Trying to create board");

	ns.print(`${(' X '.repeat(width) + '\n').repeat(height)}`);

	const fragmentPlacements = await tryPlaceFragments(ns, board, 0, [], fragmentsToPlace, boosterFragments);
	ns.print(fragmentPlacements);

	logger.log("Clearing old board");
	ns.stanek.clearGift();
	await ns.asleep(2000);
	logger.log("Placing fragments");

	for (const frag of fragmentPlacements) {
		logger.log(`Trying to place fragment ${frag.fragment.id}`);

		ns.print(`@ ${frag.rootX} ${frag.rootY}`);
		for (const a of fragmentRotations[frag.fragment.id][frag.rotation]) {
			ns.print(a.map((t) => (t ? 'X' : ' ')));
		}
		ns.print("");


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
function calculateShapeRotations(fragment : Fragment) : boolean[][][] {
	const shape1 : boolean[][] = JSON.parse(JSON.stringify(fragment.shape));
	const shape2 : boolean[][] = JSON.parse(JSON.stringify(fragment.shape));
	const shape3 : boolean[][] = JSON.parse(JSON.stringify(fragment.shape));
	const shape4 : boolean[][] = JSON.parse(JSON.stringify(fragment.shape));

	const rotations : boolean[][][] = [
		shape1,
		rotateMatrix(shape2),
		rotateMatrix(rotateMatrix(shape3)),
		rotateMatrix(rotateMatrix(rotateMatrix(shape4))),
	];

	return rotations;
}

function rotateMatrix(matrix : any[][]) : any[][] {
	return matrix[0].map((_val, index) => matrix.map(row => row[index]).reverse());
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

	ns.print(`depth = ${score}`)

	if (fragmentsToPlace.length > 0) {
		const frag = fragmentsToPlace.pop() as Fragment;
		for (let rot = 0; rot <= 3; rot++) {
			ns.print(rot);
			const shape = getShapeRotation(frag, rot);
			const fragHeight = shape.length - 1;
			const fragWidth = shape[0].length - 1;
			for (let y = 1; y < board.length - 1 - fragHeight; y++) {
				for (let x = 1; x < board[0].length - 1 - fragWidth; x++) {
					if (shape[0][0] && board[y][x] !== -1) continue;
					if (mockCanPlace(board, x, y, shape)) {
						logger.log(`Placing frag ${frag.id} at ${x} ${y}`)
						const newBoard = doPlaceFragment(board, x, y, shape, frag.id);
						const deepPlacements = await tryPlaceFragments(ns, newBoard, score+1, [...placements, { fragment: frag, rootX: x, rootY: y, rotation: rot }], fragmentsToPlace, boosterFragments);
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
				const fragHeight = shape.length  -1;
				const fragWidth = shape[0].length - 1;
				for (let y = 0; y < board.length - fragHeight; y++) {
					for (let x = 0; x < board[0].length - fragWidth; x++) {
						if (mockCanPlace(board, x, y, shape) && fragmentTouchesNonBooster(board, x, y, shape)) {
							logger.log(`Placing frag ${frag.id} at ${x} ${y}`)
							const newBoard = doPlaceFragment(board, x, y, shape, frag.id);
							const deepPlacements = await tryPlaceFragments(ns, newBoard, score+1, [...placements, { fragment: frag, rootX: x, rootY: y, rotation: rot }], fragmentsToPlace, boosterFragments);
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
	return placements.length;

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

function getLargestBlobSize(board : number[][]) : number {
	const taken : string[] = [];

	let mostFree = 0;
	for (let y = 0; y < board.length; y++) {
		for (let x = 0; x < board[0].length; x++) {
			if (board[y][x] === -1 && !taken.includes(`${x}${y}`)) {
				const blob = getConnectedFree(board, x, y);
				taken.push(...blob);
				mostFree = Math.max(mostFree, blob.length)
			}
		}
	}

	return mostFree;

}

function getConnectedFree(board : number[][], x : number, y : number) : string[] {

	function getConnectedFreeRecursive(x : number, y : number, found : string[]) : string[] {
		//console.log(`${x} ${y} ${board[y][x]}`);
		if ((y > 0 						? board[y - 1][x] === -1 : false) && !found.includes(`${x}${y-1}`)) {
			found.push(`${x}${y-1}`);
			found = getConnectedFreeRecursive(x, y - 1, found);
		}

		if ((y < board.length - 1 		? board[y + 1][x] === -1 : false) && !found.includes(`${x}${y+1}`)) {
			found.push(`${x}${y+1}`);
			found = getConnectedFreeRecursive(x, y + 1, found);
		}

		if ((x > 0 						? board[y][x - 1] === -1 : false) && !found.includes(`${x-1}${y}`)) {
			found.push(`${x-1}${y}`);
			found = getConnectedFreeRecursive(x - 1, y, found);
		}

		if ((x < board[0].length - 1 	? board[y][x + 1] === -1 : false) && !found.includes(`${x+1}${y}`)) {
			found.push(`${x+1}${y}`);
			found = getConnectedFreeRecursive(x + 1, y, found);
		}

		return found;
	}

	const blob = getConnectedFreeRecursive(x, y, [`${x}${y}`]);

	const blobArray = Array(6).fill([]).map(() => Array(6).fill(0));

	for (const b of blob) {
		blobArray[parseInt(b[1])][parseInt(b[0])] = 1;
	}

	for (const a of blobArray) {
		console.log(a);
	}
	console.log("---");

	return blob;
}

function shouldTryPlaceBoosterFragments(board : number[][]) : boolean {
	//if (getLargestBlobSize(board) < 5) return false;

	let maxBlob = 0;

	for (let y = 0; y < board.length; y++) {
		for (let x = 0; x < board[0].length; x++) {
			if (board[y][x] < 100 && board[y][x] !== -1) {

				if ((y > 0 					 ? board[y - 1][x] === -1 : false)) { maxBlob = Math.max(maxBlob, getConnectedFree(board, x, y-1).length); }
				if ((y < board.length - 1 	 ? board[y + 1][x] === -1 : false)) { maxBlob = Math.max(maxBlob, getConnectedFree(board, x, y+1).length); }
				if ((x > 0 					 ? board[y][x - 1] === -1 : false)) { maxBlob = Math.max(maxBlob, getConnectedFree(board, x-1, y).length); }
				if ((x < board[0].length - 1 ? board[y][x + 1] === -1 : false)) { maxBlob = Math.max(maxBlob, getConnectedFree(board, x+1, y).length); }


			}
		}
	}

	return maxBlob >= 5;
}

function fragmentTouchesNonBooster(board : number[][], x : number, y : number, shape : boolean[][]) : boolean {
	for (let i = 0; i < shape.length; i++) {
		for (let j = 0; j < shape[0].length; j++) {
			if (shape[i][j]) {
				const p = y + i;
				const q = x + j;
				if (
					(p > 0 					 ? board[p - 1][q] !== -1 && board[p - 1][q] < 100 : false) ||
					(p < board.length - 1 	 ? board[p + 1][q] !== -1 && board[p + 1][q] < 100 : false) ||
					(q > 0					 ? board[p][q - 1] !== -1 && board[p][q - 1] < 100 : false) ||
					(q < board[0].length - 1 ? board[p][q + 1] !== -1 && board[p][q + 1] < 100 : false)
				) return true;
			}
		}
	}

	return false;
}

function mockCanPlace(board : number[][], x : number, y : number, shape : boolean[][]) : boolean {
	if (y + (shape.length - 1)    >= board.length)    return false;
	if (x + (shape[0].length - 1) >= board[0].length) return false;

	for (let i = 0; i < shape.length; i++) {
		for (let j = 0; j < shape[0].length; j++) {
			if (shape[i][j] && (board[y + i][x + j] !== -1)) return false;
		}
	}

	return true;
}

function doPlaceFragment(board : number[][], x : number, y : number, shape : boolean[][], fragId : number) : number[][] {
	const newBoard = JSON.parse(JSON.stringify(board));

	for (let i = 0; i < shape.length; i++) {
		for (let j = 0; j < shape[0].length; j++) {
			if (shape[i][j]) newBoard[y + i][x + j] = fragId;
		}
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
				ns.run("/staneks-gift/chargeFragment.js", threads, frag.x, frag.y);
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
