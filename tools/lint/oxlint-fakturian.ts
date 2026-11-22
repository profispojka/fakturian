import { awaitStandalone } from './rules/await-standalone.ts';
import { blankLineAroundMultilineStatements } from './rules/blank-line-around-multiline-statements.ts';
import { commentStyle } from './rules/comment-style.ts';
import { complexity } from './rules/complexity.ts';
import { componentPath } from './rules/component-path.ts';
import { constantsDataOnly } from './rules/constants-data-only.ts';
import { errorTextRule } from './rules/error-text.ts';
import { exactText } from './rules/exact-text.ts';
import { noAliasFunction } from './rules/no-alias-function.ts';
import { noContractMock } from './rules/no-contract-mock.ts';
import { noDelete } from './rules/no-delete.ts';
import { noDoubleAssertion } from './rules/no-double-assertion.ts';
import { noIife } from './rules/no-iife.ts';
import { noProvideInject } from './rules/no-provide-inject.ts';
import { noWrappingIf } from './rules/no-wrapping-if.ts';
import { objectMultiline } from './rules/object-multiline.ts';
import { shortcutGuard } from './rules/shortcut-guard.ts';
import { submitByButton } from './rules/submit-by-button.ts';
import { testIdSelector } from './rules/test-id-selector.ts';

export default {
	meta: {
		name: 'fakturian',
	},
	rules: {
		'blank-line-around-multiline-statements': blankLineAroundMultilineStatements,
		'no-iife': noIife,
		'no-delete': noDelete,
		'no-double-assertion': noDoubleAssertion,
		'no-wrapping-if': noWrappingIf,
		'no-provide-inject': noProvideInject,
		complexity,
		'await-standalone': awaitStandalone,
		'error-text': errorTextRule,
		'shortcut-guard': shortcutGuard,
		'test-id-selector': testIdSelector,
		'submit-by-button': submitByButton,
		'constants-data-only': constantsDataOnly,
		'no-contract-mock': noContractMock,
		'component-path': componentPath,
		'no-alias-function': noAliasFunction,
		'comment-style': commentStyle,
		'exact-text': exactText,
		'object-multiline': objectMultiline,
	},
};
