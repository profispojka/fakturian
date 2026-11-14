import { beforeAll, describe, expect, it } from 'vitest';

import plugin from '~/plugins/context-menu.client';

// Opakované zavěšení by nevadilo (rozhoduje jen cíl události), ale bylo by matoucí.
beforeAll(() => {
	plugin(useNuxtApp());
});

/** Musí být v dokumentu, aby událost dobublala až na okno, kde plugin poslouchá. */
function contextMenu(element: HTMLElement) {
	document.body.append(element);
	const e = new MouseEvent('contextmenu', {
		bubbles: true,
		cancelable: true,
	});
	element.dispatchEvent(e);
	element.remove();
	return e;
}

describe('kontextová nabídka', () => {
	it('mimo datová pole se zakáže', () => {
		const e = contextMenu(document.createElement('div'));

		expect(e.defaultPrevented).toBe(true);
	});

	it('v textovém poli zůstane systémová', () => {
		const e = contextMenu(document.createElement('input'));

		expect(e.defaultPrevented).toBe(false);
	});

	it('nad vybíratelným obsahem zůstane systémová', () => {
		const div = document.createElement('div');
		div.className = 'selectable';

		const e = contextMenu(div);

		expect(e.defaultPrevented).toBe(false);
	});

	it('mimo prvek nic nespadne', () => {
		const e = new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
		});
		document.dispatchEvent(e);

		expect(e.defaultPrevented).toBe(true);
	});
});
