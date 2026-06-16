import {
	createChart,
	CrosshairMode,
	LineSeries,
	LineStyle,
	HistogramSeries,
	type IChartApi,
	type ISeriesApi,
	type LineData,
	type HistogramData,
	type MouseEventParams,
	type Time,
	type UTCTimestamp
} from 'lightweight-charts';
import type { SeriesKind } from '$lib/providers/types.js';

export type ThemeMode = 'light' | 'dark';
export type { SeriesKind };

export type ChartTheme = {
	bg: string;
	fg: string;
	grid: string;
	muted: string;
	volumeColor: string;
};

export type SeriesSpec = {
	symbol: string;
	kind: SeriesKind;
	color: string;
	data: { time: number; value: number }[];
};

type Entry = {
	kind: SeriesKind;
	color: string;
	api: ISeriesApi<'Line'>;
};

export type SeriesEntry = {
	symbol: string;
	kind: SeriesKind;
	color: string;
	api: ISeriesApi<'Line'>;
};

export type ChartHandles = {
	chart: IChartApi;
	volume: ISeriesApi<'Histogram'>;
	setSeries: (specs: SeriesSpec[]) => void;
	setVolume: (data: { time: number; volume: number }[]) => void;
	applyTheme: (theme: ChartTheme) => void;
	getLineSeriesEntries: () => SeriesEntry[];
	dispose: () => void;
};

const STOCK_PALETTE_SLOTS: string[] = [
	// Base shade (500)
	'--color-target', // our custom primary
	'#f59e0b', // amber-500
	'#0ea5e9', // sky-500
	'#a855f7', // purple-500
	'#84cc16', // lime-500
	'#ec4899', // pink-500
	'#6366f1', // indigo-500
	// One shade darker (600)
	'#ea580c', // orange-600
	'#16a34a', // green-600
	'#ca8a04', // yellow-600
	'#2563eb', // blue-600
	'#7c3aed', // violet-600
	'#c026d3', // fuchsia-600
	'#e11d48' // rose-600
];

const COMPARE_PALETTE_SLOTS: string[] = [
	'--color-benchmark',
	'#9ca3af',
	'#4b5563',
	'#71717a',
	'#a1a1aa',
	'#525252',
	'#404040',
	'#d4d4d8'
];

function resolveColorSlot(slot: string, fallback: string, root: HTMLElement): string {
	if (slot.startsWith('--')) {
		const v = getComputedStyle(root).getPropertyValue(slot).trim();
		return v || fallback;
	}
	return slot;
}

export function colorForSeries(
	kind: SeriesKind,
	indexInKind: number,
	root: HTMLElement = document.documentElement
): string {
	const palette = kind === 'equity' ? STOCK_PALETTE_SLOTS : COMPARE_PALETTE_SLOTS;
	const slot = palette[indexInKind % palette.length];
	const fallback = kind === 'equity' ? '#0ea5e9' : '#6b7280';
	return resolveColorSlot(slot, fallback, root);
}

export function readTheme(root: HTMLElement = document.documentElement): ChartTheme {
	const cs = getComputedStyle(root);
	return {
		bg: cs.getPropertyValue('--color-background').trim() || '#ffffff',
		fg: cs.getPropertyValue('--color-foreground').trim() || '#111111',
		grid: cs.getPropertyValue('--color-grid').trim() || '#e5e5e5',
		muted: cs.getPropertyValue('--color-muted-foreground').trim() || '#888888',
		volumeColor: cs.getPropertyValue('--color-volume').trim() || 'rgba(25, 204, 177, 0.45)'
	};
}

export function mountChart(container: HTMLElement, theme: ChartTheme): ChartHandles {
	const chart = createChart(container, {
		layout: {
			background: { color: theme.bg },
			textColor: theme.fg,
			fontFamily: 'inherit',
			attributionLogo: false
		},
		rightPriceScale: { borderColor: theme.grid, tickMarkDensity: 4 },
		timeScale: {
			borderColor: theme.grid,
			timeVisible: true,
			secondsVisible: false,
			fixLeftEdge: true,
			fixRightEdge: true
		},
		grid: {
			vertLines: { visible: false },
			horzLines: { color: theme.grid }
		},
		crosshair: { mode: CrosshairMode.Normal },
		autoSize: true
	});

	const entries = new Map<string, Entry>();

	const volume = chart.addSeries(HistogramSeries, {
		color: theme.volumeColor,
		priceFormat: { type: 'volume' },
		priceScaleId: 'volume'
	});
	chart.priceScale('volume').applyOptions({
		scaleMargins: { top: 0.82, bottom: 0 },
		borderColor: theme.grid
	});

	function lineOptions(kind: SeriesKind, color: string) {
		return {
			color,
			lineWidth: (kind === 'equity' ? 2 : 1.5) as 1 | 2 | 3 | 4,
			lineStyle: kind === 'equity' ? LineStyle.Solid : LineStyle.Dashed,
			priceFormat: {
				type: 'custom' as const,
				formatter: (v: number) => `${v.toFixed(2)}%`,
				minMove: 0.01
			},
			priceScaleId: 'right'
		};
	}

	function setSeries(specs: SeriesSpec[]) {
		const keep = new Set(specs.map((s) => s.symbol));
		for (const [sym, entry] of entries) {
			if (!keep.has(sym)) {
				chart.removeSeries(entry.api);
				entries.delete(sym);
			}
		}
		const ordered: Array<[string, Entry]> = [];
		for (const spec of specs) {
			let entry = entries.get(spec.symbol);
			if (!entry) {
				const api = chart.addSeries(LineSeries, lineOptions(spec.kind, spec.color));
				entry = { kind: spec.kind, color: spec.color, api };
			} else {
				entry.kind = spec.kind;
				entry.color = spec.color;
				entry.api.applyOptions(lineOptions(spec.kind, spec.color));
			}
			entry.api.setData(
				spec.data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })) as LineData[]
			);
			ordered.push([spec.symbol, entry]);
		}
		entries.clear();
		for (const [sym, entry] of ordered) entries.set(sym, entry);
		const maxBars = specs.reduce((m, s) => Math.max(m, s.data.length), 0);
		if (maxBars > 0) {
			const margin = Math.max(2, Math.round(maxBars * 0.04));
			chart.timeScale().setVisibleLogicalRange({
				from: -margin,
				to: maxBars - 1 + margin
			});
		}
	}

	function setVolume(data: { time: number; volume: number }[]) {
		const out: HistogramData[] = data.map((v) => ({
			time: v.time as UTCTimestamp,
			value: v.volume
		}));
		volume.setData(out);
	}

	function applyTheme(t: ChartTheme) {
		chart.applyOptions({
			layout: {
				background: { color: t.bg },
				textColor: t.fg,
				fontFamily: 'inherit',
				attributionLogo: false
			},
			rightPriceScale: { borderColor: t.grid, tickMarkDensity: 4 },
			timeScale: { borderColor: t.grid },
			grid: { vertLines: { visible: false }, horzLines: { color: t.grid } }
		});
		volume.applyOptions({ color: t.volumeColor });
		chart.priceScale('volume').applyOptions({ borderColor: t.grid });
	}

	function getLineSeriesEntries(): SeriesEntry[] {
		return [...entries].map(([symbol, e]) => ({
			symbol,
			kind: e.kind,
			color: e.color,
			api: e.api
		}));
	}

	return {
		chart,
		volume,
		setSeries,
		setVolume,
		applyTheme,
		getLineSeriesEntries,
		dispose: () => chart.remove()
	};
}

export type TooltipValue = {
	symbol: string;
	kind: SeriesKind;
	color: string;
	value?: number;
};

export type TooltipPayload = {
	time: number;
	values: TooltipValue[];
	volume?: number;
	x: number;
	y: number;
} | null;

export function subscribeTooltip(
	handles: ChartHandles,
	container: HTMLElement,
	getAnchorSymbol: () => string | undefined,
	cb: (p: TooltipPayload) => void
): () => void {
	const handler = (param: MouseEventParams<Time>) => {
		const { width, height } = container.getBoundingClientRect();
		if (
			!param.point ||
			!param.time ||
			param.point.x < 0 ||
			param.point.y < 0 ||
			param.point.x > width ||
			param.point.y > height
		) {
			cb(null);
			return;
		}
		const entries = handles.getLineSeriesEntries();
		const values: TooltipValue[] = entries.map((e) => {
			const d = param.seriesData.get(e.api) as LineData | undefined;
			return {
				symbol: e.symbol,
				kind: e.kind,
				color: e.color,
				value: typeof d?.value === 'number' ? d.value : undefined
			};
		});
		const volData = param.seriesData.get(handles.volume) as HistogramData | undefined;
		const anchor = getAnchorSymbol();
		const anchorEntry = anchor ? entries.find((e) => e.symbol === anchor) : undefined;
		const anchorVal = anchorEntry
			? ((param.seriesData.get(anchorEntry.api) as LineData | undefined)?.value as
					| number
					| undefined)
			: undefined;
		const yOnAnchor =
			typeof anchorVal === 'number' ? anchorEntry!.api.priceToCoordinate(anchorVal) : null;
		cb({
			time: Number(param.time),
			values,
			volume: typeof volData?.value === 'number' ? volData.value : undefined,
			x: param.point.x,
			y: yOnAnchor ?? param.point.y
		});
	};
	handles.chart.subscribeCrosshairMove(handler);
	return () => handles.chart.unsubscribeCrosshairMove(handler);
}
