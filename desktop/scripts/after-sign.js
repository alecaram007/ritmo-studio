'use strict';
// electron-builder afterSign hook (macOS).
// The app is ad-hoc signed (`mac.identity: "-"`): no Apple certificate, no notarization.
// Apple Silicon refuses to run unsigned code, so verify the signature here and, if it is
// missing or broken, ad-hoc sign the whole bundle with codesign before the dmg/zip are made.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

function verify(appPath) {
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!verify(appPath)) {
    console.log(`  • [after-sign] signature missing/invalid, ad-hoc signing ${appPath}`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    if (!verify(appPath)) throw new Error(`codesign verification failed for ${appPath}`);
  }
  console.log(`  • [after-sign] code signature OK (ad-hoc): ${path.basename(appPath)}`);
};
