# U.I.A. Pro server
1. Node 18+. `node server.js` (sem `npm install`).
2. Variáveis (veja .env.example): STRIPE_SECRET_KEY, ADMIN_CODE, APP_URL, UPSTREAM_BASE/KEY/PRO_MODELS (modelos premium), PRO_DAILY_TOKENS.
3. O servidor entrega o app em `/` (public/index.html) já apontando para si mesmo; hospede com HTTPS (Render, Railway, Fly, VPS).
4. O código administrativo só existe na variável ADMIN_CODE do servidor; o app envia o texto digitado e o servidor compara. Tentativas limitadas por IP e registradas em data.json (audit).
5. Pagamento: o checkout é da Stripe; o Pro só é liberado quando a Stripe confirma (status complete + paid). Cancelar/reativar usam a API da Stripe.
6. data.json guarda só hashes dos tokens. Faça backup e use disco persistente no host.
