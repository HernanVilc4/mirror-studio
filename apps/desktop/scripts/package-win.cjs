// Portable Windows build WITHOUT electron-builder: official Electron win32 zip (checksum-verified by @electron/get)
// + the compiled app. Output: release/Mirror-Studio-win32-x64.zip. Unzip anywhere on Windows and run "Mirror Studio.exe".
// No installer, no firewall rule: run docs/FIREWALL.md's netsh command once as admin.
// Usage (from repo root, after `npm run build`): node apps/desktop/scripts/package-win.cjs
const { downloadArtifact } = require('@electron/get')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '../../..'), app = path.join(root, 'apps/desktop')
const version = require('electron/package.json').version
const out = path.join(root, 'release'), dir = path.join(out, 'Mirror-Studio-win32-x64')

/** Puts the brand ICO (16–256 px) into the renamed electron.exe, so Explorer and the taskbar show MirrorStudio. */
function setExeIcon(exePath, icoPath) {
  let ResEdit
  try { ResEdit = require('resedit') } catch { console.warn('WARN: resedit not installed (comes with electron-builder): the .exe keeps the Electron icon'); return }
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath))
  const res = ResEdit.NtExecutableResource.from(exe)
  const icons = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath)).icons.map((i) => i.data)
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)
  if (!groups.length) throw new Error('electron.exe has no icon group to replace')
  for (const g of groups) ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, icons)
  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
}
;(async () => {
  if (!fs.existsSync(path.join(app, 'out/main/index.js'))) throw new Error('Run `npm run build` first')
  const zip = await downloadArtifact({ version, platform: 'win32', arch: 'x64', artifactName: 'electron' }) // verifies SHASUMS256
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
  execFileSync('unzip', ['-q', zip, '-d', dir])
  fs.renameSync(path.join(dir, 'electron.exe'), path.join(dir, 'Mirror Studio.exe'))
  setExeIcon(path.join(dir, 'Mirror Studio.exe'), path.join(app, 'build/icon.ico'))
  const res = path.join(dir, 'resources'); fs.rmSync(path.join(res, 'default_app.asar'), { force: true })
  const a = path.join(res, 'app'); fs.mkdirSync(path.join(a, 'node_modules'), { recursive: true })
  fs.cpSync(path.join(app, 'out'), path.join(a, 'out'), { recursive: true })
  fs.mkdirSync(path.join(a, 'build'), { recursive: true }); fs.copyFileSync(path.join(app, 'build/icon.png'), path.join(a, 'build/icon.png'))
  fs.cpSync(path.join(root, 'node_modules/ws'), path.join(a, 'node_modules/ws'), { recursive: true }) // the only runtime dependency left external
  fs.writeFileSync(path.join(a, 'package.json'), JSON.stringify({ name: 'mirror-studio', version: '0.1.0', main: 'out/main/index.js' }, null, 2))
  fs.copyFileSync(path.join(root, 'docs/FIREWALL.md'), path.join(dir, 'FIREWALL.md'))
  const zipOut = path.join(out, 'Mirror-Studio-win32-x64.zip'); fs.rmSync(zipOut, { force: true })
  execFileSync('zip', ['-qr', zipOut, path.basename(dir)], { cwd: out })
  console.log('OK', zipOut, (fs.statSync(zipOut).size / 1e6).toFixed(0) + ' MB')
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
