<script setup lang="ts">
import { cs } from '@nuxt/ui/locale';
import { useActiveElement } from '@vueuse/core';

import { supplierReadyForInvoicing } from '~/schemas/suppliers';
import { NOT_DESKTOP_MESSAGE, isDesktop } from '~/utils/desktop';
import { errorText } from '~/utils/errors';

const { vaultPath, init, pickVault, defaultVaultPath, setVault } = useVault();
const { load } = useVaultData();
const { refresh: refreshMenuStats } = useMenuStats();
const { supplier } = useSettings();

const paletteOpen = useState<boolean>('paletteOpen', () => false);
const wizardOpen = useState<boolean>('vaultWizardOpen', () => false);
const initError = useState<string>('vaultInitError', () => '');
const activeElement = useActiveElement();

// Jiný případ než poškozená data: vývojářský omyl nesmí vypadat jako rozbité účetnictví.
const outsideDesktop = ref(false);

// Přesunutá složka je běžný způsob, jak se appka sem dostane — data v ní zůstala a stačí ji ukázat
// znovu. Text k tomu vede i u ostatních chyb, protože cesta ven je z nich stejná.
const startErrorMessage = computed(
	() =>
		`${initError.value}\n\nPokud jsi složku přesunul nebo přejmenoval, vyber ji tam, kde teď leží — data v ní zůstala.`,
);

defineShortcuts({
	meta_p: {
		usingInput: true,
		handler: () => {
			if (document.querySelector('[data-slot="overlay"]')) return;
			paletteOpen.value = true;
		},
	},
	meta_n: {
		usingInput: true,
		handler: () => {
			if (document.querySelector('[data-slot="overlay"]')) return;
			void navigateTo('/invoice/new');
		},
	},
	'meta_,': {
		usingInput: true,
		handler: () => {
			if (document.querySelector('[data-slot="overlay"]')) return;
			void navigateTo('/settings');
		},
	},
	// Mačká tlačítko Uložit stránky, takže platí jeho `disabled` i validace formuláře.
	meta_s: {
		usingInput: true,
		handler: () => {
			if (document.querySelector('[data-slot="overlay"]')) return;
			// Číselné pole zapíše hodnotu až při opuštění a programový klik fokus nepřesune.
			activeElement.value?.blur();
			document.querySelector<HTMLButtonElement>('[data-save]')?.click();
		},
	},
});

async function recover(pick: () => Promise<boolean>) {
	try {
		const opened = await pick();
		if (!opened) return;
		await load();
	} catch (e) {
		initError.value = errorText(e);
		return;
	}
	initError.value = '';
	if (!supplierReadyForInvoicing(supplier.value)) wizardOpen.value = true;
}

async function freshVault() {
	const path = await defaultVaultPath();
	return setVault(path);
}

onMounted(async () => {
	// Bez nativní vrstvy by každý příkaz spadl a uživatel by dostal hlášku o datech místo o tom, že
	// appku spustil špatně.
	if (!isDesktop()) {
		outsideDesktop.value = true;
		return;
	}

	try {
		await init();
		// Panel se vykreslil ještě bez složky; po obnovení z chyby se vykreslí znovu a načte si ji sám.
		if (vaultPath.value) {
			await load();
			await refreshMenuStats();
		}
	} catch (e) {
		initError.value = errorText(e);
	}

	// Jen když data skutečně chybí: po chybě načtení by uživatel uvízl — průvodce nejde zavřít,
	// uložení dodavatele se odmítne a jeho overlay překryje i tlačítka chybové obrazovky.
	if (!initError.value && (!vaultPath.value || !supplierReadyForInvoicing(supplier.value))) {
		wizardOpen.value = true;
	}
});

useMcp();
</script>

<template>
	<UApp :locale="cs">
		<UBanner
			v-if="outsideDesktop"
			:title="NOT_DESKTOP_MESSAGE"
			color="neutral"
			:close="false"
			class="fixed inset-x-0 bottom-0 z-100"
			data-testid="start-note" />
		<!-- Stránka se nezamountuje vůbec: každá sekce z vaultu čte i do něj zapisuje, takže by se nad
		     chybějící složkou klikalo po prázdných výpisech. Cesta ven vede jedině přes tlačítka pod
		     hláškou a tahací zóna je na celé ploše, protože chybí horní lišta. -->
		<UError
			v-else-if="initError"
			:error="{ statusMessage: 'Datová složka není na svém místě', message: startErrorMessage }"
			icon="i-lucide-folder-search"
			:clear="false"
			data-drag-region
			data-testid="start-error">
			<template #links>
				<UButton label="Najít složku…" data-testid="start-error-pick" @click="recover(pickVault)" />
				<UButton
					variant="ghost"
					color="neutral"
					label="Začít načisto"
					data-testid="start-error-fresh"
					@click="recover(freshVault)" />
			</template>
		</UError>

		<NuxtLayout v-else>
			<NuxtPage />
		</NuxtLayout>
		<CommandPalette />
		<VaultWizard />
	</UApp>
</template>
