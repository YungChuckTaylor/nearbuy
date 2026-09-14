// NearBuyGoods seed dataset — Lagos, Nigeria demo market.
// Prices in NGN. Coordinates approximate real Lagos districts.

const H = 3600e3;
const now = Date.now();
const day = 86400e3;
const ago = (d) => new Date(now - d * day).toISOString();

function history(price, drift = 0.06, points = 8) {
  const out = [];
  let p = price * (1 + drift);
  for (let i = points - 1; i >= 0; i--) {
    out.push({ t: ago(i * 7), price: Math.round(p / 50) * 50 });
    p += (price - p) * 0.35 + (Math.sin(i * 2.1) * price * 0.012);
  }
  out.push({ t: new Date().toISOString(), price });
  return out;
}

export function buildSeed() {
  const users = [
    { id: 'u1', name: 'Demo Shopper', email: 'shopper@nearbuygoods.app', phone: '+2348012340001', role: 'shopper', points: 120, stats: { searches: 14, saves: 3, reviews: 1, reservations: 2 }, badges: ['first_search', 'saver'], prefs: { radius_km: 10, units: 'km', currency: 'NGN', lat: 6.5244, lng: 3.3792, loc_label: 'Lagos, NG', notify_push: true, notify_email: false, notify_deals: true, notify_stock: true, font_scale: 1, high_contrast: false, reduce_motion: false }, created: ago(60) },
    { id: 'u2', name: 'Adaeze Okafor', email: 'owner@nearbuygoods.app', phone: '+2348012340002', role: 'store_owner', points: 340, stats: { searches: 2, saves: 0, reviews: 0, reservations: 0 }, badges: [], prefs: { radius_km: 15, units: 'km', currency: 'NGN', lat: 6.6018, lng: 3.3515, loc_label: 'Ikeja, Lagos', notify_push: true, notify_email: true, notify_deals: true, notify_stock: true, font_scale: 1, high_contrast: false, reduce_motion: false }, created: ago(120) },
    { id: 'u3', name: 'Platform Admin', email: 'admin@nearbuygoods.app', phone: '+2348012340003', role: 'admin', points: 0, stats: { searches: 0, saves: 0, reviews: 0, reservations: 0 }, badges: [], prefs: { radius_km: 25, units: 'km', currency: 'NGN', lat: 6.5244, lng: 3.3792, loc_label: 'Lagos, NG', notify_push: true, notify_email: true, notify_deals: false, notify_stock: false, font_scale: 1, high_contrast: false, reduce_motion: false }, created: ago(200) },
    { id: 'u4', name: 'Tunde Bakare', email: 'tunde@lekifashion.ng', role: 'store_owner', points: 90, stats: { searches: 0, saves: 0, reviews: 0, reservations: 0 }, badges: [], prefs: { radius_km: 10, units: 'km', currency: 'NGN', lat: 6.4398, lng: 3.4219, loc_label: 'Lekki, Lagos', notify_push: true, notify_email: false, notify_deals: true, notify_stock: true, font_scale: 1, high_contrast: false, reduce_motion: false }, created: ago(90) },
    { id: 'u5', name: 'Chidi Emezue', email: 'chidi@yabagrocers.ng', role: 'store_owner', points: 60, stats: { searches: 0, saves: 0, reviews: 0, reservations: 0 }, badges: [], prefs: { radius_km: 10, units: 'km', currency: 'NGN', lat: 6.5158, lng: 3.3789, loc_label: 'Yaba, Lagos', notify_push: true, notify_email: false, notify_deals: true, notify_stock: true, font_scale: 1, high_contrast: false, reduce_motion: false }, created: ago(90) },
  ];
  // passwords are set at boot by the server (scrypt hash of "demo1234")

  const stores = [
    { id: 's1', name: 'TechHub Point', owner_id: 'u2', tags: ['electronics', 'computers'], desc: 'Computer Village specialist for phones, laptops, audio and accessories. Price-match on verified competitors.', address: '14 Otigba Street, Computer Village', area: 'Ikeja', city: 'Lagos', lat: 6.6023, lng: 3.3543, phone: '+234 802 111 2233', email: 'hello@techhubpoint.ng', verified: true, tz: 1, hours: { 0: null, 1: ['08:30', '19:00'], 2: ['08:30', '19:00'], 3: ['08:30', '19:00'], 4: ['08:30', '19:00'], 5: ['08:30', '19:00'], 6: ['09:00', '17:00'] }, payments: ['card', 'transfer', 'cash'], delivery: true, curbside: false, pickup: true, wheelchair: true, emoji: '🔌', followers: 412, views: 3120, matches: 861, clicks: 640 },
    { id: 's2', name: 'MegaMart Ikeja City Mall', owner_id: 'u2', tags: ['supermarket', 'groceries', 'general'], desc: 'Full-range supermarket: groceries, home essentials, small electronics and cosmetics under one roof.', address: 'Ikeja City Mall, Obafemi Awolowo Way', area: 'Ikeja', city: 'Lagos', lat: 6.6067, lng: 3.3525, phone: '+234 802 444 5566', email: 'care@megamart.ng', verified: true, tz: 1, hours: { 0: ['12:00', '20:00'], 1: ['09:00', '21:00'], 2: ['09:00', '21:00'], 3: ['09:00', '21:00'], 4: ['09:00', '21:00'], 5: ['09:00', '21:00'], 6: ['09:00', '21:00'] }, payments: ['card', 'transfer', 'cash'], delivery: true, curbside: true, pickup: true, wheelchair: true, emoji: '🛒', followers: 980, views: 5210, matches: 1204, clicks: 903 },
    { id: 's3', name: 'Lekki Fashion Hub', owner_id: 'u4', tags: ['fashion', 'clothing', 'shoes'], desc: 'Curated fashion boutique — sneakers, bags, ankara and office wear. New drops every Friday.', address: '27 Admiralty Way, Lekki Phase 1', area: 'Lekki', city: 'Lagos', lat: 6.4398, lng: 3.4219, phone: '+234 803 777 8899', email: 'style@lekkifashion.ng', verified: true, tz: 1, hours: { 0: ['13:00', '19:00'], 1: ['10:00', '20:00'], 2: ['10:00', '20:00'], 3: ['10:00', '20:00'], 4: ['10:00', '20:00'], 5: ['10:00', '20:00'], 6: ['10:00', '20:00'] }, payments: ['card', 'transfer'], delivery: true, curbside: false, pickup: true, wheelchair: false, emoji: '👗', followers: 655, views: 2870, matches: 512, clicks: 431 },
    { id: 's4', name: 'Yaba Market Grocers', owner_id: 'u5', tags: ['groceries', 'market'], desc: 'Wholesale & retail grocers at Yaba market gate. Best bulk prices on rice, oil and flour.', address: '3 Sabo Road, Yaba', area: 'Yaba', city: 'Lagos', lat: 6.5158, lng: 3.3789, phone: '+234 805 222 3344', email: 'orders@yabagrocers.ng', verified: false, tz: 1, hours: { 0: null, 1: ['07:30', '18:30'], 2: ['07:30', '18:30'], 3: ['07:30', '18:30'], 4: ['07:30', '18:30'], 5: ['07:30', '18:30'], 6: ['07:30', '18:30'] }, payments: ['cash', 'transfer'], delivery: false, curbside: false, pickup: true, wheelchair: false, emoji: '🧺', followers: 233, views: 1490, matches: 620, clicks: 300 },
    { id: 's5', name: 'Surulere Home & Living', owner_id: 'u5', tags: ['home', 'furniture', 'appliances'], desc: 'Furniture, cooking sets and home appliances with island-wide delivery and assembly.', address: '45 Adeniran Ogunsanya, Surulere', area: 'Surulere', city: 'Lagos', lat: 6.4969, lng: 3.3564, phone: '+234 806 555 6677', email: 'hello@surulerehome.ng', verified: true, tz: 1, hours: { 0: null, 1: ['09:00', '18:00'], 2: ['09:00', '18:00'], 3: ['09:00', '18:00'], 4: ['09:00', '18:00'], 5: ['09:00', '18:00'], 6: ['09:00', '16:00'] }, payments: ['card', 'transfer', 'cash'], delivery: true, curbside: false, pickup: true, wheelchair: true, emoji: '🛋️', followers: 187, views: 980, matches: 260, clicks: 175 },
    { id: 's6', name: 'VI Beauty Co.', owner_id: 'u4', tags: ['beauty', 'cosmetics'], desc: 'Authentic skincare, fragrance and hair products. Batch-verified, NAFDAC listed.', address: '12 Adeola Odeku, Victoria Island', area: 'Victoria Island', city: 'Lagos', lat: 6.4368, lng: 3.4058, phone: '+234 807 888 9900', email: 'glow@vibeauty.ng', verified: true, tz: 1, hours: { 0: ['12:00', '18:00'], 1: ['09:30', '19:30'], 2: ['09:30', '19:30'], 3: ['09:30', '19:30'], 4: ['09:30', '19:30'], 5: ['09:30', '19:30'], 6: ['09:30', '19:30'] }, payments: ['card', 'transfer'], delivery: true, curbside: true, pickup: true, wheelchair: true, emoji: '💄', followers: 501, views: 2210, matches: 388, clicks: 322 },
    { id: 's7', name: 'SPAR Express Oniru', owner_id: 'u4', tags: ['supermarket', 'groceries', 'convenience'], desc: 'Neighbourhood convenience store: groceries, drinks, household items. Open late.', address: '5 Akin Olugbade Street, Oniru', area: 'Oniru', city: 'Lagos', lat: 6.4419, lng: 3.4098, phone: '+234 808 111 0022', email: 'oniru@sparexpress.ng', verified: true, tz: 1, hours: { 0: ['08:00', '22:00'], 1: ['08:00', '22:00'], 2: ['08:00', '22:00'], 3: ['08:00', '22:00'], 4: ['08:00', '22:00'], 5: ['08:00', '22:00'], 6: ['08:00', '22:00'] }, payments: ['card', 'transfer', 'cash'], delivery: true, curbside: true, pickup: true, wheelchair: true, emoji: '🏪', followers: 344, views: 1730, matches: 540, clicks: 350 },
    { id: 's8', name: 'Allen Avenue Pharmacy', owner_id: 'u5', tags: ['pharmacy', 'health'], desc: 'Licensed pharmacy (PCN reg. 12488). Medicines, wellness and home diagnostics.', address: '21 Allen Avenue, Ikeja', area: 'Allen Avenue', city: 'Lagos', lat: 6.6041, lng: 3.3619, phone: '+234 809 333 4455', email: 'care@allenpharmacy.ng', verified: true, tz: 1, hours: { 0: ['09:00', '20:00'], 1: ['08:00', '21:00'], 2: ['08:00', '21:00'], 3: ['08:00', '21:00'], 4: ['08:00', '21:00'], 5: ['08:00', '21:00'], 6: ['09:00', '20:00'] }, payments: ['card', 'transfer', 'cash'], delivery: true, curbside: false, pickup: true, wheelchair: true, emoji: '💊', followers: 289, views: 1120, matches: 205, clicks: 168 },
  ];

  const P = (id, name, brand, category, emoji, tags, colors = [], barcode = null, desc = '') =>
    ({ id, name, brand, category, emoji, tags, colors, barcode, desc, created: ago(30) });

  const products = [
    P('p1', 'Wireless Earbuds Pro ANC', 'Soundcore', 'electronics', '🎧', ['earbuds', 'bluetooth', 'headphones', 'audio', 'anc'], ['#111111', '#f5f5f5'], '6151000000011', 'Active noise cancelling true-wireless earbuds, 34h playtime with case.'),
    P('p2', '65W GaN Fast Charger', 'Anker', 'electronics', '🔌', ['charger', 'usb-c', 'gan', 'adapter'], ['#f5f5f5', '#111111'], '6151000000028', '3-port GaN charger, folds flat, charges laptops and phones.'),
    P('p3', 'Smart Watch S9', 'Oraimo', 'electronics', '⌚', ['watch', 'smartwatch', 'fitness'], ['#111111', '#c9a26b'], '6151000000035', 'AMOLED display, BT calling, 7-day battery.'),
    P('p4', '10000mAh Power Bank', 'Xiaomi', 'electronics', '🔋', ['power bank', 'charging', 'portable'], ['#111111', '#f5f5f5'], '6151000000042', '22.5W fast charge, dual output, airline safe.'),
    P('p5', '55" 4K Smart TV', 'Hisense', 'electronics', '📺', ['tv', 'television', '4k', 'smart tv'], ['#111111'], '6151000000059', '4K UHD VIDAA smart TV with Netflix & YouTube.'),
    P('p6', 'BoomGo Bluetooth Speaker', 'Oraimo', 'electronics', '🔊', ['speaker', 'bluetooth', 'audio'], ['#0f4c81', '#111111'], '6151000000066', '24W party speaker, IPX6, 12h playtime.'),
    P('p7', 'UrbanRun Sneakers', 'Nike', 'fashion', '👟', ['sneakers', 'shoes', 'running', 'trainers'], ['#f5f5f5', '#111111', '#d64545'], null, 'Lightweight running sneakers, breathable knit upper.'),
    P('p8', 'Ankara Print Shirt', 'Local Atelier', 'fashion', '👔', ['ankara', 'shirt', 'african print', 'clothing'], ['#e87b29', '#2fbcC7'.toLowerCase(), '#232c5c'], null, 'Hand-tailored cotton ankara shirt, unisex fit.'),
    P('p9', 'Leather Handbag', 'Zara', 'fashion', '👜', ['handbag', 'bag', 'leather', 'accessories'], ['#8a5a3b', '#111111'], null, 'Structured top-handle leather handbag.'),
    P('p10', 'Super Eagles Jersey 25/26', 'Nike', 'fashion', '👕', ['jersey', 'football', 'sports wear'], ['#3aa655', '#f5f5f5'], null, 'Official match jersey, sizes S–XXL.'),
    P('p11', 'Parboiled Rice 5kg', 'Golden Penny', 'groceries', '🍚', ['rice', 'grains', 'staple'], ['#f5f0e0'], '6151000000110', 'Stone-free parboiled rice, 5kg bag.'),
    P('p12', 'Vegetable Oil 1L', 'Kings', 'groceries', '🫗', ['oil', 'cooking oil', 'vegetable oil'], ['#e8b429'], '6151000000127', 'Cholesterol-free pure vegetable oil.'),
    P('p13', 'Indomie Carton (40 packs)', 'Indomie', 'groceries', '🍜', ['noodles', 'indomie', 'carton'], ['#d64545', '#e8b429'], '6151000000134', 'Chicken flavour instant noodles, full carton.'),
    P('p14', 'Semovita 5kg', 'Golden Penny', 'groceries', '🥣', ['semovita', 'swallow', 'flour'], ['#f5f0e0'], '6151000000141', 'Smooth semolina for swallow, 5kg.'),
    P('p15', '3-Seater Sofa (Oakville)', 'Oakville', 'home', '🛋️', ['sofa', 'couch', 'furniture', 'living room'], ['#6b7280', '#8a5a3b'], null, '3-seater fabric sofa with hardwood frame.'),
    P('p16', '18" Standing Fan', 'Ox', 'home', '🌀', ['fan', 'standing fan', 'cooling'], ['#111111', '#f5f5f5'], '6151000000165', '3-speed standing fan with wide oscillation.'),
    P('p17', 'Non-stick Pot Set (5pc)', 'Tefal', 'home', '🍲', ['pot', 'cookware', 'non-stick'], ['#d64545', '#111111'], null, '5-piece granite-effect non-stick set.'),
    P('p18', 'LED Bulb 9W (4 pack)', 'Philips', 'home', '💡', ['bulb', 'led', 'lighting'], ['#f5f5f5'], '6151000000189', 'Energy-saving LED bulbs, 4-pack.'),
    P('p19', 'Shea Butter Cream 500ml', 'Nubian', 'beauty', '🧴', ['shea butter', 'moisturizer', 'skincare'], ['#f0e0c0'], null, 'Raw whipped shea butter cream, unscented.'),
    P('p20', 'Vitamin C Serum 30ml', 'Garnier', 'beauty', '🧪', ['serum', 'vitamin c', 'skincare', 'face'], ['#e8a129'], '6151000000202', 'Brightening vitamin C serum with SPF-friendly formula.'),
    P('p21', 'Perfume Oil 12ml', 'Al-Rehab', 'beauty', '🌸', ['perfume', 'fragrance', 'oil'], ['#c9a26b'], null, 'Long-lasting alcohol-free perfume oil.'),
    P('p22', 'Paracetamol 500mg (100 tabs)', 'Emzor', 'pharmacy', '💊', ['paracetamol', 'painkiller', 'medicine'], ['#f5f5f5'], '6151000000226', 'NAFDAC-registered analgesic tablets.'),
    P('p23', 'Multivitamin Tabs (30ct)', 'Centrum', 'pharmacy', '️', ['multivitamin', 'supplement', 'wellness'], ['#e87b29'], '6151000000233', 'Daily multivitamin & mineral tablets.'),
    P('p24', 'Digital Thermometer', 'Omron', 'pharmacy', '🌡️', ['thermometer', 'diagnostic', 'health'], ['#f5f5f5'], '6151000000240', 'Fast-read digital clinical thermometer.'),
    P('p25', 'Football Size 5', 'Adidas', 'sports', '', ['football', 'ball', 'soccer'], ['#f5f5f5', '#111111'], '6151000000257', 'Training football, machine-stitched.'),
    P('p26', 'Yoga Mat 6mm', 'Decathlon', 'sports', '🧘', ['yoga', 'mat', 'fitness'], ['#7c6bc8', '#2fbcc7'], null, 'Non-slip 6mm exercise mat with strap.'),
    P('p27', 'JAMB Prep Pack (4 texts)', 'LearnLite', 'books', '📚', ['jamb', 'textbook', 'exam prep', 'stationery'], ['#232c5c'], null, 'Complete JAMB/UTME preparation set.'),
    P('p28', 'Smart Phone X5 (128GB)', 'Tecno', 'electronics', '📱', ['phone', 'smartphone', 'android', 'mobile'], ['#111111', '#7c6bc8'], '6151000000288', '6.6" AMOLED, 5000mAh, 256GB-expandable.'),
  ];

  const O = (id, store_id, product_id, price, stock, condition = 'new') =>
    ({ id, store_id, product_id, price, currency: 'NGN', stock, condition, updated_at: ago(Math.random() * 3), price_history: history(price), views: 20 + Math.floor(Math.random() * 180), clicks: 5 + Math.floor(Math.random() * 60) });

  const offers = [
    O('o1', 's1', 'p1', 28500, 12), O('o2', 's2', 'p1', 31900, 6), O('o3', 's7', 'p1', 33000, 0),
    O('o4', 's1', 'p2', 9500, 25), O('o5', 's2', 'p2', 11200, 10), O('o6', 's7', 'p2', 12500, 4),
    O('o7', 's1', 'p3', 42000, 8), O('o8', 's2', 'p3', 45500, 3), O('o9', 's7', 'p3', 48500, 5),
    O('o10', 's1', 'p4', 15500, 30), O('o11', 's2', 'p4', 17400, 14), O('o12', 's7', 'p4', 19000, 0),
    O('o13', 's1', 'p5', 385000, 4), O('o14', 's5', 'p5', 412000, 2),
    O('o15', 's1', 'p6', 24500, 9), O('o16', 's2', 'p6', 26900, 7), O('o17', 's7', 'p6', 27900, 2),
    O('o18', 's3', 'p7', 38000, 7), O('o19', 's2', 'p7', 45500, 2),
    O('o20', 's3', 'p8', 12500, 15), O('o21', 's4', 'p8', 16000, 3),
    O('o22', 's3', 'p9', 28000, 5), O('o23', 's6', 'p9', 35500, 2),
    O('o24', 's3', 'p10', 15500, 20), O('o25', 's2', 'p10', 19500, 8),
    O('o26', 's4', 'p11', 8200, 60), O('o27', 's2', 'p11', 8900, 42), O('o28', 's7', 'p11', 9400, 18),
    O('o29', 's4', 'p12', 2100, 120), O('o30', 's2', 'p12', 2400, 80), O('o31', 's7', 'p12', 2600, 35),
    O('o32', 's4', 'p13', 13500, 25), O('o33', 's2', 'p13', 14600, 30), O('o34', 's7', 'p13', 15200, 12),
    O('o35', 's4', 'p14', 7800, 40), O('o36', 's2', 'p14', 8300, 26), O('o37', 's7', 'p14', 8600, 9),
    O('o38', 's5', 'p15', 285000, 3), O('o39', 's2', 'p15', 340000, 1),
    O('o40', 's5', 'p16', 32000, 11), O('o41', 's2', 'p16', 35500, 6), O('o42', 's7', 'p16', 38500, 0),
    O('o43', 's5', 'p17', 26500, 8), O('o44', 's2', 'p17', 31000, 4),
    O('o45', 's5', 'p18', 6200, 50), O('o46', 's2', 'p18', 6900, 33), O('o47', 's7', 'p18', 7400, 21),
    O('o48', 's6', 'p19', 4500, 24), O('o49', 's2', 'p19', 5400, 15), O('o50', 's7', 'p19', 6000, 7),
    O('o51', 's6', 'p20', 18500, 10), O('o52', 's2', 'p20', 21500, 6), O('o53', 's7', 'p20', 24000, 3),
    O('o54', 's6', 'p21', 9500, 18), O('o55', 's7', 'p21', 13000, 5),
    O('o56', 's8', 'p22', 1800, 200), O('o57', 's2', 'p22', 2200, 90), O('o58', 's7', 'p22', 2500, 44),
    O('o59', 's8', 'p23', 6500, 32), O('o60', 's2', 'p23', 7400, 20), O('o61', 's7', 'p23', 8200, 8),
    O('o62', 's8', 'p24', 7500, 14), O('o63', 's2', 'p24', 8900, 5), O('o64', 's7', 'p24', 9800, 2),
    O('o65', 's3', 'p25', 12500, 16), O('o66', 's2', 'p25', 14500, 9), O('o67', 's5', 'p25', 16000, 4),
    O('o68', 's5', 'p26', 14500, 7), O('o69', 's3', 'p26', 18000, 3),
    O('o70', 's4', 'p27', 9500, 22), O('o71', 's2', 'p27', 12000, 10),
    O('o72', 's1', 'p28', 165000, 9), O('o73', 's2', 'p28', 172500, 4), O('o74', 's7', 'p28', 179000, 0),
  ];

  const R = (id, store_id, product_id, user_id, name, rating, text, d, helpful = 0) =>
    ({ id, store_id, product_id: product_id || null, user_id, user_name: name, rating, text, helpful, responses: [], created: ago(d) });

  const reviews = [
    R('r1', 's1', 'p1', 'u1', 'Demo Shopper', 5, 'Found it in 2 minutes via photo search — price was exactly as listed. ANC is superb.', 4, 6),
    R('r2', 's1', null, 'u1', 'Demo Shopper', 4, 'Computer Village chaos but this shop is organised. Prices update fast here.', 9, 3),
    R('r3', 's2', 'p11', 'u4', 'Tunde Bakare', 5, 'Rice promo price honoured at the till. Queue was short on a Tuesday.', 2, 8),
    R('r4', 's3', 'p7', 'u1', 'Demo Shopper', 4, 'Sneakers authentic, sizes run small — go half size up.', 6, 5),
    R('r5', 's4', null, 'u2', 'Adaeze Okafor', 4, 'Bulk prices genuinely the best on the mainland. Cash & transfer only though.', 12, 2),
    R('r6', 's6', 'p20', 'u5', 'Chidi Emezue', 5, 'Serum sealed and batch-verified. Staff checked NAFDAC code with me.', 3, 4),
    R('r7', 's7', null, 'u1', 'Demo Shopper', 4, 'Open till 10pm saved me. Curbside pickup worked smoothly.', 7, 1),
    R('r8', 's8', 'p22', 'u4', 'Tunde Bakare', 5, 'Pharmacist on duty at all hours I visited. Fair prices.', 5, 2),
    R('r9', 's5', 'p15', 'u2', 'Adaeze Okafor', 3, 'Sofa quality good but delivery took 6 days to Ikeja.', 15, 3),
    R('r10', 's2', null, 'u5', 'Chidi Emezue', 4, 'One-stop for everything; parking at the mall fills up by noon.', 8, 7),
  ];
  reviews[0].responses.push({ by: 'u2', name: 'Adaeze Okafor (Owner)', text: 'Thank you! We price-match any verified Computer Village listing.', created: ago(3) });

  const deals = [
    { id: 'd1', store_id: 's1', title: 'Back-to-school tech week — 10% off chargers & power banks', pct: 10, product_ids: ['p2', 'p4'], ends_at: new Date(now + 6 * day).toISOString(), created: ago(1) },
    { id: 'd2', store_id: 's2', title: 'Rice & oil bundle promo', pct: 7, product_ids: ['p11', 'p12'], ends_at: new Date(now + 3 * day).toISOString(), created: ago(2) },
    { id: 'd3', store_id: 's3', title: 'Weekend fashion flash — 15% off sneakers & bags', pct: 15, product_ids: ['p7', 'p9'], ends_at: new Date(now + 2 * day).toISOString(), created: ago(0.4) },
    { id: 'd4', store_id: 's7', title: 'Late-night essentials: buy 2 get 5% off', pct: 5, product_ids: [], ends_at: new Date(now + 9 * day).toISOString(), created: ago(4) },
  ];

  const saved = [
    { user_id: 'u1', product_id: 'p1', watch: true, saved_price: 29500, created: ago(5) },
    { user_id: 'u1', product_id: 'p11', watch: true, saved_price: 8600, created: ago(3) },
    { user_id: 'u1', product_id: 'p16', watch: false, saved_price: 33500, created: ago(1.5) },
  ];

  const notifications = [
    { id: 'n1', user_id: 'u1', type: 'price_drop', title: 'Price drop on Wireless Earbuds Pro ANC', body: 'TechHub Point now ₦28,500 (was ₦29,500) — 3.4% below your saved price.', data: { route: '#/product/p1' }, read: false, created: ago(0.3) },
    { id: 'n2', user_id: 'u1', type: 'deal', title: 'Deal near you: 15% off at Lekki Fashion Hub', body: 'Weekend fashion flash on sneakers & bags ends in 2 days.', data: { route: '#/store/s3' }, read: false, created: ago(0.5) },
    { id: 'n3', user_id: 'u1', type: 'reservation', title: 'Reservation NBG-4821 ready for pickup', body: 'MegaMart Ikeja City Mall is holding your item at the service desk.', data: { route: '#/saved' }, read: true, created: ago(2) },
  ];

  const reservations = [
    { id: 'res1', code: 'NBG-4821', user_id: 'u1', store_id: 's2', product_id: 'p11', qty: 2, status: 'ready', created: ago(2) },
  ];

  const searches = [
    { q: 'wireless earbuds', count: 48 }, { q: 'rice 5kg', count: 41 }, { q: 'power bank', count: 33 },
    { q: 'sneakers', count: 29 }, { q: 'standing fan', count: 22 }, { q: 'vegetable oil', count: 19 },
  ];

  const flags = [
    { id: 'f1', type: 'review', target: 'r5', reason: 'Possible competitor review spam', status: 'open', created: ago(1.2) },
    { id: 'f2', type: 'listing', target: 'o39', reason: 'Price far above market average — verify', status: 'open', created: ago(0.6) },
  ];

  const meta = {
    currency: 'NGN',
    city: 'Lagos',
    flags: { ar_beta: false, group_shopping: false, ai_assistant: true },
    spark: { views: [42, 51, 47, 63, 58, 71, 66], matches: [18, 22, 25, 24, 31, 29, 35], clicks: [9, 12, 11, 15, 14, 18, 17] },
  };

  return { users, stores, products, offers, reviews, deals, saved, notifications, reservations, searches, flags, meta, push_subs: [], payments: [], collections: [{ id: 'col1', user_id: 'u1', name: 'Kitchen renovation', created: ago(10) }], counters: { offer: 100, review: 100, deal: 100, reservation: 100, notification: 100, flag: 100, user: 100, hist: 100, col: 100, pay: 100 } };
}
