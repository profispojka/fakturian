interface TsMutationReport {
	files: Record<string, { mutants: { status: string; statusReason?: string }[] }>;
}

export function requireTsMutations(report: TsMutationReport): void {
	const mutants = Object.values(report.files).flatMap((file) => file.mutants);
	if (
		!mutants.length ||
		mutants.some(
			(mutant) =>
				!['Killed', 'CompileError'].includes(mutant.status) &&
				!(mutant.status === 'Ignored' && mutant.statusReason?.trim()),
		)
	) {
		throw new Error(
			'Mutace nejsou ověřené: survivor, nepokrytý mutant, timeout, nezdůvodněná výjimka nebo prázdná sada.',
		);
	}
}
