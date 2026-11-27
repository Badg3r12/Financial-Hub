// Backups: a full export of your data, saved where you choose — iCloud Drive, Google Drive, OneDrive or this device.
//
// How each destination works:
//  • On iPhone/iPad (and Android), the share sheet can save to any of them: choose "Save to Files" and pick the
//    drive (Google Drive and OneDrive appear there once their apps are installed).
//  • Google Drive / OneDrive on a computer: if you've added a sign-in ID under Settings → Backup (free, one-time,
//    see README), the file uploads straight into a "Finance Hub backups" folder (Google) or Apps/Finance Hub (OneDrive).
//    Without one, the file is saved to Downloads and the drive's website opens so you can drag it in.
//  • iCloud Drive on a computer: Apple has no upload API for websites, so the file is saved to Downloads and
//    iCloud Drive opens (on a Mac you can also save it straight into the iCloud Drive folder).
import * as S from './store.js';
import { h, today, daysBetween } from './util.js';
import { toast, openSheet, closeSheet, busy } from './ui.js';

const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } } };
export const lastBackup = () => ls.get('lastBackup');
export const backupDue = () => { const lb = lastBackup(); return S.all('txns').length > 0 && (!lb || daysBetween(lb, today()) > 7) && ls.get('backupSnooze') !== today(); };
export const snoozeBackup = () => ls.set('backupSnooze', today());
const done = (where) => { ls.set('lastBackup', today()); ls.set('lastBackupWhere', where); };

const fileName = () => `finance-hub-backup-${today()}.json`;
const makeFile = () => new File([JSON.stringify(S.exportAll(), null, 1)], fileName(), { type: 'application/json' });
const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = () => isApple() || /Android/i.test(navigator.userAgent);
const canShareFile = (f) => !!navigator.canShare?.({ files: [f] });
export const cloudIds = () => S.setting('cloudBackup', {});

const SITES = { icloud: 'https://www.icloud.com/iclouddrive/', google: 'https://drive.google.com/drive/my-drive', onedrive: 'https://onedrive.live.com/' };
const NAMES = { icloud: 'iCloud Drive', google: 'Google Drive', onedrive: 'OneDrive', device: 'this device' };

function download(file) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function share(file, where) {
  try { await navigator.share({ files: [file], title: 'Finance Hub backup' }); done(where); toast(`Backup saved`); return true; }
  catch (e) { if (e.name === 'AbortError') return false; throw e; }
}

// ---- Sign-in (OAuth, browser-only token flow; nothing is stored except a short-lived token for this session) ----
const AUTH = {
  google: (id, redirect, state) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'token', scope: 'https://www.googleapis.com/auth/drive.file', state, prompt: 'select_account', include_granted_scopes: 'true' })}`,
  onedrive: (id, redirect, state) => `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'token', scope: 'Files.ReadWrite.AppFolder', state, prompt: 'select_account' })}`,
};
export const redirectUri = () => new URL('oauth.html', location.href.split('#')[0]).href;
async function token(provider) {
  const cached = (() => { try { return JSON.parse(sessionStorage.getItem('tok-' + provider) || 'null'); } catch { return null; } })();
  if (cached && cached.exp > Date.now() + 60e3) return cached.token;
  const id = cloudIds()[provider]; const state = crypto.getRandomValues(new Uint32Array(2)).join('-');
  ls.set('oauthResult', null);
  const w = window.open(AUTH[provider](id, redirectUri(), state), 'fh-auth', 'width=520,height=680');
  if (!w) throw new Error('The sign-in window was blocked. Allow pop-ups for this site and try again.');
  return new Promise((resolve, reject) => {
    const finish = (r) => {
      if (!r || r.state !== state) return;
      window.removeEventListener('storage', onStore); window.removeEventListener('message', onMsg); clearTimeout(t); ls.set('oauthResult', null);
      if (r.error) return reject(new Error(r.error));
      try { sessionStorage.setItem('tok-' + provider, JSON.stringify({ token: r.token, exp: Date.now() + (r.expires || 3000) * 1000 })); } catch { /* ignore */ }
      resolve(r.token);
    };
    const onStore = (e) => { if (e.key === 'oauthResult' && e.newValue) { try { finish(JSON.parse(e.newValue)); } catch { /* ignore */ } } };
    const onMsg = (e) => { if (e.origin === location.origin && e.data?.type === 'fh-oauth') finish(e.data); };
    window.addEventListener('storage', onStore); window.addEventListener('message', onMsg);
    const t = setTimeout(() => { window.removeEventListener('storage', onStore); window.removeEventListener('message', onMsg); reject(new Error('Sign-in timed out.')); }, 180e3);
  });
}
async function api(url, tok, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + tok, ...(opts.headers || {}) } });
  if (!r.ok) { const body = await r.text().catch(() => ''); throw new Error(`Upload failed (${r.status}) ${body.slice(0, 140)}`); }
  return r.json();
}
async function uploadGoogle(file) {
  const tok = await token('google'), folderName = 'Finance Hub backups';
  const q = encodeURIComponent(`name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  let folder = (await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, tok)).files?.[0]?.id;
  if (!folder) folder = (await api('https://www.googleapis.com/drive/v3/files?fields=id', tok, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' }) })).id;
  const b = 'fh' + Date.now(), meta = JSON.stringify({ name: file.name, parents: [folder], mimeType: 'application/json' });
  const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n`, file, `\r\n--${b}--`]);
  await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', tok, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
}
async function uploadOneDrive(file) {
  const tok = await token('onedrive');
  await api(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(file.name)}:/content`, tok, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: file });
}

// Save to one destination. Returns true when the backup was saved (or handed to the share sheet).
export async function backupTo(where) {
  const file = makeFile();
  if (where === 'device') {
    if (isMobile() && canShareFile(file)) return share(file, where);
    download(file); done(where); toast(`Saved ${file.name} to Downloads`); return true;
  }
  const direct = (where === 'google' || where === 'onedrive') && cloudIds()[where];
  if (direct) {
    await busy(`Uploading to ${NAMES[where]}`, () => (where === 'google' ? uploadGoogle(file) : uploadOneDrive(file)), `Saved to ${NAMES[where]}`);
    done(where); return true;
  }
  if (isMobile() && canShareFile(file)) return share(file, where);
  download(file); done(where);
  window.open(SITES[where], '_blank', 'noopener');
  toast(`Saved ${file.name} to Downloads. Drag it into ${NAMES[where]} in the tab that just opened.`, { ms: 9000 });
  return true;
}

// The chooser shown by "Back up now" (Home) and "Back up" (Settings).
export function saveBackup() {
  const ids = cloudIds(), mobile = isMobile(), last = ls.get('lastBackupWhere');
  const how = (k) => k === 'device' ? (mobile ? 'Opens the share sheet' : 'Saves to your Downloads folder')
    : (k !== 'icloud' && ids[k]) ? 'Uploads directly' + (mobile ? '' : ' (you sign in once per session)')
    : mobile ? `Opens the share sheet: choose ${isApple() ? `Save to Files → ${NAMES[k]}` : NAMES[k]}${k === 'icloud' ? '' : ` (needs the ${NAMES[k]} app)`}`
    : k === 'icloud' ? (/Mac/.test(navigator.platform) ? 'Saves to Downloads and opens iCloud Drive (or save it straight into the iCloud Drive folder)' : 'Saves to Downloads and opens iCloud Drive on the web to drag it in')
    : `Saves to Downloads and opens ${NAMES[k]} to drag it in`;
  return new Promise((resolve) => openSheet(h`<div class="row between"><h2>Back up to…</h2><button class="link" data-close>Close</button></div>
    <p class="small muted" style="margin-top:0">A full copy of your data as one file. Keep a few; restore any of them from Settings.${lastBackup() ? ` Last backup: ${lastBackup()}${last ? ` (${NAMES[last] || last})` : ''}.` : ''}</p>
    <ul class="list">${['icloud', 'google', 'onedrive', 'device'].map((k) => h`<li class="tap" data-dest="${k}"><div class="grow"><b>${{ icloud: 'iCloud Drive', google: 'Google Drive', onedrive: 'OneDrive', device: 'This device' }[k]}</b>${k === last ? h` <span class="pill">last used</span>` : ''}<div class="small muted">${how(k)}</div></div></li>`)}</ul>
    ${!mobile && (!ids.google || !ids.onedrive) ? h`<p class="small muted">To upload to Google Drive or OneDrive directly instead of dragging the file in, add their free sign-in IDs under Settings → Backup (steps in the README).</p>` : ''}`, (root) => {
    root.querySelectorAll('[data-dest]').forEach((el) => el.onclick = async () => {
      try { const ok = await backupTo(el.dataset.dest); if (ok) { closeSheet(); resolve(true); } }
      catch (e) { toast(e.message, { ms: 8000 }); }
    });
    root.querySelector('[data-close]').addEventListener('click', () => resolve(false));
  }));
}
