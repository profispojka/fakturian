import { rmSync } from 'node:fs';
import { join } from 'node:path';

import type { AfterPackContext } from 'electron-builder';

// `electronDist` vypne úklid electron-builderu, takže výchozí appka Electronu zůstává v balíčku.
export default ({ appOutDir, packager }: AfterPackContext) => {
	const resources = join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
	rmSync(join(resources, 'default_app.asar'), { force: true });
};
