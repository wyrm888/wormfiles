// Windows integration: open folders in WormFiles instead of File Explorer, and register Worm as a browser.
// Everything is written under HKEY_CURRENT_USER (no admin needed) and can be fully undone.
const { app, shell } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const VERB = 'openinwormfiles';
const WIN_E_CLSID = '{52205fd8-5dfb-447d-801a-d0b52f2e83e1}'; // what Win+E opens
const URL_PROGID = 'WormFilesURL';
const HTML_PROGID = 'WormFilesHTML';
const CLIENT_KEY = 'Software\\Clients\\StartMenuInternet\\WormFiles';

// The icon Windows shows for WormFiles' registrations: the custom app icon if one is set, otherwise the .exe's
let customIcon = null;
function setIconFile(p) { customIcon = p && fs.existsSync(p) ? p : null; }
function iconRef() { return regStr(customIcon ? customIcon : `"${exePath()}",0`); }

// The .exe that should be launched (the portable build runs from a temp copy, so use the real file)
function exePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}
// Command line Windows should run. "--" stops Chromium from treating the target as a switch.
function command(arg) {
  const exe = `"${exePath()}"`;
  const dev = app.isPackaged ? '' : ` "${app.getAppPath()}"`;
  return `${exe}${dev} -- ${arg}`;
}

const regStr = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function importReg(lines) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return resolve(false);
    const file = path.join(os.tmpdir(), `wormfiles-${Date.now()}-${Math.random().toString(36).slice(2)}.reg`);
    const body = 'Windows Registry Editor Version 5.00\r\n\r\n' + lines.join('\r\n') + '\r\n';
    fs.writeFileSync(file, '﻿' + body, 'utf16le');
    execFile('reg.exe', ['import', file], { windowsHide: true }, (err) => {
      fs.unlink(file, () => {});
      err ? reject(err) : resolve(true);
    });
  });
}

function regQuery(key, value) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const args = ['query', key];
    if (value) args.push('/v', value); else args.push('/ve');
    execFile('reg.exe', args, { windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      const m = /REG_\w+\s+(.*)$/m.exec(out);
      resolve(m ? m[1].trim() : null);
    });
  });
}

// ---------- Folders: replace File Explorer ----------
async function enableExplorerReplacement() {
  const icon = iconRef();
  const cmd = regStr(command('"%1"'));
  const lines = [];
  for (const cls of ['Directory', 'Drive']) {
    lines.push(
      `[HKEY_CURRENT_USER\\Software\\Classes\\${cls}\\shell]`, `@="${VERB}"`, '',
      `[HKEY_CURRENT_USER\\Software\\Classes\\${cls}\\shell\\${VERB}]`, '@="Open in WormFiles"', `"Icon"=${icon}`, '',
      `[HKEY_CURRENT_USER\\Software\\Classes\\${cls}\\shell\\${VERB}\\command]`, `@=${cmd}`, ''
    );
  }
  lines.push(
    `[HKEY_CURRENT_USER\\Software\\Classes\\CLSID\\${WIN_E_CLSID}\\shell\\opennewwindow\\command]`,
    `@=${regStr(command('--this-pc'))}`, '"DelegateExecute"=""', '"CreatedBy"="WormFiles"', ''
  );
  return importReg(lines);
}

async function disableExplorerReplacement() {
  const lines = [];
  for (const cls of ['Directory', 'Drive']) {
    const cur = await regQuery(`HKCU\\Software\\Classes\\${cls}\\shell`);
    if (cur === VERB) lines.push(`[HKEY_CURRENT_USER\\Software\\Classes\\${cls}\\shell]`, '@=-', '');
    lines.push(`[-HKEY_CURRENT_USER\\Software\\Classes\\${cls}\\shell\\${VERB}]`, '');
  }
  const winE = await regQuery(`HKCU\\Software\\Classes\\CLSID\\${WIN_E_CLSID}\\shell\\opennewwindow\\command`, 'CreatedBy');
  if (winE === 'WormFiles') lines.push(`[-HKEY_CURRENT_USER\\Software\\Classes\\CLSID\\${WIN_E_CLSID}]`, '');
  return importReg(lines);
}

async function explorerReplacementActive() {
  return (await regQuery('HKCU\\Software\\Classes\\Directory\\shell')) === VERB;
}

// ---------- Worm: register as a browser ----------
async function registerBrowser() {
  const icon = iconRef();
  const cmd = regStr(command('"%1"'));
  const lines = [];
  for (const [progid, name] of [[URL_PROGID, 'Worm URL'], [HTML_PROGID, 'Worm HTML Document']]) {
    lines.push(
      `[HKEY_CURRENT_USER\\Software\\Classes\\${progid}]`, `@="${name}"`, ...(progid === URL_PROGID ? ['"URL Protocol"=""'] : []), '',
      `[HKEY_CURRENT_USER\\Software\\Classes\\${progid}\\DefaultIcon]`, `@=${icon}`, '',
      `[HKEY_CURRENT_USER\\Software\\Classes\\${progid}\\Application]`, '"ApplicationName"="Worm"', `"ApplicationIcon"=${icon}`,
      '"ApplicationCompany"="WormFiles"', '"ApplicationDescription"="The private browser built into WormFiles"', '',
      `[HKEY_CURRENT_USER\\Software\\Classes\\${progid}\\shell\\open\\command]`, `@=${cmd}`, ''
    );
  }
  lines.push(
    `[HKEY_CURRENT_USER\\${CLIENT_KEY}]`, '@="Worm"', '',
    `[HKEY_CURRENT_USER\\${CLIENT_KEY}\\DefaultIcon]`, `@=${icon}`, '',
    `[HKEY_CURRENT_USER\\${CLIENT_KEY}\\shell\\open\\command]`, `@=${regStr(`"${exePath()}"`)}`, '',
    `[HKEY_CURRENT_USER\\${CLIENT_KEY}\\Capabilities]`,
    '"ApplicationName"="Worm"', '"ApplicationDescription"="The private browser built into WormFiles"', `"ApplicationIcon"=${icon}`, '',
    `[HKEY_CURRENT_USER\\${CLIENT_KEY}\\Capabilities\\URLAssociations]`,
    `"http"="${URL_PROGID}"`, `"https"="${URL_PROGID}"`, '',
    `[HKEY_CURRENT_USER\\${CLIENT_KEY}\\Capabilities\\FileAssociations]`,
    `".htm"="${HTML_PROGID}"`, `".html"="${HTML_PROGID}"`, `".xhtml"="${HTML_PROGID}"`, `".pdf"="${HTML_PROGID}"`, `".svg"="${HTML_PROGID}"`, '',
    `[HKEY_CURRENT_USER\\${CLIENT_KEY}\\Capabilities\\StartMenu]`, '"StartMenuInternet"="WormFiles"', '',
    '[HKEY_CURRENT_USER\\Software\\RegisteredApplications]', `"WormFiles"=${regStr(CLIENT_KEY + '\\Capabilities')}`, ''
  );
  return importReg(lines);
}

async function isDefaultBrowser() {
  const id = await regQuery('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', 'ProgId');
  return id === URL_PROGID;
}

// Windows 11 doesn't let apps make themselves the default: open Settings on Worm's page
async function openDefaultAppsSettings() {
  await registerBrowser();
  await shell.openExternal('ms-settings:defaultapps?registeredAppUser=WormFiles').catch(() => shell.openExternal('ms-settings:defaultapps'));
}

// ---------- Videos & music: register WormFiles as a media player ----------
const MEDIA_PROGID = 'WormFilesMedia';
const MEDIA_APP_KEY = 'Software\\WormFiles\\Player';
const MEDIA_REG_NAME = 'WormFilesPlayer';
const MEDIA_EXTS = ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv', 'mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'aac', 'opus', 'weba'];
async function registerMediaPlayer() {
  const icon = iconRef();
  const cmd = regStr(command('"%1"'));
  const lines = [
    `[HKEY_CURRENT_USER\\Software\\Classes\\${MEDIA_PROGID}]`, '@="WormFiles video or song"', '',
    `[HKEY_CURRENT_USER\\Software\\Classes\\${MEDIA_PROGID}\\DefaultIcon]`, `@=${icon}`, '',
    `[HKEY_CURRENT_USER\\Software\\Classes\\${MEDIA_PROGID}\\Application]`, '"ApplicationName"="WormFiles"', `"ApplicationIcon"=${icon}`,
    '"ApplicationCompany"="WormFiles"', '"ApplicationDescription"="Plays videos and music in WormFiles"', '',
    `[HKEY_CURRENT_USER\\Software\\Classes\\${MEDIA_PROGID}\\shell\\open]`, '@="Play in WormFiles"', '',
    `[HKEY_CURRENT_USER\\Software\\Classes\\${MEDIA_PROGID}\\shell\\open\\command]`, `@=${cmd}`, ''
  ];
  for (const ext of MEDIA_EXTS) lines.push(`[HKEY_CURRENT_USER\\Software\\Classes\\.${ext}\\OpenWithProgids]`, `"${MEDIA_PROGID}"=""`, '');
  lines.push(
    `[HKEY_CURRENT_USER\\${MEDIA_APP_KEY}\\Capabilities]`,
    '"ApplicationName"="WormFiles"', '"ApplicationDescription"="Plays videos and music in WormFiles"', `"ApplicationIcon"=${icon}`, '',
    `[HKEY_CURRENT_USER\\${MEDIA_APP_KEY}\\Capabilities\\FileAssociations]`,
    ...MEDIA_EXTS.map(ext => `".${ext}"="${MEDIA_PROGID}"`), '',
    '[HKEY_CURRENT_USER\\Software\\RegisteredApplications]', `"${MEDIA_REG_NAME}"=${regStr(MEDIA_APP_KEY + '\\Capabilities')}`, ''
  );
  return importReg(lines);
}
async function isDefaultMediaPlayer() {
  const id = await regQuery('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.mp4\\UserChoice', 'ProgId');
  return id === MEDIA_PROGID;
}
async function openMediaDefaults() {
  await registerMediaPlayer();
  await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${MEDIA_REG_NAME}`).catch(() => shell.openExternal('ms-settings:defaultapps'));
}

// ---------- Launch arguments ----------
// Turns process arguments into things to open: folders, files, web addresses
function parseTargets(argv) {
  let args = argv.slice(1);
  if (!app.isPackaged) args = args.slice(1); // skip the app folder when run with `electron .`
  const sepIdx = args.indexOf('--');
  const after = sepIdx >= 0 ? args.slice(sepIdx + 1) : args.filter(a => !a.startsWith('-'));
  const targets = [];
  if (args.includes('--this-pc')) targets.push({ kind: 'thispc' });
  for (let a of after) {
    if (!a || a === '.' || a === '--this-pc') continue;
    a = a.replace(/^"|"$/g, ''); // a drive arrives as C:" because Windows reads \" as an escaped quote
    if (/^https?:\/\//i.test(a) || /^file:\/\//i.test(a)) targets.push({ kind: 'url', target: a });
    else if (/^[a-z]:[\\/]?/i.test(a) || a.startsWith('\\\\')) {
      if (/^[a-z]:$/i.test(a)) a += '\\';
      let kind = 'file';
      try { kind = fs.statSync(a).isDirectory() ? 'folder' : 'file'; } catch { /* missing */ }
      targets.push({ kind, target: a });
    }
  }
  return targets;
}

module.exports = {
  enableExplorerReplacement, disableExplorerReplacement, explorerReplacementActive,
  registerBrowser, isDefaultBrowser, openDefaultAppsSettings, parseTargets, exePath,
  registerMediaPlayer, isDefaultMediaPlayer, openMediaDefaults, setIconFile
};
