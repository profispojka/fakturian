interface HasId {
	id: string;
}

export function upsertById<T extends HasId>(list: T[], item: T): T[] {
	const i = list.findIndex((x) => x.id === item.id);
	if (i >= 0) return list.with(i, item);
	return [...list, item];
}

export function upsertManyById<T extends HasId>(list: T[], items: T[]): T[] {
	const byId = new Map(list.map((item) => [item.id, item]));
	for (const item of items) byId.set(item.id, item);
	return [...byId.values()];
}

export function normalizeSearchText(value: string): string {
	return value
		.trim()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}
