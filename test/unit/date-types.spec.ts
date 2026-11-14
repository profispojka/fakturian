import { expectTypeOf, it } from 'vitest';

import type { DateString, YearMonthString } from '~/utils/date';

it('datum i období lze předat jako string, ale vyžadují validaci a zakazují manipulaci po znacích', () => {
	expectTypeOf<DateString>().toExtend<string>();
	expectTypeOf<YearMonthString>().toExtend<string>();
	expectTypeOf<string>().not.toExtend<DateString>();
	expectTypeOf<string>().not.toExtend<YearMonthString>();
	expectTypeOf<DateString>().not.toExtend<YearMonthString>();
	expectTypeOf<YearMonthString>().not.toExtend<DateString>();
	expectTypeOf<DateString['split']>().toBeNever();
	expectTypeOf<DateString['slice']>().toBeNever();
	expectTypeOf<DateString['padStart']>().toBeNever();
	expectTypeOf<YearMonthString['split']>().toBeNever();
	expectTypeOf<YearMonthString['slice']>().toBeNever();
	expectTypeOf<YearMonthString['padStart']>().toBeNever();
});
