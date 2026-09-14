/**
 * Paystack integration (test-mode first).
 * - With PAYSTACK_SECRET_KEY set: real hosted-checkout flow (initialize → verify → webhook).
 * - Without keys: built-in branded test-mode simulator at /pay/sim that exercises the
 *   exact same fulfilment path, so the loop is demonstrable end-to-end.
 * Amounts in kobo (NGN subunits).
 */
import crypto from 'node:crypto';

export const SECRET = process.env.PAYSTACK_SECRET_KEY || '';
export const LIVE = !!SECRET;
const API = 'https://api.paystack.co';

export const PLANS = {
  shopper_premium: { id: 'shopper_premium', name: 'Shopper Premium', amount: 150000, per: 'month', perks: ['Unlimited searches', 'No ads', 'Priority price alerts', 'Price-drop predictions'] },
  shopper_family: { id: 'shopper_family', name: 'Family Plan', amount: 250000, per: 'month', perks: ['Everything in Premium', 'Up to 6 household members', 'Shared watchlists & collections'] },
  store_basic: { id: 'store_basic', name: 'Store Basic', amount: 1500000, per: 'month', perks: ['200 live listings', 'Basic analytics', 'Deal posting'] },
  store_pro: { id: 'store_pro', name: 'Store Professional', amount: 3500000, per: 'month', perks: ['Unlimited listings', 'Full analytics & trends', 'Promotion tools', 'POS integration (when live)'] },
};

export async function initialize({ email, amount, reference, callbackUrl }) {
  if (!LIVE) {
    return { authorization_url: `/pay/sim?ref=${encodeURIComponent(reference)}`, reference, simulated: true };
  }
  const res = await fetch(`${API}/transaction/initialize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, amount, reference, callback_url: callbackUrl }),
  });
  const json = await res.json();
  if (!json.status) throw new Error(json.message || 'Paystack initialize failed');
  return { authorization_url: json.data.authorization_url, reference, simulated: false };
}

export async function verify(reference) {
  if (!LIVE) return null; // simulator fulfils directly via /payments/_sim/confirm
  const res = await fetch(`${API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const json = await res.json();
  return json.status ? json.data : null;
}

export function validWebhookSignature(rawBody, signature) {
  if (!LIVE) return false;
  const expect = crypto.createHmac('sha512', SECRET).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(signature || '')); } catch { return false; }
}
