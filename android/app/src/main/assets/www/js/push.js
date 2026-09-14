// Web Push client: VAPID subscribe/unsubscribe against our own push service.
import { api } from './api.js';

const b64ToUint8 = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

// Inside the native Android wrapper (window.NBGBridge) Web Push cannot fire —
// background push there goes through FCM (docs/ANDROID.md roadmap). Report
// unsupported so the UI hides the toggle instead of creating dead subscriptions.
const inNativeWrapper = () => typeof window !== 'undefined' && !!window.NBGBridge;

export const pushSupported = () => !inNativeWrapper() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return await reg.pushManager.getSubscription();
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Push not supported in this browser');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission denied');
  const { public_key } = await api.get('/push/vapid-public', { auth: false });
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(public_key) });
  await api.post('/push/subscribe', { subscription: sub.toJSON() });
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  try { await api.del('/push/subscribe'); } catch { /* offline: server-side removal on next sync */ }
  if (sub) await sub.unsubscribe().catch(() => { });
}
