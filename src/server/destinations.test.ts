import { describe, expect, it } from 'vitest';
import { getDestinationInfo, KNOWN_DESTINATIONS } from './destinations';

describe('getDestinationInfo', () => {
    it('finds known destinations case/whitespace/diacritic-insensitively', async () => {
        expect((await getDestinationInfo('  kyoto '))?.name).toBe('Kyoto');
        expect((await getDestinationInfo('REYKJAVÍK'))?.name).toBe('Reykjavik');
    });

    it('resolves aliases', async () => {
        expect((await getDestinationInfo('Kyoto Japan'))?.name).toBe('Kyoto');
        expect((await getDestinationInfo('CDMX'))?.name).toBe('Mexico City');
    });

    it('returns null for unknown names', async () => {
        expect(await getDestinationInfo('Atlantis')).toBeNull();
        expect(await getDestinationInfo('')).toBeNull();
    });

    it('has well-formed data for every listed destination', async () => {
        expect(KNOWN_DESTINATIONS.length).toBeGreaterThanOrEqual(6);
        for (const n of KNOWN_DESTINATIONS) {
            const info = await getDestinationInfo(n);
            expect(info?.bestSeasons.length).toBeGreaterThan(0);
            expect(info!.averageDailyBudgetUSD.budget).toBeLessThan(info!.averageDailyBudgetUSD.luxury);
        }
    });
});
