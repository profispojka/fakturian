import { mkdir, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const routes = ['/', '/funkce', '/pouziti', '/cena', '/napoveda'];

async function addContentRoutes(dir: string) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = resolve(dir, entry.name);
		if (entry.isDirectory()) await addContentRoutes(path);
		else if (entry.isFile() && entry.name.endsWith('.md')) {
			const name = relative(resolve(root, 'content'), path).replaceAll('\\', '/');
			routes.push(`/${name.slice(0, -3)}`);
		}
	}
}
await addContentRoutes(resolve(root, 'content'));

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 1,
	colorScheme: 'light',
	locale: 'cs-CZ',
});

try {
	for (const route of routes.toSorted()) {
		const page = await context.newPage();
		try {
			const response = await page.goto(`http://127.0.0.1:3901${route}`, { waitUntil: 'networkidle' });
			if (!response?.ok()) throw new Error(`${route}: HTTP ${response?.status() ?? 'no response'}`);
			await page.locator('h1').first().waitFor({ state: 'visible' });
			await page.evaluate(() => document.fonts.ready);
			const path = resolve(root, 'visual-baselines/desktop', `${route === '/' ? 'index' : route.slice(1)}.png`);
			await mkdir(dirname(path), { recursive: true });
			await page.screenshot({ path, fullPage: true, animations: 'disabled' });
			console.log(`${route} → ${path}`);
		} finally {
			await page.close();
		}
	}
} finally {
	await browser.close();
}
