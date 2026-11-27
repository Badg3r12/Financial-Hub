// Face ID / Touch ID lock using the device's built-in passkey support (WebAuthn). The app asks the device to
// confirm it's you before showing anything, when it opens and after 5 minutes in the background.
// This is a privacy screen on this device: it keeps people who pick up your phone out of the app. It does not
// encrypt the data. If the passkey is ever lost, clearing this site's data in Settings removes the lock (your data
// comes back from sync).
const KEY = 'lockCredential', AWAY = 5 * 60e3;
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const store = { get: () => { try { return localStorage.getItem(KEY); } catch { return null; } }, set: (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* private mode */ } } };

export const supported = async () => !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false));
export const enabled = () => !!store.get();

export async function enable() {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: rand(32), rp: { name: 'Finance Hub' }, user: { id: rand(16), name: 'Finance Hub lock', displayName: 'Finance Hub' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, timeout: 60000 } });
  store.set(b64(cred.rawId));
}
export function disable() { store.set(null); }

async function verify() {
  await navigator.credentials.get({ publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64(store.get()) }], userVerification: 'required', timeout: 60000 } });
}

// Shows the lock screen and resolves once unlocked. Safari needs a tap before asking for Face ID, so there's a button.
export function gate() {
  if (!enabled()) return Promise.resolve();
  return new Promise((resolve) => {
    const el = document.createElement('div'); el.id = 'lock';
    el.innerHTML = '<img src="icon-180.png" alt=""><h2 style="margin:0">Finance Hub is locked</h2><button class="primary" id="unlock" style="min-width:200px;min-height:48px">Unlock with Face ID</button><p class="small muted" id="lock-msg"></p>';
    document.body.append(el); document.getElementById('app').style.visibility = 'hidden';
    const go = async () => {
      try { await verify(); el.remove(); document.getElementById('app').style.visibility = ''; resolve(); }
      catch (e) { el.querySelector('#lock-msg').textContent = e.name === 'NotAllowedError' ? 'Not unlocked. Tap to try again.' : 'Face ID is unavailable: ' + e.message; }
    };
    el.querySelector('#unlock').onclick = go;
    go(); // works straight away where the browser allows it; otherwise the button does
  });
}
// Lock again after time away.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (!enabled()) return;
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > AWAY && !document.getElementById('lock')) gate();
});
