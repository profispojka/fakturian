import { computed, ref, toRaw } from 'vue';

type FormExit = 'leave' | 'update' | 'close' | 'new';

interface FormOptions {
	afterConfirm?: (confirmed: boolean, exit: FormExit) => void;
}

type Guard = () => Promise<boolean>;

let activeGuard: Guard | null = null;
let asking = false;

function cloneForm<T extends object>(value: T): T {
	return structuredClone(toRaw(value));
}

// ⌘W a ⌘Q routerem nejdou, takže `onBeforeRouteLeave` na ně nedosáhne. Stav je modulový, ne
// `useState`: je to funkce.
export function useUnsavedGuard(guard: Guard): void {
	activeGuard = guard;
	onBeforeUnmount(() => {
		if (activeGuard === guard) activeGuard = null;
	});
}

// Dokud se čeká na odpověď dialogu, každý další dotaz dostane `false` — druhé ⌘W nesmí otevřít
// další dialog přes ten první.
export async function canDiscardUnsaved(): Promise<boolean> {
	if (!activeGuard) return true;
	if (asking) return false;
	asking = true;
	const canClose = await activeGuard();
	asking = false;
	return canClose;
}

// Formulář nejde nahradit bez posunutí čistého stavu, takže stránka neudržuje dvě kopie ve správném
// pořadí sama.
export function useForm<T extends object>(initial: () => T, options: FormOptions = {}) {
	const form = ref(cloneForm(initial()));
	const pristine = ref(JSON.stringify(form.value));
	const dirty = computed(() => JSON.stringify(form.value) !== pristine.value);

	function reset(value: T) {
		form.value = cloneForm(value);
		commit();
	}

	function commit() {
		pristine.value = JSON.stringify(form.value);
	}

	async function mayDiscard(exit: FormExit): Promise<boolean> {
		if (!dirty.value) return true;
		const confirmed = await getUserConfirmation('Máš neuložené změny. Tímhle o ně přijdeš.', {
			title: 'Zahodit neuložené změny?',
			confirmLabel: 'Zahodit',
		});
		options.afterConfirm?.(confirmed, exit);
		return confirmed;
	}

	onBeforeRouteLeave(() => mayDiscard('leave'));
	onBeforeRouteUpdate(() => mayDiscard('update'));
	useUnsavedGuard(() => mayDiscard('close'));

	return {
		form,
		dirty,
		reset,
		commit,
		mayDiscard,
	};
}
