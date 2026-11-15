import { z as zod } from 'zod';

import {
	asciiAlphaNumeric,
	bankAccount,
	bankCode,
	dateString,
	ico,
	isdocDate,
	isdocDateOrBlank,
	zip,
} from '~/utils/zod/schemas';

// Tady, ne v pluginu: modul importuje každé schéma, takže hlášky jsou české i v testech bez Nuxtu.
zod.config(zod.locales.cs());

export type * as Zod from 'zod';

export const z = {
	...zod,
	asciiAlphaNumeric,
	dateString,
	isdocDate,
	isdocDateOrBlank,
	ico,
	zip,
	bankAccount,
	bankCode,
};
