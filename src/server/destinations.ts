import type { DestinationInfo } from '@/contract/destination';
import type { GetDestinationInfo } from '@/contract/ports';

type Entry = { info: DestinationInfo; aliases: string[] };

const ENTRIES: Entry[] = [
    {
        info: {
            name: 'Kyoto',
            bestSeasons: ['spring', 'fall'],
            knownFor: ['temples and shrines', 'cherry blossoms', 'kaiseki dining', 'geisha districts'],
            averageDailyBudgetUSD: { budget: 70, midRange: 160, luxury: 450 },
            visaNotes: 'Many Western passports get 90 days visa-free; check your nationality.',
        },
        aliases: ['kyoto japan', 'kyoto, japan'],
    },
    {
        info: {
            name: 'Lisbon',
            bestSeasons: ['spring', 'fall'],
            knownFor: ['tiled streets and trams', 'pastel de nata', 'fado music', 'day trips to Sintra'],
            averageDailyBudgetUSD: { budget: 60, midRange: 140, luxury: 350 },
            visaNotes: 'Schengen area: 90 days visa-free for many nationalities.',
        },
        aliases: ['lisboa', 'lisbon portugal'],
    },
    {
        info: {
            name: 'Reykjavik',
            bestSeasons: ['summer', 'winter'],
            knownFor: ['northern lights', 'geothermal pools', 'glaciers and waterfalls', 'midnight sun'],
            averageDailyBudgetUSD: { budget: 120, midRange: 250, luxury: 600 },
            visaNotes: 'Schengen area: 90 days visa-free for many nationalities.',
        },
        aliases: ['reykjavik iceland', 'iceland'],
    },
    {
        info: {
            name: 'Bali',
            bestSeasons: ['spring', 'summer', 'fall'],
            knownFor: ['surf beaches', 'rice terraces', 'temples', 'yoga retreats'],
            averageDailyBudgetUSD: { budget: 40, midRange: 110, luxury: 400 },
            visaNotes: 'Visa on arrival available for many nationalities; fee applies.',
        },
        aliases: ['bali indonesia', 'ubud'],
    },
    {
        info: {
            name: 'Mexico City',
            bestSeasons: ['spring', 'fall'],
            knownFor: ['street food and tacos', 'museums', 'Aztec history', 'vibrant neighborhoods'],
            averageDailyBudgetUSD: { budget: 50, midRange: 120, luxury: 330 },
            visaNotes: 'Many nationalities can visit visa-free for up to 180 days.',
        },
        aliases: ['cdmx', 'ciudad de mexico', 'mexico df', 'mexico city mexico'],
    },
    {
        info: {
            name: 'Cape Town',
            bestSeasons: ['spring', 'summer'],
            knownFor: ['Table Mountain', 'wine regions', 'coastal drives', 'penguin colonies'],
            averageDailyBudgetUSD: { budget: 55, midRange: 130, luxury: 380 },
            visaNotes: 'Many nationalities get 90 days visa-free; check passport validity rules.',
        },
        aliases: ['cape town south africa', 'capetown'],
    },
];

/** Lowercase, strip diacritics, collapse punctuation and whitespace so "Reykjavík " matches. */
function normalize(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

const INDEX = new Map<string, DestinationInfo>();
for (const { info, aliases } of ENTRIES) {
    for (const key of [info.name, ...aliases]) INDEX.set(normalize(key), info);
}

export const KNOWN_DESTINATIONS: string[] = ENTRIES.map((e) => e.info.name);

export const getDestinationInfo: GetDestinationInfo = async (name) => {
    const info = INDEX.get(normalize(name));
    // Copy so callers cannot mutate the shared table.
    return info ? structuredClone(info) : null;
};
