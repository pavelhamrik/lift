import { browser } from '$app/environment';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
const STORAGE_KEY = 'theme-mode';

function readStored(): ThemeMode {
	if (!browser) return 'system';
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
	} catch {
		return 'system';
	}
}

function prefersDark(): boolean {
	if (!browser) return false;
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
	if (mode === 'system') return prefersDark() ? 'dark' : 'light';
	return mode;
}

function applyTheme(resolved: ResolvedTheme) {
	if (!browser) return;
	document.documentElement.setAttribute('data-theme', resolved);
}

export class ThemeStore {
	mode = $state<ThemeMode>(readStored());
	resolved = $state<ResolvedTheme>(resolveTheme(readStored()));
	private mql: MediaQueryList | null = null;
	private onSystemChange = () => {
		if (this.mode === 'system') {
			const next: ResolvedTheme = prefersDark() ? 'dark' : 'light';
			this.resolved = next;
			applyTheme(next);
		}
	};

	constructor() {
		if (browser) {
			this.mql = window.matchMedia('(prefers-color-scheme: dark)');
			this.mql.addEventListener('change', this.onSystemChange);
			applyTheme(this.resolved);
		}
	}

	setMode(next: ThemeMode) {
		this.mode = next;
		try {
			if (browser) localStorage.setItem(STORAGE_KEY, next);
		} catch {
			/* ignore */
		}
		const r = resolveTheme(next);
		this.resolved = r;
		applyTheme(r);
	}

	destroy() {
		if (browser && this.mql) this.mql.removeEventListener('change', this.onSystemChange);
	}
}

export function createThemeStore(): ThemeStore {
	return new ThemeStore();
}
