import type { Reporter } from 'vitest/node';

/** Povinná sada nesmí zezelenat přes skip, prázdný soubor nebo opakování. */
export default class RequiredTestsReporter implements Reporter {
	onTestRunEnd: NonNullable<Reporter['onTestRunEnd']> = (modules, errors, reason) => {
		const failures: string[] = [];
		if (reason !== 'passed') failures.push(`Běh skončil: ${reason}`);
		if (errors.length) failures.push(`Neošetřené chyby: ${errors.length}`);
		if (!modules.length) failures.push('Nespustila se žádná sada.');
		for (const module of modules) {
			const tests = [...module.children.allTests()];
			if (module.state() !== 'passed' || !tests.length) failures.push(module.moduleId);
			for (const test of tests) {
				if (test.result().state !== 'passed' || test.diagnostic()?.retryCount) failures.push(test.fullName);
			}
		}
		if (failures.length) throw new Error(`Povinné testy nejsou úplné:\n${failures.join('\n')}`);
	};
}
