# CLAUDE — PROJECT CONTEXT
> Автогенеровано: 2026-03-12

## Що це за проєкт
DiaDem — повністю децентралізована соціальна мережа що працює в браузері. Кожна вкладка — незалежний блокчейн-нод з P2P синхронізацією.

## Стек
- Frontend: Vanilla JS (SPA, без фреймворків)
- Backend: Node.js (HTTP + WebSocket signaling server)
- Crypto: ECDSA P-256, SHA-256, Web Crypto API
- P2P: WebRTC + BroadcastChannel + WebSocket relay
- Storage: localStorage (ключі), in-memory (блокчейн, CAS)
- Залежності: тільки `ws` (WebSocket для сервера)

## Структура
```
DiaDem/
├── index.html              — Лендінг + SPA shell (~1100 рядків)
├── server.js               — HTTP + WebSocket signaling + bootstrap нода
├── package.json            — Залежності (ws@8.18.0)
├── css/style.css           — Теми (світла/темна), всі компоненти (~3500 рядків)
├── images/                 — Статичні ресурси
├── data/                   — Стан сервер-ноди (server-state.json)
│
└── src/
    ├── diadem.js           — Головний оркестратор DiaDemNode (~1170 рядків)
    ├── i18n.js             — Переклади EN + UK, 900+ ключів
    │
    ├── core/
    │   ├── blockchain.js   — Ланцюг блоків, mempool, валідація
    │   ├── block.js        — Структура блоку, генезис
    │   ├── transaction.js  — 20+ типів транзакцій, підписання
    │   └── state.js        — WorldState — весь стан мережі (~955 рядків)
    │
    ├── crypto/
    │   └── keys.js         — ECDSA P-256, seed-фрази, access keys
    │
    ├── consensus/
    │   └── pos.js          — Proof of Stake (10s блоки, stake-weighted)
    │
    ├── network/
    │   ├── peer.js         — WebRTC data channels + chunking
    │   ├── protocol.js     — Синхронізація блоків, форк-резолюція
    │   ├── signaling.js    — WebSocket сигналінг, peer discovery
    │   └── ipfs.js         — IPFS bridge (CAS → IPFS gateway)
    │
    ├── storage/
    │   ├── cas.js          — Content-Addressable Storage
    │   └── db.js           — localStorage обгортка (KeyStore)
    │
    └── ui/
        └── app.js          — Весь фронтенд (~4300 рядків)
```

## Точки входу
- Dev: `npm run dev` або `node server.js --dev`
- Prod: `npm start` або `node server.js`
- Порт: 3000 (за замовчуванням), `--port PORT` для зміни

## Важливі файли
- `src/diadem.js`: DiaDemNode клас — оркеструє все (wallet, blockchain, network, CAS, consensus)
- `src/ui/app.js`: Весь UI — рендеринг, роутинг, форми, модалки (найбільший файл)
- `src/core/state.js`: WorldState — баланси, пости, фоловери, стейкінг, DM, репутація
- `src/crypto/keys.js`: Генерація ключів, seed-фрази, access keys (DDM1-... формат)
- `src/i18n.js`: Двомовність (en/uk), функція t(key)

## Патерни які використовуються в проєкті
- **Транзакції**: всі дії (пост, лайк, фолов, DM) — це Transaction з типом з TX_TYPES
- **CAS**: контент зберігається в Content-Addressable Storage по хешу, на блокчейні тільки хеш
- **Event emitter**: DiaDemNode має on/emit для UI-оновлень (stateChange, block, transaction)
- **P2P sync**: BroadcastChannel між вкладками, WebRTC/WS relay між пристроями
- **Access Keys**: формат DDM1-{base64url(JSON)} для імпорту гаманця
- **Feed rendering**: renderFeed() → node.getExplorePosts() → renderPost() → innerHTML
- **i18n**: t('key') повертає переклад, ключі у snake_case
- **Persistence**: localStorage для wallet/settings/CAS cache, всі через KeyStore

## ENV змінні (без значень!)
- Немає .env файлів — все конфігурується через CLI аргументи (--port, --dev)

## Відомі проблеми / Tech debt
- `src/ui/app.js` на 4300 рядків — кандидат для розбиття на модулі
- Дублювання реініціалізації в diadem.js (createWallet, importFromSeed, _reinitAfterImport)
- Немає тестів
- Немає збірки/бандлера — всі ES modules напряму з браузера

## Що НЕ чіпати
- `src/core/block.js`: Генезис-блок має бути ідентичний на всіх нодах
- `src/crypto/keys.js`: Криптографічні функції — зміни зламають існуючі гаманці
- DECOR_PRICES в state.js: Мають збігатися з SHOP_ITEMS в app.js
