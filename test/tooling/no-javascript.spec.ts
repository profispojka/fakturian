import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Git zná jen zdrojáky: gitignorované buildy, `node_modules` a data vynechá sám. Soubor smazaný jen
// z disku v indexu zůstává až do commitu, proto filtr přes `existsSync`.
const files = execFileSync(
	'git',
	['ls-files', '--cached', '--others', '--exclude-standard', '*.js', '*.mjs', '*.cjs', '*.jsx'],
	{ encoding: 'utf8' },
)
	.split('\n')
	.filter((file) => file && existsSync(file));

describe('žádný JavaScript', () => {
	it('zdrojáky projektu jsou v TypeScriptu', () => {
		expect(files, `${files.join('\n')}\nPřepiš soubory do TypeScriptu (.ts).`).toEqual([]);
	});
});
