import {
	z as zod,
	type infer as ZodInfer,
	type ZodError as ZodErrorType,
	type ZodObject as ZodObjectType,
	type ZodRawShape as ZodRawShapeType,
	type ZodType as ZodTypeBase,
} from 'zod';

import { bankAccount, bankCode, dateString, ico, isdocDate, isdocDateOrBlank, zip } from '~/utils/zod/schemas';

// Tady, ne v pluginu: modul importuje každé schéma, takže hlášky jsou české i v testech bez Nuxtu.
zod.config(zod.locales.cs());

export namespace Zod {
	export type infer<T extends ZodTypeBase> = ZodInfer<T>;
	export type ZodType<Output = unknown, Input = unknown> = ZodTypeBase<Output, Input>;
	export type ZodError<T = unknown> = ZodErrorType<T>;
	export type ZodObject<Shape extends ZodRawShapeType> = ZodObjectType<Shape>;
	export type ZodRawShape = ZodRawShapeType;
}

export const z = {
	...zod,
	dateString,
	isdocDate,
	isdocDateOrBlank,
	ico,
	zip,
	bankAccount,
	bankCode,
};
