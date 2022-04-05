import { NS } from '@ns'
import { genServer, IServerObject } from '/libraries/server-factory';
import { MessageType, ScriptLogger } from '/libraries/script-logger';

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
    ["debug", false],
    ["hacking-skill", false],
    ["hacking-speed", false],
    ["hacking-power", false],
    ["grow-power", false],
    ["strength-skill", false],
    ["defense-skill", false],
    ["dexterity-skill", false],
    ["agility-skill", false],
    ["charisma-skill", false],
    ["hacknet-production", false],
    ["hacknet-cost", false],
    ["reputation-gain", false],
    ["work-money", false],
    ["crime-money", false],
    ["bladeburner-stats", false]
];

// Flag set variables
let help = false; // Print help
let verbose = false; // Log in verbose mode
let debug = false; // Log in debug mode

/*
 * > SCRIPT VARIABLES <
*/

/** This machine object */
let machine : IServerObject;

/* Gift charging script. */
const CHARGE_SCRIPT = "/staneks-gift/single/chargeFragment.js";
/* Gift charging script RAM cost. */
const CHARGE_SCRIPT_RAM = 2;

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
    machine = genServer(ns, ns.getHostname());
}

/*
 * ------------------------
 * > MAIN LOOP
 * ------------------------
*/

/** @param {NS} ns 'ns' namespace parameter. */
export async function main(ns: NS) : Promise<void> {
	ns.disableLog("ALL");
    logger = new ScriptLogger(ns, "GIFT-CHARGE", "Gift Charger Daemon");

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
			`Stanek's Gift Charge Daemon\n`+
			`Description:\n` +
			`   Charges Stanek's Gift so you can focus on other tasks... glorious..!\n` +
			`Usage:\n` +
			`   run /staneks-gift/gift-charger-daemon.js [flags]\n` +
			`Flags:\n` +
			`   -h or --help               : boolean |>> Prints this.\n` +
			`   -v or --verbose            : boolean |>> Sets logging level to 2 - more verbosing logging.\n` +
			`   -d or --debug              : boolean |>> Sets logging level to 3 - even more verbosing logging.`
		);

		return;
	}

	setupEnvironment(ns);

	logger.initialisedMessage(true, false);

	while (true) {
		if (ns.stanek.activeFragments().length === 0) {
			logger.log("No fragments on board - exiting.", { type: MessageType.warning });
			break;
		}

        for (const frag of ns.stanek.activeFragments().filter(x => x.id < 100)) {
            const threads = Math.floor((machine.ram.free / 3) / CHARGE_SCRIPT_RAM);
			if (threads > 0) {
				const result = ns.run(CHARGE_SCRIPT, threads, frag.x, frag.y);
				if (result === 0) {
					logger.log(`Failed to charge fragment: ${frag.id}`, { type: MessageType.fail });
				}
			}
			await ns.asleep(refreshPeriod);
        }
	}
}
