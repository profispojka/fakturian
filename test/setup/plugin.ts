import { afterEach, vi } from 'vitest';
import { effectScope } from 'vue';

const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Plugin běží nad sdíleným `nuxtApp` celého souboru. Po testu se odhákne jen to, co zaregistroval
 * on, a zastaví se jeho posluchače na `window` — hooky Nuxt UI a routeru zůstanou.
 */
export function runPlugin(plugin: (app: ReturnType<typeof useNuxtApp>) => unknown): void {
	const app = useNuxtApp();
	const hook = vi.spyOn(app, 'hook');
	const scope = effectScope(true);
	scope.run(() => app.runWithContext(() => plugin(app)));
	for (const result of hook.mock.results) if (result.type === 'return') cleanups.push(result.value);
	hook.mockRestore();
	cleanups.push(() => scope.stop());
}
