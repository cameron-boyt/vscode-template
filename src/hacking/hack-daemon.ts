import { NS } from '@ns'
import { IPlayerObject, genPlayer } from '/libraries/player-factory.js';
import { IServerObject, genServer } from '/libraries/server-factory.js';
import { peekPort, PortNumber } from '/libraries/port-handler.js';
import { MessageType, ScriptLogger } from '/libraries/script-logger.js';
import { HackInstruction, HackMode, IGrowCycle, IHackCycle, IWeakenCycle} from '/data-types/hacking-data.js';
import { IStockData, symToHostname } from '/data-types/stock-data.js';
import { getAllServers } from '/helpers/server-helper';

// Script logger
let logger : ScriptLogger;

// Flags
const flagSchema : [string, string | number | boolean | string[]][] = [
	["h", false],
	["help", false],
    ["v", false],
    ["verbose", false],
    ["d", false],
    ["debug", false],
    ["normal-mode", false],
    ["stock-mode", false],
    ["xp-farm-mode", false],
    ["share-mode", false],
];

let help = false;
let verbose = false;
let debug = false;
let normalMode = false;
let stockMode = false;
let xpFarmMode = false;
let shareMode = false;

let currentMode = HackMode.Normal;

// This player and server objects
let player : IPlayerObject;

// List of files to send to hacking servers
const REQUIRED_FILES = [
    "/hacking/hack-daemon-worker.js",
    "/hacking/single/hack.js", "/hacking/single/grow.js", "/hacking/single/weak.js", "/sharing/share.js",
    "/libraries/script-logger.js", "/libraries/port-handler.js",
    "/libraries/server-factory.js", "/libraries/player-factory.js", "/data-types/hacking-data.js"
];

// Server lists prepared for various hacking scenarios
let servers : IServerObject[];
let purchasedServerNames : string[];
let purchasedServers : IServerObject[];
let serversByHackRating : IServerObject[];
let serversByStockBenefit : IServerObject[];
const stockInfluenceMode : { [key : string] : HackInstruction } = {};

// Flag to warn that we can't assign any stock mode orders this cycle
let stockModeImpossible = false;

const assigneeNextAvailability : { [key : string] : number } = {};
// Map of servers if they are currently busy (do not hack)
const targetNextAvailability : { [key : string] : number } = {};

// Scripts and RAM costs
const HACK_SCRIPT = "/hacking/single/hack.js";
const HACK_SCRIPT_RAM = 1.7;
const GROW_SCRIPT = "/hacking/single/grow.js";
const GROW_SCRIPT_RAM = 1.75;
const WEAK_SCRIPT = "/hacking/single/weak.js";
const WEAK_SCRIPT_RAM = 1.75;
const SHARE_SCRIPT = "/sharing/share.js";
const SHARE_SCRIPT_RAM = 4;

const HACK_FORITFY = 0.002;
const GROW_FORTIFY = 0.004;
const WEAKEN_POTENCY = 0.05;

const BATCH_DELAY = 2000;
const STEP_DELAY = BATCH_DELAY / 6;
const START_DELAY = 500;

const maxHackPercentage = 0.75;

const queuedWeakEvents : { [key : string] : {
    uid : number;
    assignee : string;
    power : number;
}[]} = {};


const queuedGrowEvents : { [key : string] : {
    uid : number;
    assignee : string;
    power : number;
}[]} = {};

let chargeScriptActive = false;

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
    servers = getAllServers(ns).filter(x => x.slice(0, 6) !== "server" && x.slice(0, 7) !== "hacknet").map(x => genServer(ns, x));
    purchasedServerNames = ns.getPurchasedServers();
    purchasedServers = purchasedServerNames.map(x => genServer(ns, x));

    for (const server of [...servers, ...purchasedServers]) {
        await ns.scp(REQUIRED_FILES, server.hostname);
        assigneeNextAvailability[server.hostname]= 0;
        targetNextAvailability[server.hostname] = 0;
        queuedWeakEvents[server.hostname] = [];
        queuedGrowEvents[server.hostname] = [];
    }
}

/*
 * ------------------------
 * > SERVER LIST UPDATE FUNCTION
 * ------------------------
*/

/**
 * Updates the list of servers for the hacking modes to utilise.
 * @param ns NS object parameter.
 */
async function updateServerLists(ns : NS) : Promise<void> {
    logger.log("Updating server lists", { type: MessageType.debugHigh });

    const oldServers = purchasedServerNames;
    purchasedServerNames = ns.getPurchasedServers();

    for (const server of oldServers.filter((s) => !purchasedServerNames.includes(s))) {
        delete assigneeNextAvailability[server];
        delete targetNextAvailability[server];
        delete queuedWeakEvents[server];
        delete queuedGrowEvents[server];

        for (let w of Object.values(queuedWeakEvents)) {
            w = w.filter((e) => e.assignee !== server);
        }

        for (let g of Object.values(queuedGrowEvents)) {
            g = g.filter((e) => e.assignee !== server);
        }
    }

    for (const server of purchasedServerNames.filter((s) => !oldServers.includes(s))) {
        await ns.scp(REQUIRED_FILES, server);
        assigneeNextAvailability[server]= 0;
        targetNextAvailability[server] = 0;
        queuedWeakEvents[server] = [];
        queuedGrowEvents[server] = [];
    }

    purchasedServers = purchasedServerNames.map(x => genServer(ns, x));

    const hackableServers = servers.filter(x => x.isHackableServer);
    serversByHackRating = hackableServers.sort((a, b) => b.hackAttractiveness - a.hackAttractiveness);
    serversByStockBenefit = [];

    chargeScriptActive = ns.ps().filter((proc) => proc.filename === "/staneks-gift/charge.daemon.js").length > 0;

    const stockData = peekPort<IStockData>(ns, PortNumber.StockData);
    if (!stockData) return;

    const stockDataByReturn = stockData.stocks.filter(x =>
        symToHostname.filter(y => y.sym === x.sym).length > 0 &&
        (x.longPos.shares > 0 || x.shortPos.shares > 0)
    ).sort((a, b) => {
        const hostnameA = symToHostname.find(y => y.sym === a.sym)?.server;
        const hostnameB = symToHostname.find(y => y.sym === b.sym)?.server;
        const serverA = servers.find(x => x.hostname === hostnameA);
        const serverB = servers.find(x => x.hostname === hostnameB);
        if (!serverA || !serverB) return -Infinity;
        return (
            (((b.longPos.shares * b.longPos.price) + (b.shortPos.shares * b.shortPos.price)) / (serverB?.hackTime.current * (1 + b.forecast.abs))) -
            (((a.longPos.shares * a.longPos.price) + (a.shortPos.shares * a.shortPos.price)) / (serverA?.hackTime.current * (1 + a.forecast.abs)))
        );
    }
    );

    for (const stock of stockDataByReturn) {
        const hostname = symToHostname.find(y => y.sym === stock.sym)?.server;
        if (!hostname) continue;

        const server = servers.find(x => x.hostname === hostname);
        if (!server) continue;

        if (player.stats.hacking >= server.hackLevel && server.hasRootAccess) {
            serversByStockBenefit.push(server);
            stockInfluenceMode[server.hostname] = stock.expectedReturn > 0 ? HackInstruction.Grow : HackInstruction.Hack;
        }
    }

    if (serversByStockBenefit.length === 0 && currentMode === HackMode.StockMarket) {
        logger.log("Unable to push any servers to hack for stock influence - script will instead push XP Farm commands", { type: MessageType.warning });
        stockModeImpossible = true;
    } else {
        stockModeImpossible = false;
    }
}

/*
 * ------------------------
 * > SERVER NUKE FUNCTION
 * ------------------------
*/

/**
 * Test if we can nuke any servers - and do so if possible.
 * @param ns NS object parameter.
 */
function tryNukeServers(ns : NS) : void {
    logger.log("Trying to nuke any new servers", { type: MessageType.debugHigh });
    servers.filter((s) => s.hostname !== "home" && s.hostname.substring(0, 6) !== "server").forEach((s) => {
        if (!s.ports.isSSHOpen  && ns.fileExists("BruteSSH.exe"))   { ns.brutessh(s.hostname);  }
        if (!s.ports.isFTPOpen  && ns.fileExists("FTPCrack.exe"))   { ns.ftpcrack(s.hostname);  }
        if (!s.ports.isSMTPOpen && ns.fileExists("RelaySMTP.exe"))  { ns.relaysmtp(s.hostname); }
        if (!s.ports.isHTTPOpen && ns.fileExists("HTTPWorm.exe"))   { ns.httpworm(s.hostname);  }
        if (!s.ports.isSQLOpen  && ns.fileExists("SQLInject.exe"))  { ns.sqlinject(s.hostname); }

        if (!s.hasRootAccess && s.ports.openCount >= s.ports.requiredCount && player.stats.hacking >= s.hackLevel) {
            ns.nuke(s.hostname);
            logger.log(`Nuked ${s.hostname}`, { type: MessageType.success, sendToast: true });
        }
    });
}

/*
 * ------------------------
 * > SERVER PREPARATION FUNCTION
 * ------------------------
*/

/**
 * Given a list of servers, prepare them to hack by passing files.
 * @param ns NS object parameter.
 * @param servers List of server objects to prepare.
 */
async function prepareHackingServers(ns : NS) : Promise<void> {
    logger.log("Preparing all servers", { type: MessageType.debugHigh });
    const killScripts = ["/hacking/hack-daemon-worker.js", "/hacking/single/hack.js", "/hacking/single/grow.js", "/hacking/single/weak.js", "/sharing/share.js"];
    for (const server of [...servers, ...purchasedServers]) {
        ns.ps(server.hostname).filter(x => killScripts.includes(x.filename)).forEach((proc) => ns.kill(proc.pid));
        await ns.scp(REQUIRED_FILES, server.hostname);
        assigneeNextAvailability[server.hostname] = 0;
        targetNextAvailability[server.hostname] = 0;
        queuedWeakEvents[server.hostname] = [];
        queuedGrowEvents[server.hostname] = [];
    }
}

/*
 * ------------------------
 * > HACK ORDER CYCLE CALCULATION FUNCTIONS
 * ------------------------
*/

/**
 * Calculate how many weaken threads are required.
 * @param ns NS object parameter.
 * @param targetServer Hostname of the target server.
 * @returns Weaken Cycle information object.
 */
function calculateWeakenCycles(ns : NS, assignee : IServerObject, targetServer : IServerObject) : IWeakenCycle {
    logger.log("Calculating weaken cycles", { type: MessageType.debugHigh });

    const weakenThreads = Math.floor(assignee.ram.free / WEAK_SCRIPT_RAM);

    const weakTime = targetServer.weakenTime.current;

    const availableTime = targetNextAvailability[targetServer.hostname];
    const weakenAtTime = Math.ceil(Math.max(performance.now() + (weakTime - weakTime), availableTime - weakTime) + (STEP_DELAY * 0));

    return {
        w: {
            threads: weakenThreads,
            executionTime: weakTime,
            startTime: weakenAtTime
        }
    };
}

/**
 * Calculate how many grow + weaken threads are required.
 * @param ns NS object parameter.
 * @param targetServer Hostname of the target server.
 * @returns Grow Cycle information object.
 */
function calculateGrowCycles(ns : NS, assignee : IServerObject, targetServer : IServerObject) : IGrowCycle {
    logger.log("Calculating grow cycles", { type: MessageType.debugHigh });
    const cycleRAMCost = GROW_SCRIPT_RAM + (WEAK_SCRIPT_RAM * (GROW_FORTIFY / WEAKEN_POTENCY));

    const growThreads = Math.floor((assignee.ram.free - WEAK_SCRIPT_RAM) / cycleRAMCost);
    const weakenThreads = Math.ceil(growThreads * GROW_FORTIFY / WEAKEN_POTENCY);

    const growTime = targetServer.growTime.min;
    const weakTime = targetServer.weakenTime.min;

    const availableTime = targetNextAvailability[targetServer.hostname];
    const growAtTime   = Math.ceil(Math.max(performance.now() + (weakTime - growTime), availableTime - growTime) + (STEP_DELAY * 0));
    const weakenAtTime = Math.ceil(Math.max(performance.now() + (weakTime - weakTime), availableTime - weakTime) + (STEP_DELAY * 1));

    return {
        g: {
            threads: growThreads,
            executionTime: growTime,
            startTime: growAtTime
        },
        w: {
            threads: weakenThreads,
            executionTime: weakTime,
            startTime: weakenAtTime
        }
    }
}

/**
 * Calculate how many hack + grow + weaken threads are required.
 * @param ns NS object parameter.
 * @param targetServer Hostname of the target server.
 * @returns Hack Cycle information object.
 */
function calculateHackCycles(ns : NS, assignee : IServerObject, targetServer : IServerObject) : IHackCycle {
    logger.log("Calculating hack cycles", { type: MessageType.debugHigh });

    // Calculate the optimal amount of threads
    let hackThreads = 0;
    let growThreads = 0;
    let weakHackThreads = 0;
    let weakGrowThreads = 0;

    // Find the sweet spot
    let totalCycles = 0;

    let minThreads = 1;
    //ns.hackAnalyze(targetServer.hostname) sometimes returns Infinity?
    let hackPercent = ns.hackAnalyze(targetServer.hostname);
    hackPercent = (hackPercent === 0 ? 1 : hackPercent);
    let maxThreads = Math.floor(maxHackPercentage / hackPercent);
    //ns.print(hackPercent)

    let adjustments = 0;

    while (minThreads !== maxThreads && adjustments < 25) {

        // Calculate how much money we plan on stealing, and how many threads that will take
        hackThreads = Math.floor((minThreads + maxThreads) / 2);
        const hackFrac = hackThreads * ns.hackAnalyze(targetServer.hostname);
        const totalHackCost = hackThreads * HACK_SCRIPT_RAM;

        // Calculate how many grow threads we need to restore the money we plan on stealing
        const growFrac = (1 / (1 - hackFrac));

        //ns.print(`${assignee.hostname} ${targetServer.hostname} ${growFrac} ${hackFrac} ${hackThreads} ${minThreads} ${maxThreads} ${maxHackPercentage}`);

        growThreads = Math.ceil((ns.growthAnalyze(targetServer.hostname, growFrac, assignee.cores) * 1.05));
        const totalGrowCost = growThreads * GROW_SCRIPT_RAM;

        // Calculate the number of weaken threads we need to counteract the hacks and grows earlier
        weakHackThreads = Math.ceil(hackThreads * HACK_FORITFY / WEAKEN_POTENCY);
        weakGrowThreads = Math.ceil(growThreads * GROW_FORTIFY / WEAKEN_POTENCY);
        const totalWeakenCost = (weakHackThreads + weakGrowThreads) * WEAK_SCRIPT_RAM;

        // Calculate how many cycles we would be able to run at once (hypothetically)
        const totalCycleCost = totalHackCost + totalGrowCost + totalWeakenCost;
        //ns.print(`${minThreads} --> ${maxThreads}`);
        //ns.print(`Free = ${machine.ram.free * ramUsageMult}GB | (${hackThreads}xH + ${growThreads}xG + ${weakHackThreads + weakGrowThreads}xW) = ${totalCycleCost}GB`);
        totalCycles = assignee.ram.free / totalCycleCost;

        // Determine if we are able to run more than a single cycle of HWGW
        if (totalCycles > 1) {
            minThreads = hackThreads;
        } else if (totalCycles < 1) {
            maxThreads = hackThreads;
        }

        adjustments++;
    }

    const hackTime = targetServer.hackTime.min;
    const growTime = targetServer.growTime.min;
    const weakTime = targetServer.weakenTime.min;

    const availableTime = targetNextAvailability[targetServer.hostname];
    const hackAtTime    = Math.ceil(Math.max(performance.now() + (weakTime - hackTime), availableTime - hackTime) + (STEP_DELAY * 0));
    const weakenHAtTime = Math.ceil(Math.max(performance.now() + (weakTime - weakTime), availableTime - weakTime) + (STEP_DELAY * 1));
    const growAtTime    = Math.ceil(Math.max(performance.now() + (weakTime - growTime), availableTime - growTime) + (STEP_DELAY * 2));
    const weakenGAtTime = Math.ceil(Math.max(performance.now() + (weakTime - weakTime), availableTime - weakTime) + (STEP_DELAY * 3));

    return {
        cycles: Math.min(25, Math.floor(totalCycles)),
        h: {
            threads: hackThreads,
            executionTime: hackTime,
            startTime: hackAtTime
        },
        wh: {
            threads: weakHackThreads,
            executionTime: weakTime,
            startTime: weakenHAtTime
        },
        g: {
            threads: growThreads,
            executionTime: growTime,
            startTime: growAtTime
        },
        wg: {
            threads: weakGrowThreads,
            executionTime: weakTime,
            startTime: weakenGAtTime
        }
    };
}

/*
 * ------------------------
 * > SHARE.JS INSTANCE STARTER/KILLER FUNCTIONS
 * ------------------------
*/

/**
 * Start a number of share instances on this server.
 * @param ns NS object parameter.
 * @param max True if the script should be run at max threads.
 */
function startShareInstances(ns : NS, assignee : IServerObject, max = false) : void {
    killShareInstances(ns);
    logger.log("Starting share instances", { type: MessageType.debugLow });
    const threadCountModifier = max ? 1 : 0.03 * Math.log(assignee.ram.max) / Math.log(2);
    const threads = Math.floor(assignee.ram.free * threadCountModifier / SHARE_SCRIPT_RAM);
    ns.exec(SHARE_SCRIPT, assignee.hostname, threads);
}

/**
 * Kill all current active share script instances on this server.
 * @param ns NS object parameter.
 */
function killShareInstances(ns : NS) : void {
    logger.log("Killing share instances", { type: MessageType.debugLow });
    const shareProcessInstances = ns.ps().filter(x => x.filename === SHARE_SCRIPT)
    shareProcessInstances.forEach((proc) => ns.kill(proc.pid));
}

/*
 * ------------------------
 * > HACK ORDER ASSIGNING FUNCTIONS
 * ------------------------
*/

async function processOrderAssignments(ns : NS) : Promise<void> {
    for (const server of [...servers, ...purchasedServers].filter(x => x.isHackingServer && performance.now() > assigneeNextAvailability[x.hostname])) {
        if (server.hostname === "home" && chargeScriptActive) continue;
        logger.log(`Processing order assignment for server: ${server.hostname}`, { type: MessageType.info });
        await processServerOrderAssignment(ns, server)
    }
}

/**
 * Process the order request, attempting to assign the requestee an order based on the current hack mode.
 * @param ns NS object paramter
 * @param request Order request object.
 * @returns True if an order was successfully assigned; false otherwise.
 */
async function processServerOrderAssignment(ns : NS, server : IServerObject) : Promise<boolean> {
    switch (currentMode) {
        case HackMode.Normal: return tryAssignNormalOrder(ns, server);
        case HackMode.StockMarket: return stockModeImpossible ? tryAssignNormalOrder(ns, server) : tryAssignStockMarketOrder(ns, server);
        case HackMode.XPFarm: return tryAssignXPFarmOrder(ns, server);
        case HackMode.ShareAll: return tryAssignShareAllOrder(ns, server);
    }
}

/**
 * Try to assign a normal hacking order to a hacking server.
 * @param ns NS object parameter.
 * @param request Order request object.
 * @returns True if an order was successfully assigned; false otherwise.
 */
async function tryAssignNormalOrder(ns : NS, assignee : IServerObject) : Promise<boolean> {
    logger.log("Trying to assign Normal mode order", { type: MessageType.debugHigh });
    for (const target of serversByHackRating) {
        if (targetRequiresWeaken(target))   return tryAssignWeakenOrder(ns, assignee, target);
        if (targetRequiresGrow(target))     return tryAssignGrowOrder(ns, assignee, target);
                                            return tryAssignHackOrder(ns, assignee, target);
    }

    return false;
}

function targetRequiresWeaken(target : IServerObject) : boolean {
    const queuedWeakens = queuedWeakEvents[target.hostname];
    return (
        queuedWeakens.length > 0
            ? target.security.current - queuedWeakens.map(x => x.power).reduce((a, b) => a + b, 0) > target.security.min
            : !target.security.isMin
    );
}

function targetRequiresGrow(target : IServerObject) : boolean {
    const queuedGrows = queuedGrowEvents[target.hostname];
    return (
        !targetRequiresWeaken(target) &&
        queuedGrows.length > 0
            ? target.money.current * queuedGrows.map(x => x.power).reduce((a, b) => a * b) < target.money.max
            : !target.money.isMax
    );
}

/**
 * Try to assign a stock market affecting hacking order to a hacking server.
 * @param ns NS object parameter.
 * @param request Order request object.
 * @returns True if an order was successfully assigned; false otherwise.
 */
async function tryAssignStockMarketOrder(ns : NS, assignee : IServerObject) : Promise<boolean> {
    logger.log("Trying to assign Stock Market mode order", { type: MessageType.debugHigh });
    for (const target of serversByStockBenefit) {
        const influence = stockInfluenceMode[target.hostname];

        if      (!assignee.security.isMin) return tryAssignWeakenOrder(ns, assignee, target);
        else if (!assignee.money.isMax)    return tryAssignGrowOrder(ns, assignee, target, influence);
        else                               return tryAssignHackOrder(ns, assignee, target, influence);
    }

    return false;
}

/**
 * Try to assign an xp farm hacking order to a hacking server.
 * @param ns NS object parameter.
 * @param request Order request object.
 * @returns True if an order was successfully assigned; false otherwise.
 */
async function tryAssignXPFarmOrder(ns : NS, assignee : IServerObject) : Promise<boolean> {
    logger.log("Trying to assign XP Farm mode order", { type: MessageType.debugHigh });
    if (player.stats.hacking >= ns.getServer("joesguns").requiredHackingSkill) {
        return tryAssignWeakenOrder(ns, assignee, genServer(ns, "joesguns"));
    } else {
        return tryAssignWeakenOrder(ns, assignee, genServer(ns, "n00dles"));
    }
}

/**
 * Try to assign a share all order to a hacking server.
 * @param ns NS object parameter.
 * @param request Order request object.
 * @returns True if an order was successfully assigned; false otherwise.
 */
async function tryAssignShareAllOrder(ns : NS, assignee : IServerObject) : Promise<boolean> {
    logger.log("Trying to assign Share All mode order", { type: MessageType.debugHigh });
    startShareInstances(ns, assignee, true);
    return true;
}

/**
 * Try to assign a weaken order to a hacking server.
 * @param ns NS object parameter.
 * @param requester Name of hacking server.
 * @param target Name of target server.
 * @param mode Hacking mode.
 * @returns True if an order was successfully assigned; false otherwise.
 */
async function tryAssignWeakenOrder(ns : NS, assignee : IServerObject, target : IServerObject) : Promise<boolean> {
    logger.log("Trying to assign weaken order", { type: MessageType.debugHigh });
    const weakenCycle = calculateWeakenCycles(ns, assignee, target);
    if (weakenCycle.w.threads < 1) {
        return false;
    } else {
        await doAssignWeakenOrder(ns, assignee, target, weakenCycle);
        return true;
    }
}

/**
 * Process the cycle by executing the specified threads.
 * @param ns NS object parameter.
 * @param cycle Cycle information.
 * @param target Target server to be weakened.
 */
async function doAssignWeakenOrder(ns : NS, assignee : IServerObject, target : IServerObject, cycle : IWeakenCycle) : Promise<void> {
    logger.log(`Starting weaken cycle on ${target.hostname} for ${cycle.w.threads} threads`, { type: MessageType.info });

    ns.exec(WEAK_SCRIPT, assignee.hostname, cycle.w.threads, target.hostname, cycle.w.startTime);

    assigneeNextAvailability[assignee.hostname] = cycle.w.startTime + cycle.w.executionTime + START_DELAY * 2 + BATCH_DELAY * 2;
    targetNextAvailability[target.hostname] = cycle.w.startTime + cycle.w.executionTime + BATCH_DELAY;

    const uid = Math.floor(performance.now());
    const expiry = cycle.w.startTime + cycle.w.executionTime + BATCH_DELAY;

    queuedWeakEvents[target.hostname].push({
        uid: uid,
        assignee: assignee.hostname,
        power: cycle.w.threads * WEAKEN_POTENCY
    });

    setTimeout(() => {
        if (queuedWeakEvents[target.hostname]) {
            const index = queuedWeakEvents[target.hostname].findIndex((x) => x.uid === uid);
            queuedWeakEvents[target.hostname].splice(index);
        }
    }, expiry - performance.now());
}

/**
 * Try to assign a grow order to a hacking server.
 * @param ns NS object parameter.
 * @param assignee Name of hacking server.
 * @param target Name of target server.
 * @param stockInfluence True if this instruction will affect the stock market.
 * @returns True if an order was successfully assigned; false otherwise.
 */
async function tryAssignGrowOrder(ns : NS, assignee : IServerObject, target : IServerObject, stockInfluence? : HackInstruction) : Promise<boolean> {
    logger.log("Trying to assign grow order", { type: MessageType.debugHigh });
    const growCycle = calculateGrowCycles(ns, assignee, target);
    if (growCycle.g.threads < 1) {
        return false;
    } else {
        await doAssignGrowOrder(ns, assignee, target, growCycle, stockInfluence === HackInstruction.Grow);
        return true;
    }
}

/**
 * Process the cycle by executing the specified threads.
 * @param ns NS object parameter.
 * @param cycle Cycle information.
 * @param target Target server to be grown.
 * @param growInfluence True if this grow instruction should affect the stock market.
 */
 async function doAssignGrowOrder(ns : NS, assignee : IServerObject, target : IServerObject, cycle : IGrowCycle, growInfluence : boolean) : Promise<void> {
    logger.log(`Starting grow cycle on ${target.hostname} for ${cycle.g.threads} grow threads and ${cycle.w.threads} weaken threads`, { type: MessageType.info });

    ns.exec(GROW_SCRIPT, assignee.hostname, cycle.g.threads, target.hostname, cycle.g.startTime, growInfluence);
    ns.exec(WEAK_SCRIPT, assignee.hostname, cycle.w.threads, target.hostname, cycle.w.startTime);

    assigneeNextAvailability[assignee.hostname] = cycle.w.startTime + cycle.w.executionTime + START_DELAY * 2 + BATCH_DELAY * 2;
    targetNextAvailability[target.hostname] = cycle.w.startTime + cycle.w.executionTime + BATCH_DELAY;

    const uid = Math.floor(performance.now());
    const expiry = cycle.w.startTime + cycle.w.executionTime + BATCH_DELAY;

    queuedGrowEvents[target.hostname].push({
        uid: uid,
        assignee: assignee.hostname,
        power: ns.formulas.hacking.growPercent(target.server, cycle.g.threads, player.player, assignee.cores),
    });

    setTimeout(() => {
        if (queuedGrowEvents[target.hostname]) {
            const index = queuedGrowEvents[target.hostname].findIndex((x) => x.uid === uid);
            queuedGrowEvents[target.hostname].splice(index);
        }
    }, expiry - performance.now());
}

/**
 * Try to assign a hack order to a hacking server.
 * @param ns NS object parameter.
 * @param requester Name of hacking server.
 * @param target Name of target server.
 * @param mode Hacking mode.
 * @returns True if an order was successfully assigned; false otherwise.
 */
async function tryAssignHackOrder(ns : NS, assignee : IServerObject, target : IServerObject, stockInfluence? : HackInstruction) : Promise<boolean> {
    logger.log("Trying to assign hack order", { type: MessageType.debugHigh });
    const hackCycle = calculateHackCycles(ns, assignee, target);
    if (hackCycle.h.threads <= 0) return false;
    await doAssignHackOrder(ns, assignee.hostname, hackCycle, target.hostname, stockInfluence === HackInstruction.Grow, stockInfluence === HackInstruction.Hack);
    return true;
}

/**
 * Process the cycle by executing the specified threads.
 * @param ns NS object parameter.
 * @param cycle Cycle information.
 * @param target Target server to be hacked.
 * @param growInfluence True if this grow instruction should affect the stock market.
 * @param hackInfluence True if this hack instruction should affect the stock market.
 */
async function doAssignHackOrder(ns : NS, assignee : string, cycle : IHackCycle, target : string, growInfluence : boolean, hackInfluence : boolean) : Promise<void> {
    const percentStolen = (cycle.h.threads * ns.hackAnalyze(target) * 100).toFixed(2);

    logger.log(`Stealing ${percentStolen}% of funds from ${target} for ${cycle.cycles} cycles`, { type: MessageType.info });
    logger.log(`Hacks = ${cycle.h.threads}, Weakens = ${cycle.wh.threads} Grows = ${cycle.g.threads}, Weakens = ${cycle.wg.threads}`, { type: MessageType.info });

    for (let i = 0; i < cycle.cycles; i++) {
        logger.log(`Executing cycle: ${i}`, { type: MessageType.debugLow });

        ns.exec(HACK_SCRIPT, assignee, cycle.h.threads, target, cycle.h.startTime, hackInfluence);
        ns.exec(WEAK_SCRIPT, assignee, cycle.wh.threads, target, cycle.wh.startTime);
        ns.exec(GROW_SCRIPT, assignee, cycle.g.threads, target, cycle.g.startTime, growInfluence);
        ns.exec(WEAK_SCRIPT, assignee, cycle.wg.threads, target, cycle.wg.startTime);

        cycle.h.startTime += BATCH_DELAY;
        cycle.wh.startTime += BATCH_DELAY;
        cycle.g.startTime += BATCH_DELAY;
        cycle.wg.startTime += BATCH_DELAY;
    }

    assigneeNextAvailability[assignee] = cycle.wg.startTime + cycle.wg.executionTime + START_DELAY * 2 + BATCH_DELAY * 2;
    targetNextAvailability[target] = cycle.wg.startTime + cycle.wg.executionTime + BATCH_DELAY;
}

/** @param {NS} ns 'ns' namespace parameter. */
export async function main(ns: NS) : Promise<void> {
	ns.disableLog("ALL");
    logger = new ScriptLogger(ns, "HACK", "Hacking Daemon");

	// Parse flags
	const flags = ns.flags(flagSchema);
	help = flags.h || flags["help"];
	verbose = flags.v || flags["verbose"];
	debug = flags.d || flags["debug"];
    normalMode = flags["normal-mode"];
    stockMode = flags["stock-mode"];
    xpFarmMode = flags["xp-farm-mode"];
    shareMode = flags["share-mode"];

	if (verbose) logger.setLogLevel(2);
	if (debug) 	 logger.setLogLevel(3);

    if (normalMode) currentMode = HackMode.Normal;
    if (stockMode) currentMode = HackMode.StockMarket;
    if (xpFarmMode) currentMode = HackMode.XPFarm;
    if (shareMode) currentMode = HackMode.ShareAll;

	// Helper output
	if (help) {
		ns.tprintf(
			`Hacking Daemon:\n`+
			`Description:\n` +
			`   Controls the flow of all Hacking scripts by assigning jobs.\n` +
			`   Has 4 modes: Normal, Stock Market, XP Farm, and Share.\n` +
			`Usage: run /hacking/hack-daemon-master.js [flags]\n` +
			`Flags:\n` +
			`   [--h or help]       : boolean |>> Prints this.\n` +
			`   [--v or --verbose]  : boolean |>> Sets logging level to 2 - more verbosing logging.\n` +
			`   [--d or --debug]    : boolean |>> Sets logging level to 3 - even more verbosing logging.\n` +
			`   [--normal-mode]     : boolean |>> Sets initial mode to Normal hacking mode.\n` +
			`   [--stock-mode]      : boolean |>> Sets initial mode to Stock Marking influcence mode.\n` +
			`   [--xp-farm-mode]    : boolean |>> Sets initial mode to XP Farm mode.\n` +
			`   [--share-mode]      : boolean |>> Sets initial mode to Share all RAM mode.`
		);

		return;
	}

    await setupEnvironment(ns);

	logger.initialisedMessage(true, false);

    await prepareHackingServers(ns);

    while (true) {

        await updateServerLists(ns);
        tryNukeServers(ns);
        await processOrderAssignments(ns);
        await ns.asleep(750);

    }
}
