import { rmSync } from 'node:fs';
import { join } from 'node:path';

// `electronDist` vypne úklid electron-builderu, takže výchozí appka Electronu zůstává v balíčku.
export default ({ appOutDir, packager }) => {
  const resources = join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
  rmSync(join(resources, 'default_app.asar'), { force: true });
};
