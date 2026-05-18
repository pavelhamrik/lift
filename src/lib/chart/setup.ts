import {
	createChart,
	CrosshairMode,
	LineSeries,
	HistogramSeries,
	type IChartApi,
	type ISeriesApi,
	type LineData,
	type HistogramData,
	type UTCTimestamp
} from 'lightweight-charts';

export type ThemeMode = 'light' | 'dark';

export type ChartPalette = {
	bg: string;
	fg: string;
	grid: string;
	target: string;
	benchmark: string;
	muted: string;
};

export type ChartHandles = {
	chart: IChartApi;
	target: ISeriesApi<'Line'>;
	benchmark: ISeriesApi<'Line'>;
	volume: ISeriesApi<'Histogram'>;
	applyPalette: (p: ChartPalette) => void;
	dispose: () => void;
};

export function readPalette(root: HTMLElement = document.documentElement): ChartPalette {
	const cs = getComputedStyle(root);
	return {
		bg: cs.getPropertyValue('--color-bg').trim() || '#ffffff',
		fg: cs.getPropertyValue('--color-fg').trim() || '#111111',
		grid: cs.getPropertyValue('--color-grid').trim() || '#e5e5e5',
		target: cs.getPropertyValue('--color-target').trim() || '#ef6c00',
		benchmark: cs.getPropertyValue('--color-benchmark').trim() || '#777777',
		muted: cs.getPropertyValue('--color-muted-fg').trim() || '#888888'
	};
}

export function mountChart(container: HTMLElement, palette: ChartPalette): ChartHandles {
	const chart = createChart(container, {
		layout: {
			background: { color: palette.bg },
			textColor: palette.fg,
			fontFamily: 'inherit'
		},
		rightPriceScale: { borderColor: palette.grid },
		timeScale: { borderColor: palette.grid, timeVisible: true, secondsVisible: false },
		grid: {
			vertLines: { color: palette.grid },
			horzLines: { color: palette.grid }
		},
		crosshair: { mode: CrosshairMode.Normal },
		autoSize: true
	});

	const target = chart.addSeries(LineSeries, {
		color: palette.target,
		lineWidth: 2,
		priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(2)}%`, minMove: 0.01 },
		priceScaleId: 'right'
	});
	const benchmark = chart.addSeries(LineSeries, {
		color: palette.benchmark,
		lineWidth: 2,
		priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(2)}%`, minMove: 0.01 },
		priceScaleId: 'right'
	});

	const volume = chart.addSeries(HistogramSeries, {
		color: palette.muted,
		priceFormat: { type: 'volume' },
		priceScaleId: 'volume'
	});
	chart.priceScale('volume').applyOptions({
		scaleMargins: { top: 0.82, bottom: 0 },
		borderColor: palette.grid
	});

	function applyPalette(p: ChartPalette) {
		chart.applyOptions({
			layout: { background: { color: p.bg }, textColor: p.fg, fontFamily: 'inherit' },
			rightPriceScale: { borderColor: p.grid },
			timeScale: { borderColor: p.grid },
			grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } }
		});
		target.applyOptions({ color: p.target });
		benchmark.applyOptions({ color: p.benchmark });
		volume.applyOptions({ color: p.muted });
		chart.priceScale('volume').applyOptions({ borderColor: p.grid });
	}

	return {
		chart,
		target,
		benchmark,
		volume,
		applyPalette,
		dispose: () => chart.remove()
	};
}

export function setPriceSeries(
	handles: ChartHandles,
	target: { time: number; value: number }[],
	benchmark: { time: number; value: number }[]
) {
	handles.target.setData(target.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })) as LineData[]);
	handles.benchmark.setData(
		benchmark.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })) as LineData[]
	);
	handles.chart.timeScale().fitContent();
}

export function setVolumeSeries(
	handles: ChartHandles,
	volume: { time: number; volume: number }[]
) {
	const data: HistogramData[] = volume.map((v) => ({
		time: v.time as UTCTimestamp,
		value: v.volume
	}));
	handles.volume.setData(data);
}
