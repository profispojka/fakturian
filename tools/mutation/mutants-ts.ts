import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

import { requireTsMutations } from './mutation-result.ts';

const reportPath = 'reports/mutation/mutation.json';
rmSync(reportPath, { force: true });
const result = spawnSync(
	process.execPath,
	['node_modules/@stryker-mutator/core/bin/stryker.js', 'run', 'stryker.config.ts', ...process.argv.slice(2)],
	{ stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
requireTsMutations(report);
