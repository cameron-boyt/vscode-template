import { BitNodeMultipliers, NS  } from '@ns'
import { genPlayer, IPlayerObject } from '/libraries/player-factory';
import { genServer, IServerObject } from '/libraries/server-factory';
import { MessageType, ScriptLogger } from '/libraries/script-logger';
import { readBitnodeMultiplierData } from '/data/read-bitnodemult-data';
import { runDodgerScript } from '/helpers/dodger-helper';
import { peekPort, PortNumber } from '/libraries/port-handler';
import { IStockData } from '/data-types/stock-data';

// Script logger
let logger : ScriptLogger;

// Script refresh period
const refreshPeriod = 60000;

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

/** Bitnode Multpliers */
let multipliers : BitNodeMultipliers;

/** Owned player augmentations. */
let playerAugments : string[] = [];

/** Purchased server limit. */
let serverLimit = 0;

interface IScriptRun {
	name : string;
	runs : IScriptCondition[];
}

interface IScriptCondition {
	args : (string | number)[];
	conditions: (() => boolean)[];
}

/** Array of scripts to run once */
let singleScripts : IScriptRun[] = [];

/** Array of scripts to check continuously for heartbeat */
let repeatScripts : IScriptRun[] = [];

/*
 * ------------------------
 * > ENVIRONMENT SETUP FUNCTION
 * ------------------------
*/

/**
 * Set up the environment for this script.
 * @param ns NS object parameter.
 */
async function setupEnvironment(ns : NS) : Promise<void> {
    player = genPlayer(ns);
    machine = genServer(ns, ns.getHostname());

	multipliers = await readBitnodeMultiplierData(ns);

	serverLimit = Math.round(25 * multipliers.PurchasedServerLimit);

	ns.ps(machine.hostname).filter((x) => x.filename !== ns.getRunningScript().filename).forEach((script) => ns.kill(script.pid));
	ns.tail();

	singleScripts = [
		{ name: "/data/data-writer-daemon.js", runs: [
			{ args: [], conditions: []}
		]},
		{ name : "/startup/file-cleanup.js", runs: [
			{ args: [], conditions: []}
		]}
	];

	repeatScripts = [
		{ name: "/sleeves/sleeve-daemon.js", runs: [
			{ args: ["--gang", 1, "--stock", 2, "--money", 3], conditions: [
				() => { return machine.ram.max >= 32 },
				() => { return player.karma > -54000 },
				() => { return !player.hasCorp }
			]},
			{ args: ["--gang", 1, "--stock", 2, "--money", 3, "--shock", 0, "--wild"], conditions: [
				() => { return machine.ram.max >= 32 },
				() => { return player.karma > -54000 },
				() => { return player.hasCorp }
			]},
			{ args: ["--train", 1, "--pill", 2, "--stock", 3, "--money", 4], conditions: [
				() => { return machine.ram.max >= 32 },
				() => { return player.karma <= -54000 },
				() => { return !player.hasCorp }
			]},
			{ args: ["--train", 1, "--pill", 2, "--stock", 3, "--money", 4, "--shock", 0, "--wild"], conditions: [
				() => { return machine.ram.max >= 32 },
				() => { return player.karma <= -54000 },
				() => { return player.hasCorp }
			]}
		]},
		{ name: "/singularity/task-daemon.js", runs: [
			{ args: [], conditions: [
				() => { return machine.ram.max >= 32 }
			]}
		]},
		{ name: "/singularity/crime-committer.js", runs: [
			{ args: ["--money"], conditions: [
				() => { return player.bitnodeN !== 8; },
				() => { return machine.ram.max >= 32 && machine.ram.max < 64 }
			]},
			{ args: ["--karma", "--goal", 100], conditions: [
				() => { return player.bitnodeN === 2 },
				() => { return machine.ram.max >= 64 },
				() => { return player.karma > -100 }
			]},
			{ args: ["--karma", "--goal", 54000], conditions: [
				() => { return player.bitnodeN !== 2 },
				() => { return machine.ram.max >= 64 },
				() => { return player.karma > -54000 }
			]}
		]},
		{ name: "/coding-contracts/contract-solver-daemon.js", runs: [
			{ args: [], conditions: [
				() => { return machine.ram.max >= 64 }
			]}
		]},
		{ name: "/stock-market/stock-market-daemon.js", runs: [
			{ args: [], conditions: [
				() => { return machine.ram.max >= 64 },
				() => { return player.stocks.hasWSE },
				() => {
					const stockData = peekPort<IStockData>(ns, PortNumber.StockData);
					return (
						player.money >= 250e6 ||
						(
							stockData
								? stockData.stocks.some((stock) => stock.longPos.shares > 0 || stock.shortPos.shares > 0)
								: false
						)
					);
				}
			]}
		]},
		{ name: "/hacknet/hashnet-server-daemon.js", runs: [
			{ args: ["--hash-improve", "--hash-bladeburner", "--hash-corp"], conditions: [
				() => { return player.bitnodeN !== 8; },
				() => { return machine.ram.max >= 64 },
				() => { return multipliers.HacknetNodeMoney >= 0.25 },
				() => { return !player.hasCorp }
			]},
			{ args: ["--hash-no-money", "--hash-improve", "--hash-bladeburner", "--hash-corp", "--wild"], conditions: [
				() => { return player.bitnodeN !== 8; },
				() => { return machine.ram.max >= 64 },
				() => { return multipliers.HacknetNodeMoney >= 0.25 },
				() => { return player.hasCorp }
			]}
		]},
		{ name: "/singularity/backdoor-daemon.js", runs: [
			{ args: ["--all-servers"], conditions: [
				() => { return machine.ram.max >= 128 }
			]}
		]},
		{ name: "/bladeburner/bladeburner-daemon.js", runs: [
			{ args: [], conditions: [
				() => { return player.bitnodeN !== 8; },
				() => { return machine.ram.max >= 128 },
				() => { return player.karma <= -54000 },
				() => { return player.stats.agility >= 100 },
				() => { return player.stats.defense >= 100 },
				() => { return player.stats.dexterity >= 100 },
				() => { return player.stats.strength >= 100 }
			]}
		]},
		{ name: "/gangs/gang-daemon.js", runs: [
			{ args: [], conditions: [
				() => { return machine.ram.max >= 64 },
				() => { return (player.bitnodeN === 2 && player.karma < -100) || player.karma <= -54000 },
				() => { return !player.hasCorp }
			]},
			{ args: ["--wild"], conditions: [
				() => { return machine.ram.max >= 64 },
				() => { return (player.bitnodeN === 2 && player.karma < -100) || player.karma <= -54000 },
				() => { return player.hasCorp }
			]}
		]},
		{ name: "/corporation/corporation-daemon.js", runs: [
			{ args: [], conditions: [
				() => { return machine.ram.max >= 2048 },
				() => { return multipliers.CorporationValuation >= 0.25 },
				() => { return player.hasCorp || player.money >= 300e9 }
			]}
		]},
		{ name: "/staneks-gift/charge-daemon.js", runs: [
			{ args: [], conditions: [
				() => { return false }
			]}
		]},
		{ name: "/servers/server-purchase-daemon.js", runs: [
			{ args: [], conditions: [
				() => { return serverLimit > 0 },
				() => { return machine.ram.max >= 128 },
				() => { return player.money >= 500e6 },
				() => { return !player.hasCorp }
			]},
			{ args: ["--wild"], conditions: [
				() => { return serverLimit > 0 },
				() => { return machine.ram.max >= 128 },
				() => { return player.hasCorp }
			]}
		]},
		{ name: "/singularity/ascension-daemon.js", runs: [
			{ args: [], conditions: [
				() => { return machine.ram.max >= 2048 },
				() => {
					const totalWorth = peekPort<number>(ns, PortNumber.StockWorth);
					return (!totalWorth || totalWorth < 1e12);
				}
			]},
			{ args: ["--purchase"], conditions: [
				() => { return machine.ram.max >= 2048 },
				() => {
					const totalWorth = peekPort<number>(ns, PortNumber.StockWorth);
					if (totalWorth) {
						return totalWorth >= 1e12;
					} else {
						return false;
					}
				}
			]}
		]},
		{ name: "/hacking/hack-daemon.js", runs: [
			{ args: ["--normal-mode"], conditions: [
				() => { return player.bitnodeN !== 8; },
				() => { return machine.ram.max >= 128 && machine.ram.max < 65536 }
			]},
			{ args: ["--xp-farm-mode"], conditions: [
				() => { return machine.ram.max >= 65536 },
				() => { return playerAugments.includes("The Red Pill") }
			]},
			{ args: ["--stock-mode"], conditions: [
				() => { return machine.ram.max >= 65536 },
				() => { return !playerAugments.includes("The Red Pill") }
			]}
		]}
	];
}

/*
 * ------------------------
 * > DATA UPDATE FUNCTION
 * ------------------------
*/

/**
 * Update data for script runtime.
 * @param ns NS object parameter.
 */
async function updateData(ns : NS) : Promise<void> {
	playerAugments = await runDodgerScript<string[]>(ns, "/singularity/dodger/getOwnedAugmentations.js");
}

/*
 * ------------------------
 * > SCRIPT RUNNING FUNCTIONS
 * ------------------------
*/

/**
 * Run scripts which are marked as single-run only.
 * @param ns NS object parameters.
 */
async function runOneTimeScripts(ns : NS) : Promise<void> {
	for (const script of singleScripts) {
		for (const run of script.runs) {
			processScriptRun(ns, script.name, run);
		}

		await ns.asleep(300);
	}
}

function tryRunScript(ns : NS, script : string, args : (string | number)[]) : void {
	if (!isRamAvailableForScript(ns, script)) return;
	if (isScriptAlreadyRunning(ns, script, args)) return;
	doRunScript(ns, script, args);
}

function isRamAvailableForScript(ns : NS, script : string) : boolean {
	if (ns.getServerMaxRam("home") - ns.getServerUsedRam("home") >= ns.getScriptRam(script)) {
		logger.log(`Sufficient RAM to start script: ${script}`, { type: MessageType.debugHigh });
		return true;
	} else {
		logger.log(`Insufficient RAM to start script: ${script}`, { type: MessageType.debugLow });
		return false;
	}
}

function isScriptAlreadyRunning(ns : NS, script : string, args : (string | number)[]) : boolean {
	if (ns.isRunning(script, "home", ...args)) {
		logger.log(`Script: ${script} already running with args: [${args}]`, { type: MessageType.debugLow });
		return true;
	} else {
		logger.log(`Script: ${script} not yet running with args: [${args}]`, { type: MessageType.debugHigh });
		return false;
	}
}

function doRunScript(ns : NS, script : string, args : (string | number)[]) : void {
	const successfulRun = ns.run(script, 1, ...args);
	if (successfulRun) {
		logger.log(`Started script: ${script} with args: [${args}]`, { type: MessageType.success, logToTerminal: true });
	} else {
		logger.log(`Failed to start script: ${script} with args: [${args}]`, { type: MessageType.fail });
	}
}

async function runScripts(ns : NS) : Promise<void> {
	for (const script of repeatScripts) {
		for (const run of script.runs) {
			processScriptRun(ns, script.name, run);
		}

		await ns.asleep(300);
	}
}

function processScriptRun(ns : NS, script : string, run : IScriptCondition) : void {
	if (run.conditions.every(x => x())) {
		tryRunScript(ns, script, run.args);
	} else {
		killOldScriptInstances(ns, script, run.args)
	}
}

function killOldScriptInstances(ns : NS, script : string, args : (string | number)[]) : void {
	const oldInstances = ns.ps().filter((proc) => proc.filename === script && proc.args.every((arg) => args.includes(arg as string)) && args.every((arg) => proc.args.includes(arg as string)));
	if (oldInstances.length > 0) {
		const instance = oldInstances[0];
		logger.log(`Killing old instance of script: ${instance.filename} with args: [${instance.args}]`, { type: MessageType.warning, logToTerminal: true });
		ns.kill(instance.pid);
	}
}

/** @param {NS} ns 'ns' namespace parameter. */
export async function main(ns: NS) : Promise<void> {
	ns.disableLog("ALL");
    logger = new ScriptLogger(ns, "STARTUP", "Starting Script Agent");

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
			`Script Daemon Helper\n`+
			`Description:\n` +
			`   Run scripts based on pre-defined conditions - automate the heck outta this game!\n` +
			`Usage:\n` +
			`   run /startup/script-daemon.js [args] [flags]\n` +
			`Flags:\n` +
			`   -h or --help    : boolean |>> Prints this.\n` +
			`   -v or --verbose : boolean |>> Sets logging level to 2 - more verbosing logging.\n` +
			`   -d or --debug   : boolean |>> Sets logging level to 3 - even more verbosing logging.`
		);

		return;
	}

	await setupEnvironment(ns);

	logger.initialisedMessage(true, false);

	await runOneTimeScripts(ns);

	while (true) {
		await updateData(ns);
		await runScripts(ns);
		await ns.asleep(refreshPeriod);
	}
}
