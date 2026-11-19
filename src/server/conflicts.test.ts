import { describe, expect, it } from 'vitest';
import { Extraction } from '@/contract/extraction';
import { emptyProfile, TravelProfile } from '@/contract/profile';
import { applyExtraction } from './conflicts';

const ex = (x: unknown) => Extraction.parse(x);
const profile = (p: Partial<TravelProfile> = {}): TravelProfile => ({ ...emptyProfile(), ...p });

describe('applyExtraction', () => {
    it('removing a stored dietary restriction creates a conflict and keeps the list', () => {
        const start = applyExtraction(profile(), ex({ add: { dietaryRestrictions: ['Vegetarian'] } }), 'm1').profile;
        const r = applyExtraction(start, ex({ remove: { dietaryRestrictions: ['vegetarian'] } }), 'm2');
        expect(r.profile.dietaryRestrictions).toEqual(['vegetarian']);
        expect(r.newConflicts).toEqual([
            { field: 'dietaryRestrictions', oldValue: ['vegetarian'], newValue: [], sourceMessageId: 'm2' },
        ]);
        expect(r.profile.pendingConflicts).toEqual(r.newConflicts);
    });

    it('ignores removal of items that are not stored', () => {
        const r = applyExtraction(profile(), ex({ remove: { preferredSeasons: ['winter'] } }), 'm1');
        expect(r.newConflicts).toEqual([]);
        expect(r.profile.pendingConflicts).toEqual([]);
    });

    it('season removal conflict lists remaining seasons', () => {
        const p = profile({ preferredSeasons: ['spring', 'fall'] });
        const r = applyExtraction(p, ex({ remove: { preferredSeasons: ['fall'] } }), 'm1');
        expect(r.newConflicts[0]).toMatchObject({ oldValue: ['spring', 'fall'], newValue: ['spring'] });
    });

    it('resolution keep new writes the proposed value and clears pending', () => {
        const p = profile({ budgetTier: 'budget' });
        const c = applyExtraction(p, ex({ set: { budgetTier: 'luxury' } }), 'm1').profile;
        const r = applyExtraction(c, ex({ resolutions: [{ field: 'budgetTier', keep: 'new' }] }), 'm2');
        expect(r.profile.budgetTier).toBe('luxury');
        expect(r.profile.pendingConflicts).toEqual([]);
    });

    it('resolution keep old leaves the value and clears pending', () => {
        const p = profile({ budgetTier: 'budget' });
        const c = applyExtraction(p, ex({ set: { budgetTier: 'luxury' } }), 'm1').profile;
        const r = applyExtraction(c, ex({ resolutions: [{ field: 'budgetTier', keep: 'old' }] }), 'm2');
        expect(r.profile.budgetTier).toBe('budget');
        expect(r.profile.pendingConflicts).toEqual([]);
    });

    it('keep new on a list conflict applies the reduced list', () => {
        const p = profile({ dietaryRestrictions: ['vegan', 'nut-free'] });
        const c = applyExtraction(p, ex({ remove: { dietaryRestrictions: ['vegan'] } }), 'm1').profile;
        const r = applyExtraction(c, ex({ resolutions: [{ field: 'dietaryRestrictions', keep: 'new' }] }), 'm2');
        expect(r.profile.dietaryRestrictions).toEqual(['nut-free']);
    });

    it('resolution without a matching pending conflict is ignored', () => {
        const r = applyExtraction(profile(), ex({ resolutions: [{ field: 'lodgingStyle', keep: 'new' }] }), 'm1');
        expect(r.profile).toEqual(profile());
    });

    it('sets an empty scalar directly, no-ops on equal, conflicts on different', () => {
        const a = applyExtraction(profile(), ex({ set: { lodgingStyle: 'hostel' } }), 'm1');
        expect(a.profile.lodgingStyle).toBe('hostel');
        expect(a.newConflicts).toEqual([]);
        const b = applyExtraction(a.profile, ex({ set: { lodgingStyle: 'hostel' } }), 'm2');
        expect(b.newConflicts).toEqual([]);
        const c = applyExtraction(b.profile, ex({ set: { lodgingStyle: 'resort' } }), 'm3');
        expect(c.profile.lodgingStyle).toBe('hostel');
        expect(c.newConflicts).toEqual([
            { field: 'lodgingStyle', oldValue: 'hostel', newValue: 'resort', sourceMessageId: 'm3' },
        ]);
    });

    it('displayName is last-write-wins', () => {
        const a = applyExtraction(profile(), ex({ set: { displayName: 'Ann' } }), 'm1').profile;
        const b = applyExtraction(a, ex({ set: { displayName: 'Anna' } }), 'm2');
        expect(b.profile.displayName).toBe('Anna');
        expect(b.newConflicts).toEqual([]);
    });

    it('lists merge additively, case-insensitively, trimmed lowercase, without conflicts', () => {
        const p = profile({ interests: ['hiking'] });
        const r = applyExtraction(
            p,
            ex({
                add: {
                    interests: [' Hiking ', 'Food'],
                    wishlistDestinations: ['Kyoto', 'kyoto'],
                    dietaryRestrictions: ['Vegan'],
                    preferredSeasons: ['spring', 'spring'],
                },
            }),
            'm1',
        );
        expect(r.profile.interests).toEqual(['hiking', 'food']);
        expect(r.profile.wishlistDestinations).toEqual(['kyoto']);
        expect(r.profile.dietaryRestrictions).toEqual(['vegan']);
        expect(r.profile.preferredSeasons).toEqual(['spring']);
        expect(r.newConflicts).toEqual([]);
    });

    it('replaces an existing pending conflict for the same field', () => {
        const p = profile({ budgetTier: 'budget' });
        const a = applyExtraction(p, ex({ set: { budgetTier: 'midRange' } }), 'm1').profile;
        const b = applyExtraction(a, ex({ set: { budgetTier: 'luxury' } }), 'm2');
        expect(b.profile.pendingConflicts).toHaveLength(1);
        expect(b.profile.pendingConflicts[0]).toMatchObject({ newValue: 'luxury', sourceMessageId: 'm2' });
        expect(b.newConflicts).toHaveLength(1);
    });

    it('newConflicts excludes already-pending ones', () => {
        const p = profile({ budgetTier: 'budget', travelCompanions: 'solo' });
        const a = applyExtraction(p, ex({ set: { budgetTier: 'luxury' } }), 'm1').profile;
        const b = applyExtraction(a, ex({ set: { travelCompanions: 'family' } }), 'm2');
        expect(b.profile.pendingConflicts).toHaveLength(2);
        expect(b.newConflicts.map((c) => c.field)).toEqual(['travelCompanions']);
    });

    it('does not mutate inputs', () => {
        const p = profile({ dietaryRestrictions: ['vegan'], budgetTier: 'budget' });
        const e = ex({ set: { budgetTier: 'luxury' }, add: { interests: ['x'] }, remove: { dietaryRestrictions: ['vegan'] } });
        const pSnap = structuredClone(p);
        const eSnap = structuredClone(e);
        applyExtraction(p, e, 'm1');
        expect(p).toEqual(pSnap);
        expect(e).toEqual(eSnap);
    });
});
