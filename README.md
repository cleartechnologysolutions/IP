# Clear IP

Public IP checker for Clear Technology Solutions.

Deploy command:

```bash
npx wrangler deploy
```

The app works without bindings. To enable full IP reputation details, create a
free ipapi.is account and add its API key as a Cloudflare Worker secret named
`IPAPI_KEY`.
