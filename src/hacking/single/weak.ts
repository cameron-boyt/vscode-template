import { NS } from '../../../NetscriptDefinitions';

/** @param {NS} ns 'ns' namespace parameter. */
export async function main(ns: NS) : Promise<void> {
	const TARGET = ns.args[0] as string;
	const START_TIME = ns.args[1] as number;

	const sleepTime = START_TIME - performance.now();

	if (sleepTime > 0) {
		await ns.asleep(sleepTime);
	}

	await ns.weaken(TARGET);
}
