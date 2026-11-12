#!/usr/bin/env node
/**
 * Snímky → hotová videa pro web.
 *
 * Vyrábí trojici, kterou `<video>` na webu potřebuje: **mp4/H.264** (hraje
 * všude), **webm/VP9** (menší, moderní prohlížeče si vezmou ten) a **poster**
 * jako první obrázek. Volitelně krátký GIF do e-mailu nebo README.
 *
 * Použití:
 *   node capture/encode.ts --frames showcase/media/raw/invoice \
 *     [--out showcase/public/media] [--width 1920] [--music track.mp3] [--gif]
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { ensureDir, logger, parseArgs } from './lib/util.ts';

const log = logger('encode');

const execFileAsync = promisify(execFile);

// ffmpeg píše průběh do stderr; výchozí strop 1 MB by delší video uprostřed shodil.
async function run(args: string[]): Promise<void> {
	await execFileAsync('ffmpeg', args, { maxBuffer: Number.POSITIVE_INFINITY });
}

async function main() {
	const args = parseArgs();
	if (!args.frames) throw new Error('Chybí --frames <adresář se snímky>');

	const framesDir = path.resolve(process.cwd(), args.frames);
	const meta = JSON.parse(await readFile(path.join(framesDir, 'scene.json'), 'utf8'));
	const outDir = await ensureDir(path.resolve(process.cwd(), args.out ?? 'showcase/public/media'));

	const ext = meta.format === 'jpeg' ? 'jpg' : 'png';
	const input = path.join(framesDir, `%05d.${ext}`);
	const width = Number(args.width ?? 1920);
	// -2 dopočítá výšku a drží ji sudou; yuv420p je podmínka přehratelnosti
	// v Safari a na iOS.
	const scale = `scale=${Math.min(width, meta.width)}:-2:flags=lanczos`;
	const base = path.join(outDir, meta.name);

	const audio = [];
	if (args.music) {
		const vol = Number(args.musicVolume ?? 0.14);
		const fadeOut = Math.max(0, meta.duration - 3);
		audio.push(
			'-i',
			path.resolve(process.cwd(), args.music),
			'-af',
			`volume=${vol},afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOut.toFixed(2)}:d=3`,
			'-c:a',
			'aac',
			'-b:a',
			'160k',
			'-shortest',
		);
	}

	log.info(`${meta.frames} snímků @ ${meta.fps} fps → ${meta.duration.toFixed(1)} s`);

	await run([
		'-y',
		'-framerate',
		String(meta.fps),
		'-i',
		input,
		...audio,
		'-vf',
		`${scale},format=yuv420p`,
		'-c:v',
		'libx264',
		'-preset',
		'slow',
		'-crf',
		String(args.crf ?? 18),
		'-movflags',
		'+faststart',
		`${base}.mp4`,
	]);
	log.info('→', path.relative(process.cwd(), `${base}.mp4`));

	if (args.webm !== 'false') {
		await run([
			'-y',
			'-framerate',
			String(meta.fps),
			'-i',
			input,
			...audio,
			'-vf',
			`${scale},format=yuv420p`,
			'-c:v',
			'libvpx-vp9',
			'-crf',
			String(args.webmCrf ?? 32),
			'-b:v',
			'0',
			'-row-mt',
			'1',
			`${base}.webm`,
		]);
		log.info('→', path.relative(process.cwd(), `${base}.webm`));
	}

	// Poster má ukazovat produkt, ne úvodní kartu — proto kus za začátkem,
	// ale ne až v závěru: třetina délky, nejvýš osm sekund.
	const posterAt = Number(args.poster ?? Math.min(meta.duration * 0.35, 8));
	await run([
		'-y',
		'-ss',
		posterAt.toFixed(2),
		'-i',
		`${base}.mp4`,
		'-frames:v',
		'1',
		'-q:v',
		'3',
		`${base}-poster.jpg`,
	]);
	log.info('→', path.relative(process.cwd(), `${base}-poster.jpg`));

	if (args.gif) {
		await run([
			'-y',
			'-i',
			`${base}.mp4`,
			'-vf',
			`fps=${args.gifFps ?? 12},scale=${args.gifWidth ?? 960}:-2:flags=lanczos,split[a][b];` +
				'[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
			'-loop',
			'0',
			`${base}.gif`,
		]);
		log.info('→', path.relative(process.cwd(), `${base}.gif`));
	}

	log.info('hotovo. Titulky (.vtt) najdeš vedle snímků — zkopíruj je k videu a připoj přes <track>.');
}

try {
	await main();
} catch (e) {
	console.error(e);
	process.exit(1);
}
