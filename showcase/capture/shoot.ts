#!/usr/bin/env node
/**
 * Screenshoty produktu podle configu — celé obrazovky, výřezy na jednu funkci
 * i „přiblížené" záběry.
 *
 * Použití:
 *   node capture/shoot.ts --config showcase/shots.config.ts [--only dashboard] [--headed]
 *
 * Konvence: `<outDir>/<name>.png`, u více motivů `<name>.dark.png`.
 * Obrázky se ukládají v deviceScaleFactor (typicky 2×) — web je pak zobrazuje
 * v poloviční šířce, takže jsou ostré i na retině.
 */
import path from 'node:path';

import { closeStage, gotoPath, openStage, setTheme, settle, type Stage, type StageConfig } from './lib/browser.ts';
import { applyCamera, resolveCamera } from './lib/camera.ts';
import { ensureDir, fitRatio, loadModule, logger, parseArgs } from './lib/util.ts';

const log = logger('shoot');

interface Shot {
	name: string;
	path?: string;
	group?: string;
	waitFor?: string;
	scroll?: { y?: number; selector?: string; block?: ScrollLogicalPosition };
	fullPage?: boolean;
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
		  };
	crop?: string | { selector: string; padding?: number; ratio?: string };
	before?: (page: Stage['page'], stage: Stage) => unknown;
	after?: (page: Stage['page'], stage: Stage) => unknown;
}

interface ShootConfig extends StageConfig {
	outDir?: string;
	themes?: ('light' | 'dark')[];
	continueOnError?: boolean;
	entry?: string;
	shots: Shot[];
	maxZoom?: number;
	padding?: number;
}

async function capture(
	stage: Stage,
	shot: Shot,
	cfg: ShootConfig,
	outDir: string,
	theme: 'light' | 'dark',
	multiTheme: boolean,
): Promise<string> {
	const { page, viewport } = stage;

	if (shot.path !== undefined) await gotoPath(stage, shot.path);
	else await settle(stage);

	if (shot.before) await shot.before(page, stage);
	if (shot.waitFor) await page.waitForSelector(shot.waitFor, { state: 'visible' });
	if (shot.scroll) {
		await page.evaluate((s: NonNullable<Shot['scroll']>) => {
			if (typeof s.y === 'number')
				window.scrollTo({
					top: s.y,
					behavior: 'instant',
				});
			else if (s.selector) document.querySelector(s.selector)?.scrollIntoView({ block: s.block ?? 'center' });
		}, shot.scroll);
		await page.waitForTimeout(150);
	}

	// Overlay (kurzor, titulky) do statických obrázků nepatří.
	await page.evaluate(() => {
		window.__stage?.reset();
		window.__stage?.hide();
	});

	// U snímku celé stránky nejdřív projeď obsah, ať se dotáhnou obrázky
	// s `loading="lazy"` — jinak zůstanou v dolní části prázdná místa.
	if (shot.fullPage) {
		await page.evaluate(async () => {
			const step = window.innerHeight * 0.8;
			for (let y = 0; y < document.body.scrollHeight; y += step) {
				window.scrollTo(0, y);
				await new Promise((r) => setTimeout(r, 60));
			}
			window.scrollTo(0, 0);
		});
		await page.waitForTimeout(400);
	}

	// „Zoom" záběr: přiblíží prohlížeč, ne obrázek — text zůstane ostrý.
	if (shot.focus) {
		const cam = await resolveCamera(stage, shot.focus, cfg);
		await applyCamera(page, cam);
		await page.waitForTimeout(120);
	}

	const suffix = multiTheme && theme !== (cfg.themes?.[0] ?? 'light') ? `.${theme}` : '';
	const file = path.join(outDir, `${shot.name}${suffix}.png`);

	let clip;
	if (shot.crop) {
		const spec = typeof shot.crop === 'string' ? { selector: shot.crop } : shot.crop;
		const rect = await page.evaluate((sel: string) => window.__stage?.measureScreen(sel) ?? null, spec.selector);
		if (!rect) throw new Error(`Výřez nenašel prvek: ${spec.selector}`);
		const pad = spec.padding ?? 24;
		clip = fitRatio(
			{
				x: rect.x - pad,
				y: rect.y - pad,
				width: rect.width + pad * 2,
				height: rect.height + pad * 2,
			},
			spec.ratio,
			viewport,
		);
	}

	await page.screenshot({
		path: file,
		fullPage: shot.fullPage ?? false,
		clip,
		animations: 'disabled',
		caret: 'hide',
		type: 'png',
	});

	if (shot.focus) await applyCamera(page, { zoom: 1 });
	await page.evaluate(() => window.__stage?.show());
	if (shot.after) await shot.after(page, stage);
	return file;
}

async function main() {
	const args = parseArgs();
	if (!args.config) throw new Error('Chybí --config <soubor.ts>');

	const cfg = await loadModule<ShootConfig>(args.config);
	const themes = cfg.themes ?? ['light'];
	const outDir = await ensureDir(path.resolve(process.cwd(), cfg.outDir ?? 'showcase/public/media/shots'));
	const shots = cfg.shots.filter((s) => !args.only || s.name === args.only || s.group === args.only);
	if (!shots.length) throw new Error(`Nic k focení (--only ${args.only}).`);

	// `continueOnError` jen dofotí zbytek; běh s chybějícím obrázkem pořád skončí nenulovým kódem.
	const failed: string[] = [];
	for (const theme of themes) {
		const stage = await openStage({
			...cfg,
			colorScheme: theme,
			headed: args.headed === true,
		});
		await gotoPath(stage, cfg.entry ?? shots[0].path ?? '/');
		await setTheme(stage, theme);

		for (const [i, shot] of shots.entries()) {
			log.step(i + 1, shots.length, `${shot.name} (${theme})`);
			try {
				const file = await capture(stage, shot, cfg, outDir, theme, themes.length > 1);
				log.info('→', path.relative(process.cwd(), file));
			} catch (e) {
				log.warn(`${shot.name} (${theme}) selhal: ${e instanceof Error ? e.message : String(e)}`);
				if (!cfg.continueOnError) throw e;
				failed.push(`${shot.name} (${theme})`);
			}
		}
		await closeStage(stage);
	}
	const total = shots.length * themes.length;
	if (failed.length) {
		throw new Error(`Nevzniklo ${failed.length} z ${total} obrázků: ${failed.join(', ')}`);
	}
	log.info(`hotovo: ${total} obrázků → ${path.relative(process.cwd(), outDir)}`);
}

try {
	await main();
} catch (e) {
	console.error(e);
	process.exit(1);
}
