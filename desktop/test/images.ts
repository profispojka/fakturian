import { Buffer } from 'node:buffer';

import { decode, encode } from 'fast-png';

export const RED = [200, 30, 30, 255];
export const BLUE = [20, 40, 220, 255];

export interface Picture {
	width: number;
	height: number;
	pixel: (x: number, y: number) => number[];
}

export function solid(width: number, height: number, color: number[] = RED): Uint8Array {
	const pixels = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) pixels.set(color, i * 4);
	return pixels;
}

export function png(width: number, height: number, color: number[] = RED): Uint8Array {
	return encode({
		width,
		height,
		data: solid(width, height, color),
		channels: 4,
		depth: 8,
	});
}

// PNG z data-URL tak, jak ho dostane webview; jiný tvar odpovědi je pád testu.
export function fromDataUrl(icon: string | null): Picture {
	const prefix = 'data:image/png;base64,';
	if (icon === null || !icon.startsWith(prefix)) throw new Error(`Čekám PNG data-URL, přišlo: ${icon}`);
	const { width, height, data, channels, depth } = decode(Buffer.from(icon.slice(prefix.length), 'base64'));
	if (channels !== 4 || depth !== 8) throw new Error(`Čekám RGBA po 8 bitech, přišlo ${channels} × ${depth}.`);
	return {
		width,
		height,
		pixel: (x, y) => Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)),
	};
}
