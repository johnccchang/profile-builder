import { Extraction } from '@/contract/extraction';

export type ParserOutput =
    | { kind: 'extraction'; extraction: Extraction | null }
    | { kind: 'prose'; text: string };

type Phase = 'head' | 'fence-close' | 'prose';

/**
 * Incremental splitter for "line 1 = JSON, rest = prose" model output.
 * Always emits exactly one `extraction` output first (null when line 1 is
 * missing or invalid), then prose deltas. Weak models wrap JSON in code fences
 * or add blank lines, so both are tolerated.
 */
export class LineOneParser {
    private phase: Phase = 'head';
    private buf = '';
    private fenced = false;
    private proseStarted = false;

    push(delta: string): ParserOutput[] {
        this.buf += delta;
        return this.drain(false);
    }

    /** Call once the stream ended so a reply without any newline is still flushed. */
    end(): ParserOutput[] {
        return this.drain(true);
    }

    private drain(final: boolean): ParserOutput[] {
        const out: ParserOutput[] = [];
        let progressed = true;
        while (progressed) {
            progressed = false;
            if (this.phase === 'head') progressed = this.head(out, final);
            else if (this.phase === 'fence-close') progressed = this.fenceClose(final);
            else progressed = this.prose(out);
        }
        return out;
    }

    private head(out: ParserOutput[], final: boolean): boolean {
        this.buf = this.buf.trimStart();
        if (this.buf === '') {
            if (!final) return false;
            return this.finishHead(out, null);
        }
        if (!this.fenced && this.buf.startsWith('```')) return this.openFence(final);
        if (!this.fenced && this.buf.length < 3 && '```'.startsWith(this.buf) && !final) return false;
        if (this.buf[0] !== '{') {
            // Cannot be an extraction. Stream it as prose right away so a
            // reply-only call does not wait for a newline before showing text.
            return this.finishHead(out, null);
        }
        const nl = this.buf.indexOf('\n');
        if (nl === -1 && !final) return false;
        const rawLine = nl === -1 ? this.buf : this.buf.slice(0, nl);
        const rest = nl === -1 ? '' : this.buf.slice(nl + 1);
        const closedInline = rawLine.trimEnd().endsWith('```');
        const parsed = parseLine(rawLine.trim().replace(/```$/, '').trim());
        this.buf = rest;
        this.phase = this.fenced && !closedInline ? 'fence-close' : 'prose';
        out.push({ kind: 'extraction', extraction: parsed });
        return true;
    }

    /** Switch to prose without consuming the buffer (line 1 was not JSON). */
    private finishHead(out: ParserOutput[], extraction: Extraction | null): boolean {
        this.phase = 'prose';
        out.push({ kind: 'extraction', extraction });
        return true;
    }

    private openFence(final: boolean): boolean {
        const nl = this.buf.indexOf('\n');
        if (nl === -1 && !final) return false;
        const fenceLine = nl === -1 ? this.buf : this.buf.slice(0, nl);
        const inline = fenceLine.replace(/^```[\w-]*/, '').trim();
        this.fenced = true;
        if (inline === '') {
            this.buf = nl === -1 ? '' : this.buf.slice(nl + 1);
        } else {
            this.buf = inline + (nl === -1 ? '' : this.buf.slice(nl));
        }
        return true;
    }

    /** Drops the closing ``` line that follows a fenced JSON line. */
    private fenceClose(final: boolean): boolean {
        this.buf = this.buf.trimStart();
        if (this.buf === '') {
            if (final) this.phase = 'prose';
            return false;
        }
        if (this.buf.length < 3 && '```'.startsWith(this.buf) && !final) return false;
        if (this.buf.startsWith('```')) {
            const nl = this.buf.indexOf('\n');
            if (nl === -1 && !final) return false;
            this.buf = nl === -1 ? '' : this.buf.slice(nl + 1);
        }
        this.phase = 'prose';
        return true;
    }

    private prose(out: ParserOutput[]): boolean {
        if (!this.proseStarted) this.buf = this.buf.trimStart();
        if (this.buf === '') return false;
        this.proseStarted = true;
        out.push({ kind: 'prose', text: this.buf });
        this.buf = '';
        return false;
    }
}

function parseLine(line: string): Extraction | null {
    try {
        const result = Extraction.safeParse(JSON.parse(line));
        return result.success ? result.data : null;
    } catch {
        return null;
    }
}
