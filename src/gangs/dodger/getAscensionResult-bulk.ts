import { NS } from '@ns'

export async function main(ns : NS) : Promise<void> {
    const uid = ns.args[0] as number;
    const memberNames : string[] = JSON.parse(ns.args[1] as string);

    const result = [];

    for (const member of memberNames) {
        result.push({
            name: member,
            result: ns.gang.getAscensionResult(member)
        });
    }

    const filename = `/tmp/${uid}.txt`;
    ns.write(filename, JSON.stringify(result), 'w');
}
