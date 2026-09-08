const fs = require('fs');
const path = require('path');

/**
 * electron-builder removes top-level locale folders on macOS, but Electron's
 * real locale payload lives inside Electron Framework.framework. Keep only the
 * two languages supported by Stasher there as well.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const localeRoot = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources'
  );

  if (!fs.existsSync(localeRoot)) return;

  const supported = new Set(['en.lproj', 'ru.lproj']);
  for (const entry of fs.readdirSync(localeRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith('.lproj') && !supported.has(entry.name)) {
      fs.rmSync(path.join(localeRoot, entry.name), { recursive: true, force: true });
    }
  }
};
