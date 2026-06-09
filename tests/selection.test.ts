import { describe, it, expect } from 'vitest';
import { parseSelection, serializeSelection } from '../src/lib/selection.js';

describe('parseSelection (multi)', () => {
	it('round-trips a valid multi selection', () => {
		const s = {
			stocks: ['AAPL', 'MSFT'],
			compares: ['SPY' as const, 'QQQ' as const],
			range: '1Y' as const
		};
		expect(parseSelection(serializeSelection(s))).toEqual(s);
	});

	it('canonicalizes case + whitespace on read', () => {
		const raw = JSON.stringify({
			stocks: ['  aapl ', 'msft'],
			compares: ['spy'],
			range: '1y'
		});
		expect(parseSelection(raw)).toEqual({
			stocks: ['AAPL', 'MSFT'],
			compares: ['SPY'],
			range: '1Y'
		});
	});

	it('dedupes stocks and compares', () => {
		const raw = JSON.stringify({
			stocks: ['AAPL', 'aapl', 'MSFT'],
			compares: ['SPY', 'spy'],
			range: '1Y'
		});
		expect(parseSelection(raw)).toEqual({
			stocks: ['AAPL', 'MSFT'],
			compares: ['SPY'],
			range: '1Y'
		});
	});

	it('skips invalid stocks but keeps valid ones', () => {
		const raw = JSON.stringify({
			stocks: ['AAPL', 'AA!', ''],
			compares: ['SPY'],
			range: '1Y'
		});
		expect(parseSelection(raw)).toEqual({
			stocks: ['AAPL'],
			compares: ['SPY'],
			range: '1Y'
		});
	});

	it('skips compares outside the allowlist', () => {
		const raw = JSON.stringify({
			stocks: ['AAPL'],
			compares: ['SPY', 'NOPE'],
			range: '1Y'
		});
		expect(parseSelection(raw)).toEqual({
			stocks: ['AAPL'],
			compares: ['SPY'],
			range: '1Y'
		});
	});

	it('migrates legacy single-pair shape', () => {
		const raw = JSON.stringify({ symbol: 'AAPL', benchmark: 'SPY', range: '1Y' });
		expect(parseSelection(raw)).toEqual({
			stocks: ['AAPL'],
			compares: ['SPY'],
			range: '1Y'
		});
	});

	it('rejects when no valid stocks remain', () => {
		const raw = JSON.stringify({ stocks: ['AA!'], compares: ['SPY'], range: '1Y' });
		expect(parseSelection(raw)).toBeNull();
	});

	it('rejects unknown range', () => {
		const raw = JSON.stringify({ stocks: ['AAPL'], compares: ['SPY'], range: '3D' });
		expect(parseSelection(raw)).toBeNull();
	});

	it('rejects null / empty / malformed', () => {
		expect(parseSelection(null)).toBeNull();
		expect(parseSelection('')).toBeNull();
		expect(parseSelection('{not json')).toBeNull();
	});

	it('accepts an exotic benchmark and dotted-class symbol', () => {
		const raw = JSON.stringify({
			stocks: ['BRK.B'],
			compares: ['000300.SS'],
			range: 'YTD'
		});
		expect(parseSelection(raw)).toEqual({
			stocks: ['BRK.B'],
			compares: ['000300.SS'],
			range: 'YTD'
		});
	});
});
