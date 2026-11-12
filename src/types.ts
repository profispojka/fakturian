export interface SelectOption<T> {
	label: string;
	value: T;
}

// Rozšíření stojí v modulu s exporty: v souboru bez exportu by `declare module '#app'` neznamenalo
// rozšíření, ale náhradu.
declare module '#app' {
	interface PageMeta {
		/** Bez tohohle příznaku nabídne `layouts/default.vue` místo stránky průvodce. */
		vaultOptional?: boolean;
	}
}
