/**
 * `size: 'md'` je default, aby se velikost nemusela psát u každé komponenty; `sm` sázel do polí
 * 12px, tedy o pixel míň než běžný text okna.
 */
export default defineAppConfig({
	ui: {
		colors: {
			primary: 'green',
			neutral: 'neutral',
		},
		/* Hláška o startu nese celou větu i s důvodem, takže se pruh láme na víc řádků;
		   výchozí `truncate` by nechal první řádek s třemi tečkami, tedy bez důvodu. */
		banner: {
			slots: {
				container: 'h-auto min-h-12 py-2',
				title: 'text-clip whitespace-pre-line',
			},
		},
		button: {
			slots: {
				base: 'text-ui!',
			},
			defaultVariants: {
				size: 'md',
			},
			variants: {
				size: {
					md: {
						base: 'min-h-(--ctl) py-0',
					},
				},
				variant: {
					create: 'h-9 shrink-0 gap-2 rounded-full border border-white/10 bg-brand px-4 text-meta! font-medium whitespace-nowrap text-white shadow-[inset_0_1px_0_#ffffff1c,0_2px_4px_#0002] hover:bg-brand/90 [&_kbd]:bg-white/10 [&_kbd]:text-white/80 [&_kbd]:ring-white/20',
				},
			},
			compoundVariants: [
				{
					variant: 'create',
					color: 'error',
					class: 'bg-danger hover:bg-danger/90',
				},
				{
					variant: 'solid',
					color: 'primary',
					class: 'h-8 min-h-8 shrink-0 gap-1.5 rounded-full border border-white/10 bg-brand px-3.5 text-meta! font-medium whitespace-nowrap text-white shadow-[inset_0_1px_0_#ffffff1c,0_2px_4px_#0002] hover:bg-brand/90 active:bg-brand/90 disabled:bg-brand aria-disabled:bg-brand',
				},
			],
		},
		listbox: {
			slots: {
				root: 'ring-0 rounded-none',
				input: 'mb-3 border-b-0',
				content: 'max-h-90',
				group: 'p-0',
				item: 'min-h-11 py-2 px-3 rounded-xl text-ui before:inset-0 before:rounded-xl data-highlighted:before:bg-row-on',
			},
		},
		dropdownMenu: {
			slots: {
				content:
					'max-h-none w-64 rounded-3xl! border border-line bg-card/85! p-1.5 ring-0 shadow-[inset_0_1px_0_#ffffff12,0_16px_40px_#0003,0_2px_6px_#0001] backdrop-blur-2xl backdrop-saturate-150',
				viewport: 'overflow-visible',
				group: 'p-0 space-y-0.5',
				item: 'h-10 items-center gap-3 rounded-xl px-3 text-ui! before:inset-0 before:rounded-xl data-highlighted:before:bg-row-on data-[state=open]:before:bg-row-on',
				itemLeadingIcon: 'size-4.5',
			},
		},
		tooltip: {
			slots: {
				content: 'h-auto max-w-72 items-start px-3 py-2 text-left leading-snug',
				text: 'text-clip whitespace-normal',
			},
		},
		table: {
			slots: {
				root: 'relative w-full overflow-visible',
				base: 'w-full border-collapse [--text-micro:11px] [--text-note:12px] [--text-meta:13px] [--text-ui:14px] [--text-title:15px] text-ui in-[.record-list]:table-fixed in-[.record-list]:border-separate in-[.record-list]:border-spacing-y-0.75',
				thead: 'border-none',
				tbody: 'divide-y-0',
				tr: 'has-data-draft:bg-row-hover in-[.record-list]:outline-none',
				th: 'h-8 border-b border-line px-3 py-1 text-left text-note font-medium text-ink-2 whitespace-nowrap eyebrow in-[.ftable]:sticky in-[.ftable]:top-0 in-[.ftable]:z-1 in-[.ftable]:bg-pane in-[.modal-card]:bg-card! in-[.ftable]:first:pl-3 in-[.ftable]:last:pr-0 in-[.record-list]:border-0! in-[.record-list]:bg-pane in-[.record-list]:text-micro! in-[.record-list]:font-normal! in-[.record-list]:tracking-normal! in-[.record-list]:text-ink-3 in-[.record-list]:normal-case!',
				td: 'h-(--row-tbl) border-b border-line-soft px-3 py-1 text-left text-ink-2 whitespace-nowrap in-[.ftable]:first:pl-3 in-[.ftable]:first:text-ink in-[.ftable]:last:pr-0 in-[.record-list]:h-15 in-[.record-list]:border-0! in-[.record-list]:py-2 in-[.record-list]:text-meta',
				separator: 'hidden',
			},
		},
		badge: {
			defaultVariants: {
				color: 'neutral',
				variant: 'soft',
				size: 'sm',
			},
			slots: {
				base: 'rounded-micro text-note font-medium whitespace-nowrap',
			},
		},
		kbd: {
			base: 'text-note min-w-4 h-4 px-1 rounded-micro',
		},
		/* Neutrální pilulka je přepínač režimu výpisu; barvy z `compoundVariants` tématu se přebíjejí
		   jen další kombinací, obyčejný slot by prohrál. */
		tabs: {
			defaultVariants: {
				color: 'neutral',
				variant: 'pill',
				size: 'xs',
			},
			compoundVariants: [
				{
					color: 'neutral',
					variant: 'pill',
					class: {
						list: 'gap-1 rounded-full border border-line-soft bg-transparent',
						indicator: 'rounded-full bg-row-on shadow-none',
						trigger:
							'grow-0 shrink-0 rounded-full px-3 text-note! data-[state=inactive]:text-ink-2 data-[state=active]:text-ink',
					},
				},
			],
		},
		chip: {
			variants: {
				color: {
					neutral: 'bg-ink-3',
				},
			},
		},
		radioGroup: {
			variants: {
				indicator: {
					hidden: {
						item: 'rounded-ctl px-3 py-1 has-data-[state=checked]:bg-accent-soft has-data-[state=checked]:text-accent',
						label: 'text-meta cursor-pointer whitespace-nowrap',
					},
				},
			},
			compoundVariants: [
				{
					variant: 'card',
					indicator: 'hidden',
					orientation: 'horizontal',
					class: {
						fieldset: 'min-w-0 flex-wrap gap-1',
						item: 'p-1 min-w-7 h-7 items-center',
					},
				},
				{
					variant: 'card',
					indicator: 'hidden',
					orientation: 'vertical',
					class: {
						fieldset: 'grid gap-2 grid-cols-[repeat(auto-fill,minmax(148px,1fr))]',
						item: 'p-3 rounded-row border-transparent bg-transparent has-data-[state=checked]:bg-row-on has-data-[state=checked]:border-line',
						label: 'whitespace-normal',
						wrapper: 'items-stretch text-left gap-2',
						description: 'text-ink-3 text-note leading-prose',
					},
				},
				{
					variant: 'list',
					indicator: 'hidden',
					class: {
						fieldset:
							'inline-flex h-auto items-center gap-1 rounded-full border border-line bg-card/70 p-0.5 shadow-sm',
						item: 'h-7.5 items-center rounded-full px-3 text-ink-2 transition-colors hover:bg-row-hover has-data-[state=checked]:bg-row-on has-data-[state=checked]:text-ink has-data-[state=checked]:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-accent',
						label: 'text-note',
					},
				},
			],
		},
		progress: {
			defaultVariants: {
				size: 'xs',
			},
		},
		navigationMenu: {
			slots: {
				root: 'w-full px-3',
				list: 'space-y-0.75',
				label: 'pt-5 pb-2 px-2.5 text-note! font-medium text-ink-3',
				link: 'h-9 gap-2.5 px-2.5 rounded-lg text-meta! text-ink-2 before:rounded-lg data-active:text-ink data-active:before:bg-row-on',
				linkLeadingIcon: 'size-4 text-ink-3',
				linkTrailingBadge: 'ring-0 bg-transparent px-0 font-normal text-ink-3! tabular-nums',
			},
		},
		/* Prázdný výpis je řádek textu s ikonou, ne karta: písmo i barvu dědí z místa, kde stojí,
		   takže ho Přehled zmenší obyčejným `text-meta!` na kořeni. */
		empty: {
			defaultVariants: {
				variant: 'naked',
			},
			slots: {
				root: 'flex-1 gap-3 p-0! py-12! text-ui',
				header: 'max-w-none gap-3 text-ink-2',
				description: '[font-size:inherit]! [color:inherit]!',
			},
		},
		/* Plocha pole visí na variantě, ne na velikosti — na velikosti by ji dostalo i
		   `variant="none"` v buňkách faktury a `search` v hlavičce výpisu. */
		input: {
			defaultVariants: {
				size: 'md',
			},
			variants: {
				size: {
					md: {
						base: 'min-h-(--ctl) py-0',
					},
				},
				variant: {
					outline: 'bg-inset!',
					search: {
						base: 'h-11 text-title! text-highlighted bg-transparent ring-0 focus:outline-none',
						leadingIcon: 'size-4.5 text-ink-3',
					},
				},
			},
		},
		inputNumber: {
			defaultVariants: {
				size: 'md',
			},
			variants: {
				size: {
					md: {
						base: 'min-h-(--ctl) py-0',
					},
				},
				variant: {
					outline: 'bg-inset!',
				},
			},
		},
		inputDate: {
			slots: {
				base: 'w-full',
			},
			defaultVariants: {
				size: 'md',
			},
			variants: {
				size: {
					md: {
						base: 'min-h-(--ctl) py-0',
					},
				},
				variant: {
					outline: 'bg-inset!',
				},
			},
		},
		select: {
			defaultVariants: {
				size: 'md',
			},
			variants: {
				size: {
					md: {
						base: 'min-h-(--ctl) py-0',
					},
				},
				variant: {
					outline: 'bg-inset!',
				},
			},
		},
		selectMenu: {
			defaultVariants: {
				size: 'md',
			},
			variants: {
				size: {
					md: {
						base: 'min-h-(--ctl) py-0',
					},
				},
				variant: {
					outline: 'bg-inset!',
				},
			},
		},
		textarea: {
			defaultVariants: {
				size: 'md',
			},
			variants: {
				size: {
					md: {
						base: 'min-h-(--ctl) py-1.25',
					},
				},
				variant: {
					outline: 'bg-inset!',
				},
			},
		},
		checkbox: {
			defaultVariants: {
				size: 'md',
			},
		},
		// Vysvětlivka bere třídu `.hint` z main.css: se zděděnými 14px z kořene pole by řádek popisku
		// vyrostl a input by se v mřížce propadl pod sousední pole.
		formField: {
			defaultVariants: {
				size: 'md',
			},
			slots: {
				hint: 'hint',
				description: 'hint',
				help: 'mt-1 hint',
				error: "relative mt-2 rounded-row bg-danger-soft px-3 py-2 text-meta leading-prose text-danger before:absolute before:bottom-full before:left-4 before:size-0 before:border-x-6 before:border-b-6 before:border-x-transparent before:border-b-danger-soft before:content-['']",
			},
		},
		commandPalette: {
			slots: {
				root: 'relative h-144 max-h-[calc(100dvh-48px)] divide-y-0',
				input: 'shrink-0 border-b border-line-soft [&>input]:h-18!',
				content: 'min-h-0 flex-1',
				viewport: 'scroll-pt-3 scroll-pb-24 divide-y-0 px-2 pb-24',
				group: 'p-1',
				label: 'px-3 pt-4 pb-2 text-note! font-medium text-ink-3',
				item: 'min-h-10 items-center gap-3 rounded-xl px-3 py-1.5 text-ui! before:inset-0 before:rounded-xl data-highlighted:before:bg-row-on',
				itemLeadingIcon: 'size-5 text-ink-2',
				itemLeadingAvatar: 'size-7',
				itemLabelBase: 'font-medium text-ink',
				empty: 'flex flex-1 flex-col items-center justify-center gap-3 py-12 text-meta text-ink-3',
				footer: 'pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-palette via-palette/95 to-transparent p-0 pt-8',
			},
		},
		/* Chyba, která zabere celé okno — nedostupná datová složka i pád stránky. */
		error: {
			slots: {
				root: 'flex h-screen flex-col items-center justify-center gap-2 bg-pane px-8 text-center',
				leading: 'mb-2',
				leadingIcon: 'size-8 shrink-0 text-accent',
				statusMessage: 'mt-0 text-title! font-semibold text-ink',
				message: 'mt-0 max-w-140 text-ui! leading-prose whitespace-pre-line text-ink-2',
				links: 'mt-4 flex items-center gap-2',
			},
		},
		modal: {
			slots: {
				overlay: 'fixed inset-0 bg-black/40 backdrop-blur-[2px]',
				content: 'modal-card divide-y-0 bg-palette! rounded-3xl! border border-line',
				header: 'px-5 pt-5 pb-3 min-h-0',
				body: 'px-5 pt-2 pb-12 text-ui',
				footer: 'pointer-events-none relative z-10 -mt-8 bg-linear-to-t from-palette via-palette/95 to-transparent px-5 pb-4 pt-8 justify-end gap-2 [&>*]:pointer-events-auto [&>button]:rounded-full [&>button]:px-3 [&>button]:text-title! [&>button]:border [&>button]:border-line',
				title: 'text-title font-semibold tracking-tight text-ink',
			},
		},
	},
});
