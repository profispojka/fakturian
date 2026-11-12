<script setup lang="ts">
import { FURTHER_FORMS } from '~/constants/locales';
import { errorText } from '~/utils/errors';
import { czechPlural, czechSentence, formatCount, formatPassiveCount } from '~/utils/locales';

const emit = defineEmits<{ adopted: [] }>();

const { supplier } = useSettings();
const { scan, scanError, refresh, adopt } = useAdopt();

// Znovu po změně vlastního IČO: bez něj sken hádá podle většiny a při prvním vykreslení nemusí být
// `nastaveni.json` načtený.
watch(() => supplier.value?.ico, refresh, { immediate: true });

const msg = ref('');
const adopting = ref(false);

const PREVIEW = 5;

async function onAdopt() {
	if (adopting.value) return;
	const current = scan.value;
	if (!current) return;
	adopting.value = true;
	msg.value = '';
	try {
		const r = await adopt(current);
		const parts = [formatPassiveCount(r.adopted, 'document', 'převzat')];
		if (r.addedContacts > 0) parts.push(formatPassiveCount(r.addedContacts, 'customer', 'přidán'));
		if (r.skipped.length > 0) parts.push(formatPassiveCount(r.skipped.length, 'file', 'přeskočen'));
		msg.value = czechSentence(parts);
		if (r.supplierFilled) msg.value += ' Fakturační údaje se doplnily z dokladů.';
		emit('adopted');
		await refresh();
	} catch (e) {
		msg.value = `Převzetí selhalo: ${errorText(e)}`;
	} finally {
		adopting.value = false;
	}
}
</script>

<template>
	<section v-if="scan?.candidates.length" class="card" data-testid="adopt-offer">
		<h2 class="section-title">Ve složce leží doklady mimo evidenci</h2>
		<p class="hint" data-testid="adopt-what">
			Faktury se čtou z podsložky faktury/. Převzetím se tam soubory přesunou pod svým číslem — zůstávají to tvoje
			PDF, jen srovnaná. Chybí-li fakturační údaje, doplní se z dokladů.
		</p>

		<ul class="mt-3">
			<li
				v-for="c in scan.candidates.slice(0, PREVIEW)"
				:key="c.path"
				class="flex items-baseline justify-between gap-3 border-b border-line-soft py-2 last:border-b-0"
				data-testid="adopt-candidate">
				<span>
					{{ c.number }} · {{ c.customer }} ·
					<Money :cents="c.totalCents" />
				</span>
				<span class="truncate text-meta text-ink-2">{{ c.file }}</span>
			</li>
		</ul>
		<p v-if="scan.candidates.length > PREVIEW" class="hint" data-testid="adopt-more">
			…a {{ czechPlural(scan.candidates.length - PREVIEW, FURTHER_FORMS) }} {{ scan.candidates.length - PREVIEW }}
		</p>

		<p v-if="scan.truncated" class="hint" data-testid="adopt-truncated">
			Ve složce je souborů víc, než co má smysl naráz otevřít — tohle je první dávka. Po převzetí se sken pustí
			znovu a najde další.
		</p>

		<div class="row mt-3">
			<UButton size="xs" variant="soft" :loading="adopting" data-testid="adopt-accept" @click="onAdopt">
				Převzít {{ formatCount(scan.candidates.length, 'document') }}
			</UButton>
		</div>

		<UCollapsible v-if="scan.skipped.length" class="mt-3 text-meta text-ink-2" data-testid="adopt-skipped">
			<UButton
				variant="ghost"
				color="neutral"
				trailing-icon="i-lucide-chevron-down"
				data-testid="adopt-skipped-toggle">
				{{ formatCount(scan.skipped.length, 'file') }} mimo převzetí
			</UButton>
			<template #content>
				<ul class="mt-2 pl-5">
					<li v-for="skippedFile in scan.skipped" :key="skippedFile.file">
						{{ skippedFile.file }}: {{ skippedFile.reason }}
					</li>
				</ul>
			</template>
		</UCollapsible>
	</section>
	<UAlert
		v-if="scanError"
		color="error"
		variant="soft"
		icon="i-lucide-file-warning"
		title="Doklady mimo evidenci se nepodařilo vyhledat"
		:description="scanError"
		data-testid="adopt-scan-error" />
	<p v-if="msg" class="hint mt-3" data-testid="adopt-message">
		{{ msg }}
	</p>
</template>
