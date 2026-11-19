import { describe, expect, it } from 'vitest';
import { LineOneParser, type ParserOutput } from './line-one-parser';

function run(chunks: string[]): ParserOutput[] {
    const parser = new LineOneParser();
    const out: ParserOutput[] = [];
    for (const chunk of chunks) out.push(...parser.push(chunk));
    out.push(...parser.end());
    return out;
}

const prose = (out: ParserOutput[]) =>
    out.flatMap((o) => (o.kind === 'prose' ? [o.text] : [])).join('');
const extraction = (out: ParserOutput[]) => {
    const first = out[0];
    if (first?.kind !== 'extraction') throw new Error('extraction must come first');
    return first.extraction;
};

describe('LineOneParser', () => {
    it('handles a line split across chunks', () => {
        const out = run(['{"set":{"budg', 'etTier":"luxury"},"destin', 'ations":[]}', '\nNice', ' choice!']);
        expect(extraction(out)?.set.budgetTier).toBe('luxury');
        expect(prose(out)).toBe('Nice choice!');
        expect(out.filter((o) => o.kind === 'extraction')).toHaveLength(1);
    });

    it('strips a code-fenced line 1 and the closing fence', () => {
        const out = run(['```js', 'on\n{"add":{"interests":["hiking"]}}\n``', '`\n\nHiking it is.']);
        expect(extraction(out)?.add.interests).toEqual(['hiking']);
        expect(prose(out)).toBe('Hiking it is.');
    });

    it('handles leading blank lines and an inline fence', () => {
        const out = run(['\n\n```json {"set":{"displayName":"Ana"}}```\nHi Ana']);
        expect(extraction(out)?.set.displayName).toBe('Ana');
        expect(prose(out)).toBe('Hi Ana');
    });

    it('accepts a JSON line with no newline at all', () => {
        const out = run(['{"destinations":["Lisbon"]}']);
        expect(extraction(out)?.destinations).toEqual(['Lisbon']);
        expect(prose(out)).toBe('');
    });

    it('treats plain text with no newline as prose and no extraction', () => {
        const out = run(['Sounds fun, tell me more']);
        expect(extraction(out)).toBeNull();
        expect(prose(out)).toBe('Sounds fun, tell me more');
    });

    it('treats a garbage first line as no extraction and keeps it as prose', () => {
        const out = run(['Sounds great!\nWhere to?']);
        expect(extraction(out)).toBeNull();
        expect(prose(out)).toBe('Sounds great!\nWhere to?');
    });

    it('drops a malformed JSON line instead of showing it', () => {
        const out = run(['{"set": oops\nHello there']);
        expect(extraction(out)).toBeNull();
        expect(prose(out)).toBe('Hello there');
    });

    it('drops a line that fails the schema', () => {
        const out = run(['{"set":{"budgetTier":"cheap"}}\nHi']);
        expect(extraction(out)).toBeNull();
        expect(prose(out)).toBe('Hi');
    });

    it('returns destinations and fills defaults', () => {
        const out = run(['{"destinations":["Kyoto","Lisbon"]}\nBoth great.']);
        const ex = extraction(out);
        expect(ex?.destinations).toEqual(['Kyoto', 'Lisbon']);
        expect(ex?.resolutions).toEqual([]);
        expect(prose(out)).toBe('Both great.');
    });

    it('emits extraction for empty output', () => {
        expect(extraction(run([]))).toBeNull();
    });
});
