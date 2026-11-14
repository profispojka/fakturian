<script setup lang="ts">
import { useClipboard } from '@vueuse/core';

import { FIO_HISTORY_DAYS } from '~/constants/fio';

definePageMeta({ vaultOptional: true });

const status = usePageStatus();

const { hasToken, tokenError, syncError, refreshHasToken, setToken, clearToken } = useFio();
// Bez tokenu se nesynchronizuje, takže stará chyba by jen strašila.
const fioSyncFailed = computed(() => hasToken.value && Boolean(syncError.value));
const fioStatusColor = computed(() => {
	if (fioSyncFailed.value || tokenError.value) return 'error';
	if (hasToken.value) return 'primary';
	return 'neutral';
});
const { form: fio, reset: resetFio } = useForm(() => ({ token: '' }));

onMounted(refreshHasToken);

async function removeFioToken() {
	const confirmed = await getUserConfirmation(
		'Smazáním se Fakturian odpojí od Fio banky. Pro další synchronizaci bude potřeba token zadat znovu.',
		{
			title: 'Smazat Fio token?',
			confirmLabel: 'Smazat token',
		},
	);

	if (!confirmed) return;

	// Klíčenka může odmítnout; bez `try/catch` by z toho byla tichá unhandled rejection a pilulka
	// „uložen" by svítila dál.
	try {
		await clearToken();
		status.show('success', 'Token Fio smazán.');
	} catch (e) {
		status.error('Token se nepodařilo smazat', e);
	}
}

// Connector se registruje v MCP klientovi, ne tady.
const { socketPath, connector, error: mcpPathsError } = useMcpPaths();
const mcpStatusColor = computed(() => {
	if (mcpPathsError.value) return 'error';
	if (socketPath.value) return 'primary';
	return 'neutral';
});

// Bez známé cesty zůstává zástupný text: příkaz s cestou do prázdna by se zaregistroval a selhal až
// prvním dotazem agenta.
const mcpCommand = computed(() => {
	const { command, args } = connector.value ?? {
		command: '<cesta-k-Fakturianu>/Fakturian.app/Contents/MacOS/Fakturian',
		args: ['--mcp'],
	};
	// Apostrofy, ne uvozovky: v uvozovkách by shell z cesty pořád rozvinul `$` a zpětný apostrof.
	const words = [command, ...args].map((word) =>
		/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", String.raw`'\''`)}'`,
	);
	return `claude mcp add fakturian -- ${words.join(' ')}`;
});

const socketPathPretty = computed(() => socketPath.value.replace(/^\/Users\/[^/]+/, '~'));

// `legacy` odmítnutí schránky obslouží náhradní cestou přes textarea, takže `copy()` nehází.
const { copy: mcpCopy, copied: mcpCopied } = useClipboard({
	legacy: true,
	copiedDuring: 1600,
});

const dirty = computed(() => Boolean(fio.value.token));

async function saveAll() {
	status.clear();
	try {
		await setToken(fio.value.token);
		resetFio({ token: '' });
		status.show('success', 'Uloženo.');
	} catch (e) {
		status.error('Token se nepodařilo uložit', e);
	}
}
</script>

<template>
	<div class="page detail-page">
		<header class="detail-header" data-drag-region>
			<span
				class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line-soft bg-card text-ink-2">
				<UIcon name="i-lucide-plug" class="size-5" />
			</span>
			<h1 class="text-stat font-semibold tracking-tight text-ink">Integrace</h1>
		</header>

		<div class="page-body detail-body selectable">
			<div class="mx-auto flex w-full max-w-180 flex-col gap-7">
				<UAlert
					v-if="fioSyncFailed"
					color="error"
					variant="soft"
					icon="i-lucide-triangle-alert"
					title="Poslední synchronizace Fio selhala"
					:description="syncError"
					data-testid="fio-sync-error" />

				<section
					class="grid grid-cols-[200px_minmax(0,1fr)] items-center gap-x-6 gap-y-3.5"
					data-testid="integrations-fio">
					<div class="col-span-full flex items-center gap-3">
						<span
							class="flex size-7 shrink-0 items-center justify-center rounded-lg border border-line-soft bg-card text-ink-2">
							<UIcon name="i-lucide-landmark" class="size-4" />
						</span>
						<h2 class="text-title font-semibold text-ink">Fio banka</h2>
						<span
							class="ml-auto inline-flex items-center gap-2 text-meta text-ink-2 data-error:text-danger data-off:text-ink-3"
							:data-off="(!hasToken && !tokenError) || undefined"
							:data-error="fioSyncFailed || Boolean(tokenError) || undefined"
							data-testid="fio-status">
							<UChip standalone inset :color="fioStatusColor" />
							<template v-if="fioSyncFailed">Synchronizace selhala</template>
							<template v-else-if="hasToken">Token uložen</template>
							<template v-else-if="tokenError">Klíčenka nedostupná</template>
							<template v-else>Bez tokenu</template>
						</span>
					</div>

					<label for="fio-token" class="text-right text-ui text-ink-2">API token</label>
					<UFormField :error="tokenError">
						<template v-if="tokenError" #error>
							<span data-testid="fio-token-error">{{ tokenError }}</span>
						</template>
						<div class="flex items-center gap-2">
							<UInput
								id="fio-token"
								v-model.trim="fio.token"
								class="min-w-0 flex-1"
								type="password"
								data-testid="fio-token"
								:placeholder="
									hasToken ? 'Uložen v klíčence — vlož nový, chceš-li ho nahradit' : 'Vlož token'
								" />
							<UButton
								v-if="hasToken"
								variant="ghost"
								color="error"
								data-testid="fio-token-delete"
								@click="removeFioToken">
								Smazat
							</UButton>
						</div>
					</UFormField>

					<span class="text-right text-ui text-ink-2">Platby</span>
					<p class="text-ui text-ink-2">
						Za posledních {{ FIO_HISTORY_DAYS }} dní, párují se podle variabilního symbolu. Stahují se při
						otevření
						<NuxtLink to="/invoice" class="row-link">výpisu faktur</NuxtLink>
						a tlačítkem nad ním.
					</p>

					<p class="hint col-start-2 text-ink-3">
						Token vytvoř ve Fio internetbankingu s oprávněním jen pro čtení.
					</p>
				</section>

				<div class="h-px bg-line-soft" />

				<section
					class="grid grid-cols-[200px_minmax(0,1fr)] items-center gap-x-6 gap-y-3.5"
					data-testid="integrations-mcp">
					<div class="col-span-full flex items-center gap-3">
						<span
							class="flex size-7 shrink-0 items-center justify-center rounded-lg border border-line-soft bg-card text-ink-2">
							<UIcon name="i-lucide-sparkles" class="size-4" />
						</span>
						<h2 class="text-title font-semibold text-ink">Claude</h2>
						<span
							class="ml-auto inline-flex items-center gap-2 text-meta text-ink-2 data-error:text-danger data-off:text-ink-3"
							:data-off="(!socketPath && !mcpPathsError) || undefined"
							:data-error="Boolean(mcpPathsError) || undefined"
							data-testid="mcp-status">
							<UChip standalone inset :color="mcpStatusColor" />
							<template v-if="mcpPathsError && socketPath">Most nejde zjistit</template>
							<template v-else-if="mcpPathsError">Most neběží</template>
							<template v-else-if="socketPath">Most běží</template>
							<template v-else>Bez mostu</template>
						</span>
					</div>
					<p v-if="mcpPathsError" class="hint col-span-full text-danger" data-testid="mcp-paths-error">
						{{ mcpPathsError }}
					</p>

					<span class="text-right text-ui text-ink-2">Připojení</span>
					<div
						class="flex min-w-0 items-center gap-2 rounded-row border border-line-soft bg-inset px-2.5 py-1.5">
						<code class="min-w-0 flex-1 truncate font-mono text-note text-ink-2" data-testid="mcp-command">
							{{ mcpCommand }}
						</code>
						<UButton
							class="shrink-0"
							size="xs"
							variant="ghost"
							:icon="mcpCopied ? 'i-lucide-check' : 'i-lucide-copy'"
							:title="`Zkopírovat: ${mcpCommand}`"
							data-testid="mcp-copy"
							@click="mcpCopy(mcpCommand)">
							<template v-if="mcpCopied">Zkopírováno</template>
							<template v-else>Kopírovat</template>
						</UButton>
					</div>
					<p v-if="!connector" class="hint col-start-2" data-testid="mcp-path-hint">
						Za cestu dosaď složku, kde Fakturian máš.
					</p>

					<span class="text-right text-ui text-ink-2">Podmínka</span>
					<p class="text-ui text-ink-2">
						Fakturian musí běžet — agent se ptá appky, ne souborů.
						<template v-if="socketPathPretty">
							Most poslouchá mimo datovou složku:
							<code class="font-mono text-note" data-testid="mcp-socket">{{ socketPathPretty }}</code>
						</template>
					</p>

					<span class="text-right text-ui text-ink-2">Zápis</span>
					<p class="text-ui text-ink-2">Fakturu se skutečným číslem z řady vystaví až po tvém potvrzení.</p>

					<p class="hint col-start-2 text-ink-3">
						Připojení je příkaz pro Claude Code. Fakturian sám nic neodesílá; agent dostane jen to, co si
						vyžádá nástrojem.
					</p>
				</section>
			</div>
		</div>

		<footer class="detail-footer" data-testid="integrations-footer">
			<div class="mr-auto min-w-0 text-note text-ink-3">
				<StatusbarFeedback :status="status.message">
					<span>Tokeny jsou uložené v klíčence macOS</span>
				</StatusbarFeedback>
			</div>
			<UButton
				variant="create"
				data-save
				data-testid="action-save"
				class="ml-auto"
				loading-auto
				:disabled="!dirty"
				trailing-icon="i-lucide-save"
				@click="saveAll">
				Uložit
			</UButton>
		</footer>
	</div>
</template>
