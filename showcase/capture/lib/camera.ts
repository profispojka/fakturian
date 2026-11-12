import { clamp, ease, lerp } from './util.ts';

/**
 * Kamera: kam se dívat a jak blízko.
 *
 * Souřadnice jsou vždy v CSS pixelech **nezvětšené** stránky. Renderer mezi
 * dvěma stavy interpoluje, takže „přejezd na položku a přiblížení" je jeden
 * plynulý pohyb, ne skok.
 */
import type { Stage } from './browser.ts';

export const FULL_VIEW: StageCameraState = {
	zoom: 1,
	x: null,
	y: null,
};

interface CameraFocus {
	selector?: string;
	rect?: StageRect;
	x?: number;
	y?: number;
	zoom?: number;
	maxZoom?: number;
	padding?: number;
}

interface CameraDefaults {
	maxZoom?: number;
	padding?: number;
}

/**
 * Přeloží zápis ze scénáře na konkrétní stav kamery.
 *
 * `focus` může být: selektor, `{ selector, zoom, padding }`, `{ rect, zoom }`
 * nebo `{ x, y, zoom }`. Bez `focus` se kamera vrací na celý pohled.
 */
export async function resolveCamera(
	stage: Stage,
	focus: string | CameraFocus | null | undefined,
	defaults: CameraDefaults = {},
): Promise<StageCameraState> {
	const { page, viewport } = stage;
	if (!focus || focus === 'full') return { ...FULL_VIEW };

	const spec = typeof focus === 'string' ? { selector: focus } : focus;
	const maxZoom = spec.maxZoom ?? defaults.maxZoom ?? 2.6;
	const padding = spec.padding ?? defaults.padding ?? 64;

	if (typeof spec.x === 'number' && typeof spec.y === 'number') {
		return {
			x: spec.x,
			y: spec.y,
			zoom: clamp(spec.zoom ?? 1.6, 1, maxZoom),
		};
	}

	const rect =
		spec.rect ??
		(await page.evaluate((sel: string | undefined) => window.__stage?.measure(sel ?? '') ?? null, spec.selector));

	if (!rect) {
		throw new Error(`Kamera nenašla cíl: ${spec.selector ?? JSON.stringify(spec)}`);
	}

	const fitZoom = Math.min(
		viewport.width / Math.max(1, rect.width + padding * 2),
		viewport.height / Math.max(1, rect.height + padding * 2),
	);
	const zoom = clamp(spec.zoom ?? fitZoom, 1, maxZoom);

	// Střed cíle, ale tak, aby kamera nevyjela mimo stránku — prázdný pruh po
	// kraji vypadá jako chyba, i když je matematicky správně.
	const halfW = viewport.width / (2 * zoom);
	const halfH = viewport.height / (2 * zoom);
	const cx = clamp(rect.x + rect.width / 2, halfW, viewport.width - halfW);
	const cy = clamp(rect.y + rect.height / 2, halfH, viewport.height - halfH);

	return {
		x: cx,
		y: cy,
		zoom,
	};
}

function coord(value: number | null | undefined, fallback: number): number {
	return typeof value === 'number' ? value : fallback;
}

/** Mezistav mezi dvěma kamerami. Zoom se interpoluje logaritmicky — jinak se pohyb na konci „utrhne". */
export function lerpCamera(
	from: StageCameraState,
	to: StageCameraState,
	t: number,
	easing = 'easeInOutCubic',
	viewport: { width: number; height: number } | null = null,
): StageCameraState {
	const k = ease(easing, t);
	const W = viewport?.width ?? 0;
	const H = viewport?.height ?? 0;
	const fx = coord(from.x, W / 2);
	const fy = coord(from.y, H / 2);
	const tx = coord(to.x, W / 2);
	const ty = coord(to.y, H / 2);
	const zoom = Math.exp(lerp(Math.log(from.zoom ?? 1), Math.log(to.zoom ?? 1), k));
	return {
		x: lerp(fx, tx, k),
		y: lerp(fy, ty, k),
		zoom,
	};
}

export async function applyCamera(page: Stage['page'], cam: StageCameraState): Promise<void> {
	await page.evaluate((state: StageCameraState) => window.__stage?.camera(state), cam);
}

/** Kde na obrazovce je prvek právě teď (po transformu) — pro kurzor a klik. */
export async function screenRect(page: Stage['page'], selector: string): Promise<StageRect | null> {
	return await page.evaluate((sel: string) => window.__stage?.measureScreen(sel) ?? null, selector);
}

export function centerOf(rect: StageRect): { x: number; y: number } {
	return {
		x: rect.x + rect.width / 2,
		y: rect.y + rect.height / 2,
	};
}
