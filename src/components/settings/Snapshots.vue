<script setup lang="ts">
import { useAsyncState } from '@vueuse/core';

import { SNAPSHOT_WEEKS } from '~/bindings';
import { snapshotServices } from '~/services/snapshots';
import { systemServices } from '~/services/system';

const { requireVault } = useVault();
const status = usePageStatus();

// `async`, protože `requireVault()` hází synchronně a `useAsyncState` volá továrnu mimo svůj `try`.
const { state: path } = useAsyncState<string | null>(
	async () => {
		const found = await snapshotServices.path(requireVault());
		return found;
	},
	null,
	{
		onError: (e) => status.error('Zálohy se nepodařilo najít', e),
	},
);

async function reveal(folder: string) {
	try {
		await systemServices.revealPath(folder);
	} catch (e) {
		status.error('Zálohy se nepodařilo otevřít ve Finderu', e);
	}
}
</script>

<template>
	<section class="card" data-testid="snapshots">
		<h2 class="section-title">Zálohy</h2>
		<p class="mb-4 text-note text-ink-3">
			Před první změnou v každém týdnu si Fakturian uloží kopii datového souboru i přepisované faktury a drží ji
			{{ SNAPSHOT_WEEKS }} týdnů. Kopie mají v názvu datum a jsou to obyčejné soubory — obnovíš je tím, že tu
			správnou přetáhneš ve Finderu zpátky mezi data. Appku předtím zavři.
		</p>
		<UButton
			v-if="path"
			color="neutral"
			variant="ghost"
			icon="i-lucide-folder-clock"
			data-testid="snapshots-reveal"
			@click="reveal(path)">
			Otevřít zálohy ve Finderu
		</UButton>
		<p v-else class="hint" data-testid="snapshots-empty">
			Zatím tu žádná záloha není. První vznikne, až se uložená data změní.
		</p>
	</section>
</template>
