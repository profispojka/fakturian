/**
 * Sdílené drobnosti pro capture toolkit.
 *
 * Bez závislostí — jediné, co toolkit potřebuje navíc, je `playwright`
 * a `ffmpeg` v PATH.
 */
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs as parseNodeArgs } from 'node:util';

/** `--config foo.ts --only hero --headed` → { config: 'foo.ts', only: 'hero', headed: true } */
export function parseArgs(args = process.argv.slice(2)) {
	return parseNodeArgs({
		args,
		options: {
			config: { type: 'string' },
			scene: { type: 'string' },
			out: { type: 'string' },
			only: { type: 'string' },
			frames: { type: 'string' },
			dist: { type: 'string' },
			crf: { type: 'string' },
			gif: { type: 'boolean' },
			gifFps: { type: 'string' },
			gifWidth: { type: 'string' },
			music: { type: 'string' },
			musicVolume: { type: 'string' },
			poster: { type: 'string' },
			webm: { type: 'string' },
			webmCrf: { type: 'string' },
			width: { type: 'string' },
			dir: { type: 'string' },
			port: { type: 'string' },
			headed: { type: 'boolean' },
		},
	}).values;
}

/** Načte ESM konfigurák podle cesty relativní k cwd. */
export async function loadModule<T = Record<string, unknown>>(file: string): Promise<T> {
	const abs = path.resolve(process.cwd(), file);
	const mod = await import(pathToFileURL(abs).href);
	return (mod.default ?? mod) as T;
}

export async function ensureDir(dir: string): Promise<string> {
	await mkdir(dir, { recursive: true });
	return dir;
}

/** Vyprázdní adresář (framy mezi běhy nesmí zůstat — enkodér by je vzal taky). */
export async function resetDir(dir: string): Promise<string> {
	await rm(dir, {
		recursive: true,
		force: true,
	});
	return ensureDir(dir);
}

export const pad = (n: number, width = 5): string => String(n).padStart(width, '0');

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Easing funkce. `easeInOutCubic` je výchozí pro kameru: rozjezd i dojezd
 * jsou měkké, takže zoom nepůsobí jako střih.
 */
export const easings = {
	linear: (t: number) => t,
	easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
	easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
	easeOutExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
	easeInOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
};

function isEasingName(name: string): name is keyof typeof easings {
	return Object.hasOwn(easings, name);
}

export function ease(name: string, t: number): number {
	const fn = isEasingName(name) ? easings[name] : easings.easeInOutCubic;
	return fn(clamp(t, 0, 1));
}

/** Konzolový log s prefixem, ať je v CI poznat, který krok mluví. */
export function logger(scope: string) {
	return {
		info: (...args: unknown[]) => console.log(`[${scope}]`, ...args),
		warn: (...args: unknown[]) => console.warn(`[${scope}]`, ...args),
		step: (i: number, total: number, ...args: unknown[]) => console.log(`[${scope}] ${i}/${total}`, ...args),
	};
}

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Doplní obdélník na požadovaný poměr stran (kolem středu), ořízne na viewport. */
export function fitRatio(rect: Rect, ratio?: string | number, bounds?: Pick<Rect, 'width' | 'height'>): Rect {
	if (!ratio) return rect;
	const [rw, rh] = String(ratio).split(/[:/]/).map(Number);
	const target = rw / rh;
	let { x, y, width, height } = rect;
	const cx = x + width / 2;
	const cy = y + height / 2;
	if (width / height < target) width = height * target;
	else height = width / target;
	x = cx - width / 2;
	y = cy - height / 2;
	if (bounds) {
		width = Math.min(width, bounds.width);
		height = Math.min(height, bounds.height);
		x = clamp(x, 0, bounds.width - width);
		y = clamp(y, 0, bounds.height - height);
	}
	return {
		x: Math.round(x),
		y: Math.round(y),
		width: Math.round(width),
		height: Math.round(height),
	};
}
