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

// Složka na místě je a nejdou z ní jen načíst data: „Začít načisto" by vedlo pryč od dokladů v ní.
const vaultFound = ref(false);

const startErrorTitle = computed(() =>
	vaultFound.value ? 'Data ve složce nejdou načíst' : 'Datová složka není na svém místě',
);

// Přesunutá složka je běžný způsob, jak se appka sem dostane — data v ní zůstala a stačí ji ukázat
// znovu. Text k tomu vede i u nečitelného nastavení appky, protože cesta ven je z něj stejná.
const startErrorMessage = computed(() => {
	if (vaultFound.value) {
		return `${initError.value}\n\nSložka i doklady v ní jsou na místě. Oprav soubor, nebo ho nahraď zálohou ze složky .fakturian/snapshots, a zkus to znovu.`;
	}
	return `${initError.value}\n\nPokud jsi složku přesunul nebo přejmenoval, vyber ji tam, kde teď leží — data v ní zůstala.`;
});

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

async function start() {
	try {
		await init();
	} catch (e) {
		vaultFound.value = false;
		initError.value = errorText(e);
		return;
	}
	vaultFound.value = true;

	try {
		// Panel se vykreslil ještě bez složky; po obnovení z chyby se vykreslí znovu a načte si ji sám.
		if (vaultPath.value) {
			await load();
			await refreshMenuStats();
		}
	} catch (e) {
		initError.value = errorText(e);
		return;
	}
	initError.value = '';

	// Až po úspěšném načtení: po chybě by uživatel uvízl — průvodce nejde zavřít, uložení dodavatele
	// se odmítne a jeho overlay překryje i tlačítka chybové obrazovky.
	if (!vaultPath.value || !supplierReadyForInvoicing(supplier.value)) wizardOpen.value = true;
}

async function recover(pick: () => Promise<boolean>) {
	try {
		const opened = await pick();
		if (!opened) return;
		vaultFound.value = true;
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

	await start();
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
		     nenačtenými daty klikalo po prázdných výpisech. Cesta ven vede jedině přes tlačítka pod
		     hláškou a tahací zóna je na celé ploše, protože chybí horní lišta. -->
		<UError
			v-else-if="initError"
			:error="{ statusMessage: startErrorTitle, message: startErrorMessage }"
			:icon="vaultFound ? 'i-lucide-file-warning' : 'i-lucide-folder-search'"
			:clear="false"
			data-drag-region
			data-testid="start-error">
			<template #links>
				<template v-if="vaultFound">
					<UButton label="Zkusit znovu" data-testid="start-error-retry" @click="start" />
					<UButton
						variant="ghost"
						color="neutral"
						label="Vybrat jinou složku…"
						data-testid="start-error-pick"
						@click="recover(pickVault)" />
				</template>
				<template v-else>
					<UButton label="Najít složku…" data-testid="start-error-pick" @click="recover(pickVault)" />
					<UButton
						variant="ghost"
						color="neutral"
						label="Začít načisto"
						data-testid="start-error-fresh"
						@click="recover(freshVault)" />
				</template>
			</template>
		</UError>

		<NuxtLayout v-else>
			<NuxtPage />
		</NuxtLayout>
		<CommandPalette />
		<VaultWizard />
	</UApp>
</template>
