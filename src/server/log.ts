/** One JSON line per event on stdout; easy to grep and to ship to a log collector. */
export function log(event: Record<string, unknown>): void {
    process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
}
