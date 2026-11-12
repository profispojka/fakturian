/**
 * In-page runtime pro screenshoty i video. Injektuje se přes
 * `addInitScript({ path })`, takže přežije i reload a SPA navigaci.
 *
 * Dvě věci, které dělá:
 *
 * 1. **Kamera.** Zoom a posun se dělají CSS transformem na `<body>`, ne
 *    ořezem hotového obrázku. Prohlížeč obsah pro každý snímek přerenderuje,
 *    takže text zůstane ostrý i při čtyřnásobném přiblížení — to je celý
 *    rozdíl mezi „demo z produktu" a „rozmazaný upscale".
 *
 * 2. **Overlay.** Kurzor, ripple po kliknutí, titulky a title cardy leží
 *    v samostatné vrstvě **mimo `<body>`**, aby je kamera nezvětšovala spolu
 *    s appkou. Stav overlaye nastavuje renderer pro každý snímek zvlášť
 *    (žádné CSS transitions) — jinak by animace běžely reálným časem a ve
 *    snímkovaném videu by poskakovaly.
 */
(() => {
	if (window.__stage) return;

	const NS = 'data-stage-overlay';
	let root: HTMLDivElement | null = null;
	let els: Record<string, HTMLElement> = {};

	function styleTag() {
		const css = `
		[${NS}] { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
			font-family: ui-sans-serif, -apple-system, "Segoe UI", Inter, system-ui, sans-serif; }
		[${NS}] * { box-sizing: border-box; }
		.stage-cursor { position: absolute; top: 0; left: 0; width: 28px; height: 28px;
			transform-origin: 4px 3px; filter: drop-shadow(0 3px 6px rgba(0,0,0,.45)); opacity: 0; }
		.stage-ripple { position: absolute; border-radius: 999px; border: 2px solid var(--stage-accent, #fff);
			background: color-mix(in srgb, var(--stage-accent, #fff) 22%, transparent);
			transform: translate(-50%, -50%); opacity: 0; }
		.stage-caption { position: absolute; left: 50%; bottom: 6%; transform: translateX(-50%);
			max-width: min(78%, 900px); padding: 14px 22px; border-radius: 14px;
			background: rgba(14,15,18,.82); color: #fff; font-size: 26px; line-height: 1.32;
			font-weight: 560; letter-spacing: -0.01em; text-align: center; opacity: 0;
			backdrop-filter: blur(12px); box-shadow: 0 12px 40px rgba(0,0,0,.35); }
		.stage-chip { position: absolute; left: 50%; top: 8%; transform: translateX(-50%);
			padding: 10px 18px; border-radius: 999px; background: rgba(14,15,18,.86); color: #fff;
			font-size: 20px; font-weight: 600; letter-spacing: .02em; opacity: 0;
			font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
		.stage-card { position: absolute; inset: 0; display: flex; flex-direction: column;
			align-items: center; justify-content: center; gap: 18px; text-align: center; opacity: 0;
			padding: 8%; color: #fff; background: #0b0c0f; }
		.stage-card .kicker { font-size: 20px; font-weight: 600; letter-spacing: .14em;
			text-transform: uppercase; color: var(--stage-accent, #7c9cff); }
		.stage-card .title { font-size: 64px; line-height: 1.05; font-weight: 680; letter-spacing: -0.03em;
			max-width: 16ch; }
		.stage-card .subtitle { font-size: 26px; line-height: 1.4; opacity: .72; max-width: 34ch; }
		.stage-mark { position: absolute; right: 28px; bottom: 24px; font-size: 18px; font-weight: 600;
			color: rgba(255,255,255,.8); opacity: 0; text-shadow: 0 2px 8px rgba(0,0,0,.5); }
		.stage-veil { position: absolute; inset: 0; background: #000; opacity: 0; }
		`;
		const tag = document.createElement('style');
		tag.textContent = css;
		return tag;
	}

	const CURSOR_SVG =
		'<svg viewBox="0 0 24 24" width="28" height="28" xmlns="http://www.w3.org/2000/svg">' +
		'<path d="M4 2.5 L4 19.2 L8.3 15.2 L11.1 21.4 L14 20 L11.2 13.9 L17.2 13.6 Z" ' +
		'fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>';

	function build() {
		if (root && root.isConnected) return;
		root = document.createElement('div');
		const overlay = root;
		overlay.setAttribute(NS, '');
		overlay.appendChild(styleTag());

		const mk = (cls: string, html?: string) => {
			const el = document.createElement('div');
			el.className = cls;
			if (html) el.innerHTML = html;
			overlay.appendChild(el);
			return el;
		};

		els = {
			veil: mk('stage-veil'),
			cursor: mk('stage-cursor', CURSOR_SVG),
			ripple: mk('stage-ripple'),
			caption: mk('stage-caption'),
			chip: mk('stage-chip'),
			card: mk('stage-card', '<div class="kicker"></div><div class="title"></div><div class="subtitle"></div>'),
			mark: mk('stage-mark'),
		};

		// Overlay patří **vedle** body, ne dovnitř — transform kamery na body
		// by ho jinak zvětšoval spolu s appkou a kurzor by rostl při zoomu.
		document.documentElement.appendChild(overlay);
	}

	function target(): HTMLElement {
		const sel = window.__stageCameraTarget;
		return (sel && document.querySelector<HTMLElement>(sel)) || document.body;
	}

	const api = {
		/** Připraví stránku i overlay. Volá renderer po každé navigaci. */
		init(opts: StageInitOptions = {}) {
			build();
			if (opts.accent) root?.style.setProperty('--stage-accent', opts.accent);
			if (opts.cameraTarget) window.__stageCameraTarget = opts.cameraTarget;
			if (opts.mark) {
				els.mark.textContent = opts.mark;
				els.mark.style.opacity = '1';
			}
			const el = target();
			el.style.transformOrigin = '0 0';
			el.style.backfaceVisibility = 'hidden';
			document.documentElement.style.overflow = 'hidden';
			if (opts.hideScrollbars !== false) {
				const s = document.createElement('style');
				s.textContent = '::-webkit-scrollbar{width:0;height:0;display:none}';
				document.head?.appendChild(s);
			}
			if (opts.freezeMotion) {
				const s = document.createElement('style');
				// Vlastní pohyb appky by se ve snímkovaném videu trhal — pohyb
				// obstarává kamera, ne komponenty.
				s.textContent =
					'*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;' +
					'transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}';
				document.head?.appendChild(s);
			}
			return true;
		},

		/**
		 * Rozměr prvku v souřadnicích **nezvětšené** stránky — kamera potřebuje
		 * vědět, kam mířit, nezávisle na tom, kde zrovna je.
		 */
		measure(selector: string | Element): StageRect | null {
			const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
			if (!el) return null;
			const node = target();
			const prev = node.style.transform;
			node.style.transform = 'none';
			const r = el.getBoundingClientRect();
			node.style.transform = prev;
			return {
				x: r.x,
				y: r.y,
				width: r.width,
				height: r.height,
			};
		},

		/** Rozměr prvku tak, jak je zrovna vidět (pro kurzor a klikání). */
		measureScreen(selector: string | Element): StageRect | null {
			const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return {
				x: r.x,
				y: r.y,
				width: r.width,
				height: r.height,
			};
		},

		viewport() {
			return {
				width: window.innerWidth,
				height: window.innerHeight,
			};
		},

		/** `{ x, y, zoom }` — x/y je střed záběru v souřadnicích nezvětšené stránky. */
		camera(state: StageCameraState = {}) {
			const node = target();
			const z = state?.zoom ?? 1;
			const W = window.innerWidth;
			const H = window.innerHeight;
			const cx = state?.x ?? W / 2;
			const cy = state?.y ?? H / 2;
			const tx = W / 2 - z * cx;
			const ty = H / 2 - z * cy;
			node.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${z.toFixed(4)})`;
			return true;
		},

		cursor(x: number, y: number, opts: StageCursorOptions = {}) {
			build();
			const scale = opts.pressed ? 0.82 : 1;
			els.cursor.style.opacity = String(opts.opacity ?? 1);
			els.cursor.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
		},

		hideCursor() {
			if (els.cursor) els.cursor.style.opacity = '0';
		},

		/** `progress` 0→1; renderer ripple kreslí ručně snímek po snímku. */
		ripple(x: number, y: number, progress?: number | null) {
			build();
			if (progress === null || progress === undefined || progress >= 1) {
				els.ripple.style.opacity = '0';
				return;
			}
			const size = 24 + 120 * progress;
			els.ripple.style.width = `${size}px`;
			els.ripple.style.height = `${size}px`;
			els.ripple.style.left = `${x}px`;
			els.ripple.style.top = `${y}px`;
			els.ripple.style.opacity = String(Math.max(0, 1 - progress) * 0.9);
		},

		caption(text?: string | null, opacity = 1) {
			build();
			if (text !== null && text !== undefined) els.caption.textContent = text;
			els.caption.style.opacity = String(text ? opacity : 0);
		},

		chip(text?: string | null, opacity = 1) {
			build();
			if (text !== null && text !== undefined) els.chip.textContent = text;
			els.chip.style.opacity = String(text ? opacity : 0);
		},

		card(data?: StageCard | null, opacity = 1) {
			build();
			if (data) {
				const kicker = els.card.querySelector<HTMLElement>('.kicker');
				const title = els.card.querySelector<HTMLElement>('.title');
				const subtitle = els.card.querySelector<HTMLElement>('.subtitle');
				if (kicker) kicker.textContent = data.kicker ?? '';
				if (title) title.textContent = data.title ?? '';
				if (subtitle) subtitle.textContent = data.subtitle ?? '';
				if (data.background) els.card.style.background = data.background;
				if (data.color) els.card.style.color = data.color;
			}
			els.card.style.opacity = String(opacity);
		},

		veil(opacity = 0) {
			build();
			els.veil.style.opacity = String(opacity);
		},

		/** Schová overlay a vrátí kameru na výchozí — používá `shoot.ts`. */
		reset() {
			build();
			api.camera({ zoom: 1 });
			els.caption.style.opacity = '0';
			els.chip.style.opacity = '0';
			els.card.style.opacity = '0';
			els.cursor.style.opacity = '0';
			els.ripple.style.opacity = '0';
			els.veil.style.opacity = '0';
		},

		/** Skryje celý overlay (čisté screenshoty bez kurzoru a titulků). */
		hide() {
			if (root) root.style.display = 'none';
		},

		show() {
			if (root) root.style.display = '';
		},
	};

	window.__stage = api;
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => build(), { once: true });
	} else {
		build();
	}
})();
