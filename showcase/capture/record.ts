#!/usr/bin/env node
/**
 * Renderer prezentačních videí.
 *
 * Nenahrává obrazovku v reálném čase — **skládá video snímek po snímku**.
 * Pro každý snímek nastaví kameru, kurzor a titulek a teprve pak sejme
 * obrázek. Díky tomu je pohyb naprosto plynulý bez ohledu na to, jak rychle
 * appka reaguje, zoom je ostrý (prohlížeč obsah přerenderuje) a stejný scénář
 * dá pokaždé stejné video. Cenou je čas renderu — pár desítek sekund na klip.
 *
 * Použití:
 *   node capture/record.ts --scene showcase/scenes/invoice.ts [--out media/raw] [--headed]
 *
 * Výstup: adresář se snímky + `scene.json` (metadata pro encode.ts) + `.vtt`
 * titulky. Video z toho udělá `node capture/encode.ts`.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { closeStage, gotoPath, openStage, settle, type Stage, type StageConfig } from './lib/browser.ts';
import { applyCamera, centerOf, FULL_VIEW, lerpCamera, resolveCamera } from './lib/camera.ts';
import { clamp, ease, loadModule, logger, pad, parseArgs, resetDir } from './lib/util.ts';

const log = logger('record');

interface Point {
	x: number;
	y: number;
}

interface SceneStep {
	duration?: number;
	caption?: string;
	card?: StageCard;
	chapter?: string;
	goto?: string;
	before?: (page: Stage['page'], stage: Stage) => unknown;
	after?: (page: Stage['page'], stage: Stage) => unknown;
	scroll?: { y?: number; selector?: string; block?: ScrollLogicalPosition };
	waitFor?: string;
	focus?:
		| string
		| {
				selector?: string;
				rect?: StageRect;
				x?: number;
				y?: number;
				zoom?: number;
				maxZoom?: number;
				padding?: number;
		  }
		| null;
	click?: string;
	hover?: string;
	type?: { selector: string; text: string; clear?: boolean };
	press?: string;
	at?: number;
	easing?: string;
	chip?: string;
	settle?: boolean;
}

interface RecordConfig extends StageConfig {
	name?: string;
	stage?: string;
	url?: string;
	fps: number;
	duration: number;
	easing: string;
	cameraPortion: number;
	fadeFrames: number;
	actionAt: number;
	frameFormat: 'png' | 'jpeg';
	steps?: SceneStep[];
	maxZoom?: number;
	padding?: number;
}

interface OverlayFrame {
	caption: string;
	captionOpacity: number;
	chip: string;
	chipOpacity: number;
	card: StageCard | null;
	cardOpacity: number;
	cursor: Point | null;
	cursorOpacity: number;
	pressed: boolean;
	ripple: number | null;
}

const DEFAULTS = {
	fps: 30,
	duration: 1.8,
	easing: 'easeInOutCubic',
	cameraPortion: 0.72, // v jaké části beatu má kamera dojet na místo
	fadeFrames: 5,
	actionAt: 0.45,
	frameFormat: 'png',
} as const;

/** Kde je bod nezvětšené stránky vidět na obrazovce při dané kameře. */
function toScreen(point: Point, cam: StageCameraState, viewport: { width: number; height: number }): Point {
	const z = cam.zoom ?? 1;
	const cx = typeof cam.x === 'number' ? cam.x : viewport.width / 2;
	const cy = typeof cam.y === 'number' ? cam.y : viewport.height / 2;
	return {
		x: viewport.width / 2 - z * cx + z * point.x,
		y: viewport.height / 2 - z * cy + z * point.y,
	};
}

/** Náběh a doběh titulku uvnitř beatu. */
function fadeOpacity(
	frame: number,
	frames: number,
	fadeIn: boolean,
	fadeOut: boolean,
	fade = DEFAULTS.fadeFrames,
): number {
	const f = Math.min(fade, Math.floor(frames / 3) || 1);
	let o = 1;
	if (fadeIn && frame < f) o = ease('easeOutCubic', (frame + 1) / f);
	if (fadeOut && frame >= frames - f) o = Math.min(o, ease('easeOutCubic', (frames - frame) / f));
	return clamp(o, 0, 1);
}

function vttTime(sec: number): string {
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = (sec % 60).toFixed(3).padStart(6, '0');
	return `${pad(h, 2)}:${pad(m, 2)}:${s}`;
}

async function main() {
	const args = parseArgs();
	if (!args.scene) throw new Error('Chybí --scene <soubor.ts>');

	const scene = await loadModule<Partial<RecordConfig>>(args.scene);
	const base = scene.stage ? await loadModule<Partial<RecordConfig>>(scene.stage) : {};
	const cfg: RecordConfig = {
		...DEFAULTS,
		...base,
		...scene,
		viewport: scene.viewport ??
			base.viewport ?? {
				width: 1280,
				height: 800,
			},
		headed: args.headed === true,
	};

	const fps = cfg.fps;
	const name = cfg.name ?? path.basename(args.scene, '.ts');
	const outDir = path.resolve(process.cwd(), args.out ?? 'showcase/media/raw', name);
	await resetDir(outDir);

	const stage = await openStage(cfg);
	const { page, viewport } = stage;

	await gotoPath(stage, cfg.url ?? '/');

	let frameIndex = 0;
	let cam: StageCameraState = { ...FULL_VIEW };
	let cursor = {
		x: viewport.width * 0.5,
		y: viewport.height * 0.62,
	}; // v souřadnicích stránky
	let cursorVisible = false;
	const cues: { text: string; start: number; end: number }[] = [];
	const chapters: { title: string; time: number }[] = [];
	const steps = cfg.steps ?? [];
	const format = cfg.frameFormat;

	const shot = async () => {
		await page.screenshot({
			path: path.join(outDir, `${pad(frameIndex)}.${format === 'jpeg' ? 'jpg' : 'png'}`),
			type: format,
			...(format === 'jpeg' ? { quality: 95 } : {}),
			animations: 'disabled',
			caret: 'hide',
		});
		frameIndex++;
	};

	for (const [i, raw] of steps.entries()) {
		const step = { ...raw };
		const duration = step.duration ?? cfg.duration;
		const frames = Math.max(1, Math.round(duration * fps));
		const startSec = frameIndex / fps;
		log.step(i + 1, steps.length, step.caption ?? step.card?.title ?? step.goto ?? '(pohyb)');

		// --- akce, které musí proběhnout před snímkováním -------------------
		if (step.goto) {
			await gotoPath(stage, step.goto);
			cam = { ...FULL_VIEW };
			await applyCamera(page, cam);
		}
		if (step.before) await step.before(page, stage);
		if (step.scroll) {
			await page.evaluate((s: NonNullable<SceneStep['scroll']>) => {
				if (typeof s.y === 'number')
					window.scrollTo({
						top: s.y,
						behavior: 'instant',
					});
				else if (s.selector) document.querySelector(s.selector)?.scrollIntoView({ block: s.block ?? 'center' });
			}, step.scroll);
			await page.waitForTimeout(120);
		}
		if (step.waitFor) await page.waitForSelector(step.waitFor, { state: 'visible' });

		// --- cíl kamery a případný cíl kurzoru ------------------------------
		const camFrom = { ...cam };
		const camTo = await resolveCamera(stage, step.focus ?? null, cfg);
		const actionSelector = step.click ?? step.hover ?? step.type?.selector ?? null;
		let pointerTarget = null;
		if (actionSelector) {
			const rect = await page.evaluate((sel: string) => window.__stage?.measure(sel) ?? null, actionSelector);
			if (!rect) throw new Error(`Krok ${i + 1}: prvek ${actionSelector} na stránce není`);
			pointerTarget = centerOf(rect);
		}
		const cursorFrom = { ...cursor };
		const actionFrame = Math.round(frames * (step.at ?? cfg.actionAt));

		// --- titulky --------------------------------------------------------
		const prev = steps[i - 1];
		const next = steps[i + 1];
		const captionIn = Boolean(step.caption && step.caption !== prev?.caption);
		const captionOut = Boolean(step.caption && step.caption !== next?.caption);
		if (step.caption) {
			cues.push({
				text: step.caption,
				start: startSec,
				end: startSec + duration,
			});
		}
		const chapterTitle = step.chapter ?? step.card?.title;
		if (chapterTitle) {
			chapters.push({
				title: chapterTitle,
				time: startSec,
			});
		}

		let typed = 0;
		let clicked = false;

		for (let f = 0; f < frames; f++) {
			const t = frames === 1 ? 1 : f / (frames - 1);

			// kamera dojede dřív než beat skončí, aby záběr chvíli „stál"
			cam = lerpCamera(camFrom, camTo, clamp(t / cfg.cameraPortion, 0, 1), step.easing ?? cfg.easing, viewport);
			await applyCamera(page, cam);

			// kurzor: držíme ho v souřadnicích stránky, na obrazovku přepočítáme
			// podle aktuální kamery — při zoomu tak neuteče z tlačítka
			if (pointerTarget) {
				const k = ease('easeOutCubic', clamp(f / Math.max(1, actionFrame), 0, 1));
				cursor = {
					x: cursorFrom.x + (pointerTarget.x - cursorFrom.x) * k,
					y: cursorFrom.y + (pointerTarget.y - cursorFrom.y) * k,
				};
				cursorVisible = true;
			}
			const screen = toScreen(cursor, cam, viewport);

			// --- akce uprostřed beatu ---------------------------------------
			if (step.click && f === actionFrame && !clicked) {
				await page.mouse.click(screen.x, screen.y);
				clicked = true;
			}
			if (step.hover && f === actionFrame) await page.mouse.move(screen.x, screen.y);
			if (step.type && f === actionFrame && !clicked) {
				await page.mouse.click(screen.x, screen.y);
				if (step.type.clear) {
					await page.keyboard.press('ControlOrMeta+a');
					await page.keyboard.press('Delete');
				}
				clicked = true;
			}
			if (step.type && f > actionFrame) {
				// psaní rozprostřené do zbytku beatu — vypadá jako člověk, ne makro
				const span = Math.max(1, frames - actionFrame - Math.round(frames * 0.15));
				const want = Math.round(((f - actionFrame) / span) * step.type.text.length);
				while (typed < Math.min(want, step.type.text.length)) {
					await page.keyboard.type(step.type.text[typed]);
					typed++;
				}
			}
			if (step.press && f === actionFrame) await page.keyboard.press(step.press);

			// --- overlay -----------------------------------------------------
			const rippleAge = clicked ? (f - actionFrame) / (fps * 0.5) : null;
			await page.evaluate(
				(s: OverlayFrame) => {
					const st = window.__stage;
					st?.caption(s.caption, s.captionOpacity);
					st?.chip(s.chip, s.chipOpacity);
					if (s.card) st?.card(s.card, s.cardOpacity);
					else st?.card(null, 0);
					if (s.cursor)
						st?.cursor(s.cursor.x, s.cursor.y, {
							opacity: s.cursorOpacity,
							pressed: s.pressed,
						});
					else st?.hideCursor();
					st?.ripple(s.cursor?.x ?? 0, s.cursor?.y ?? 0, s.ripple);
				},
				{
					caption: step.caption ?? '',
					captionOpacity: step.caption ? fadeOpacity(f, frames, captionIn, captionOut) : 0,
					chip: step.chip ?? '',
					chipOpacity: step.chip ? fadeOpacity(f, frames, true, true) : 0,
					card: step.card ?? null,
					cardOpacity: step.card ? fadeOpacity(f, frames, true, true) : 0,
					cursor: cursorVisible && !step.card ? screen : null,
					cursorOpacity: 1,
					pressed: clicked && f >= actionFrame && f < actionFrame + 3,
					ripple: rippleAge !== null && rippleAge >= 0 && rippleAge < 1 ? rippleAge : null,
				},
			);

			await shot();
			if (frameIndex % 60 === 0) log.info(`${frameIndex} snímků (${(frameIndex / fps).toFixed(1)} s)`);
		}

		if (step.after) await step.after(page, stage);
		if (step.settle) await settle(stage);
	}

	const meta = {
		name,
		fps,
		frames: frameIndex,
		duration: frameIndex / fps,
		width: viewport.width * (cfg.deviceScaleFactor ?? 2),
		height: viewport.height * (cfg.deviceScaleFactor ?? 2),
		format,
		chapters,
		dir: outDir,
	};
	await writeFile(path.join(outDir, 'scene.json'), JSON.stringify(meta, null, 2));

	const vtt = `WEBVTT\n\n${cues
		.map((c, n) => `${n + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`)
		.join('\n')}`;
	await writeFile(path.join(outDir, `${name}.vtt`), vtt);

	await closeStage(stage);
	log.info(`hotovo: ${frameIndex} snímků (${meta.duration.toFixed(1)} s) → ${outDir}`);
	log.info(`dál:    node capture/encode.ts --frames ${path.relative(process.cwd(), outDir)}`);
}

try {
	await main();
} catch (e) {
	console.error(e);
	process.exit(1);
}
