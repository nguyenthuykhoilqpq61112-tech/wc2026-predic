# Railway FastAPI Deployment

This deploys only the FastAPI backend.

## Dashboard

1. Railway → New Project → Deploy from GitHub repo.
2. Select `nguyenthuykhoilqpq61112-tech/wc2026-predic`.
3. Railway will use `railway.json` and `Dockerfile.railway`.
4. Set environment variables:

```env
ENVIRONMENT=production
USE_DB=false
CORS_ORIGINS=https://bet-n.vercel.app,http://localhost:5173
JWT_SECRET=replace-with-long-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-strong-password
```

5. Deploy and verify:

```bash
curl https://YOUR-RAILWAY-DOMAIN/api/health
```

## Wire BetNANDO

Add this to the Vercel project `bet-n`:

```env
VITE_WC2026_API_URL=https://YOUR-RAILWAY-DOMAIN
```

Then update the BetNANDO frontend pages to request the Railway API instead of static fallback data.
