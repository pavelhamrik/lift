#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YahooFinance from 'yahoo-finance2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'tests', 'providers', 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

const SYMBOLS = ['^GSPC', 'SPY', 'AAPL', 'BRK.B'];

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const now = new Date();
const period1 = new Date(now);
period1.setUTCFullYear(period1.getUTCFullYear() - 1);
period1.setUTCDate(period1.getUTCDate() - 5);

for (const sym of SYMBOLS) {
	const safe = sym.replace(/[^A-Z0-9.\-^]/gi, '_');
	try {
		const data = await yf.chart(sym, {
			period1,
			period2: now,
			interval: '1d',
			return: 'array'
		});
		const file = path.join(OUT, `${safe}.json`);
		fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
		console.log(`recorded ${sym} -> ${file} (${data.quotes.length} bars)`);
	} catch (e) {
		console.error(`FAILED ${sym}:`, e?.message ?? e);
		process.exitCode = 1;
	}
}
