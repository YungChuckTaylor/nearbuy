// Login / register with demo-account quick fill.
import { h, toast, btn } from '../ui.js';
import { ic } from '../ui.js';
import { api, setToken } from '../api.js';
import { state, loadSession, refreshUnread } from '../store.js';

export function renderAuth(onDone) {
  let mode = 'login';
  const root = h('div', { style: { maxWidth: '440px', margin: '0 auto' } });
  const head = h('div', { style: { textAlign: 'center', margin: '18px 0 22px' } });
  head.innerHTML = `<div style="width:74px;height:74px;margin:0 auto 12px;border-radius:22px;background:#232c5c;display:grid;place-items:center">${'<svg viewBox="0 0 64 64" width="46" height="46"><path d="M32 60C32 60 10 40.5 10 26a22 22 0 1 1 44 0C54 40.5 32 60 32 60z" fill="#fff"/><path d="M20 33h24v4.5H20z" fill="#2fbcc7"/><path d="M25 20h10v13H25z" fill="#e87b29"/><path d="M34 22h8v11h-8z" fill="#e56a8c"/></svg>'}</div>
  <h1 style="margin:0;font-size:1.5rem;letter-spacing:-.02em">Welcome to NearBuyGoods</h1>
  <p class="muted small" style="margin:6px 0 0">Upload any item. Find it at stores near you. Instantly.</p>`;

  const form = h('div', { class: 'card' });
  const seg = h('div', { class: 'seg', style: { width: '100%', marginBottom: '16px' } },
    h('button', { class: 'active', onclick: () => setMode('login') }, 'Log in'),
    h('button', { onclick: () => setMode('register') }, 'Create account'));

  const email = h('input', { class: 'input', type: 'email', placeholder: 'Email', autocomplete: 'email', value: 'shopper@nearbuygoods.app' });
  const pass = h('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', value: 'demo1234' });
  const name = h('input', { class: 'input', placeholder: 'Full name', autocomplete: 'name' });
  const role = h('select', { class: 'input' },
    h('option', { value: 'shopper', text: 'I shop — find items near me' }),
    h('option', { value: 'store_owner', text: 'I run a store — list my inventory' }));
  // Name/Role inputs live inside these field wrappers — setMode must toggle the
  // WRAPPERS. Toggling only the inputs leaves the wrappers display:none, so the
  // fields never show in register mode and name submits empty (signup 400).
  const nameField = h('label', { class: 'field' }, h('span', { text: 'Name' }), name);
  const roleField = h('label', { class: 'field' }, h('span', { text: 'Role' }), role);
  const submit = h('button', { class: 'btn primary block', onclick: submitFn }, 'Log in');

  function setMode(m) {
    mode = m;
    [...seg.children].forEach((b, i) => b.classList.toggle('active', (i === 0) === (m === 'login')));
    nameField.style.display = m === 'register' ? '' : 'none';
    roleField.style.display = m === 'register' ? '' : 'none';
    pass.setAttribute('autocomplete', m === 'register' ? 'new-password' : 'current-password');
    submit.textContent = m === 'register' ? 'Create account' : 'Log in';
  }
  async function submitFn() {
    if (mode === 'register') {
      if (!name.value.trim()) { toast('Please enter your full name.', 'bad'); name.focus(); return; }
      if (pass.value.length < 8) { toast('Password must be at least 8 characters.', 'bad'); pass.focus(); return; }
    }
    submit.disabled = true;
    try {
      const res = mode === 'login'
        ? await api.post('/auth/login', { email: email.value, password: pass.value }, { auth: false })
        : await api.post('/auth/register', { name: name.value, email: email.value, password: pass.value, role: role.value }, { auth: false });
      setToken(res.token);
      await loadSession();
      await refreshUnread();
      toast(`Welcome, ${state.user.name.split(' ')[0]}!`, 'ok');
      onDone();
    } catch (e) { toast(e.message, 'bad'); }
    submit.disabled = false;
  }

  const demo = h('div', { class: 'card', style: { marginTop: '12px' } },
    h('div', { class: 'tiny bold muted', style: { marginBottom: '8px' }, text: 'DEMO ACCOUNTS (password: demo1234)' }),
    ...[
      ['🛒 Shopper', 'shopper@nearbuygoods.app'],
      ['🏪 Store owner', 'owner@nearbuygoods.app'],
      ['⚙️ Admin', 'admin@nearbuygoods.app'],
    ].map(([label, em]) => h('button', {
      class: 'listrow', onclick: () => { email.value = em; pass.value = 'demo1234'; setMode('login'); submitFn(); },
    }, h('span', { class: 'ic' }, ic('user', 18)), h('span', { class: 'col grow' }, h('span', { class: 'bold small', text: label }), h('span', { class: 'tiny muted', text: em })), h('span', { class: 'chev' }, ic('arrowR', 16)))));

  const guest = h('button', { class: 'btn outline block', style: { marginTop: '12px' }, onclick: () => onDone() }, 'Continue as guest');

  form.append(seg,
    h('label', { class: 'field' }, h('span', { text: 'Email' }), email),
    nameField,
    roleField,
    h('label', { class: 'field' }, h('span', { text: 'Password' }), pass),
    submit,
    h('p', { class: 'tiny muted', style: { margin: '12px 0 0', textAlign: 'center' }, text: 'Social login (Google/Apple), OTP & biometrics are wired as extension points — see docs/RESEARCH.md §1.' }));

  root.append(head, form, demo, guest);
  setMode('login');
  return root;
}
