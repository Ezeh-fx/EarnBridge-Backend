# Security Setup - Earnbridge API

This document describes the complete security configuration implemented according to AGENTS.md.

## Middleware Order (as per AGENTS.md)

The middleware is applied in this exact order in `src/app.ts`:

1. **Disable x-powered-by** - Hides Express version
2. **Trust proxy** - Configured for proper client IP detection
3. **Helmet** - Security headers (HSTS, CSP in production)
4. **CORS** - Explicit allow-list from FRONTEND_ORIGIN
5. **Arcjet** - Global security middleware (if ARCJET_KEY is set)
6. **Body parser** - Express JSON with 10kb limit
7. **Cookie parser** - For httpOnly cookies
8. **XSS Sanitizer** - Custom XSS protection middleware
9. **express-mongo-sanitize** - NoSQL injection protection
10. **HPP** - HTTP parameter pollution protection
11. **Request logger** - Pino logging middleware
12. **Routes** - Application routes
13. **Error handler** - Centralized error handling

## Security Components

### 1. Helmet
- HSTS enabled in production (1 year, include subdomains, preload)
- Content Security Policy enabled in production
- Other default security headers applied

### 2. CORS
- Explicit allow-list from `FRONTEND_ORIGIN` environment variable
- `credentials: true` for cookie support
- Never uses `*` in production

### 3. Arcjet

**Global Middleware** (`arcjetMiddleware`):
- Shield WAF protection
- Bot detection (blocks all bots by default)
- Follows Arcjet documentation: https://docs.arcjet.com/ai-protection/abuse-protection
- Uses `aj.protect(req)` pattern from Arcjet docs

**Route-Specific Rate Limiters** (to be applied when routes are created):
- `loginRateLimit` - 5 requests/minute, 10 burst
- `registerRateLimit` - 3 requests/minute, 5 burst
- `refreshRateLimit` - 10 requests/minute, 20 burst
- `withdrawalRateLimit` - 2 requests/minute, 5 burst
- `chatRateLimit` - 10 requests/minute, 20 burst

**Fail Policy**:
- Login, register, withdrawals: Fail closed (strict)
- Other routes: Fail open (default)

### 4. XSS Sanitizer (Custom)
- Custom middleware in `src/middleware/xss.ts`
- Escapes HTML special characters: `&`, `<`, `>`, `"`, `'`
- Sanitizes request body, query, and params recursively
- Works on nested objects and arrays
- No deprecated dependencies used

### 5. express-mongo-sanitize
- Replaces keys starting with `$` or containing `.` with `_`
- Logs sanitized keys for monitoring
- Second layer of defense after Zod validation

### 6. HPP
- Protects against HTTP parameter pollution
- Works alongside Zod validation

### 7. Request Size Limits
- JSON body limited to 10kb
- Prevents large payload attacks

## Environment Variables Required

```env
ARCJET_KEY=your-arcjet-key
ARCJET_ENV=development
FRONTEND_ORIGIN=http://localhost:5173
NODE_ENV=development
```

## Implementation Notes

1. **Arcjet Conditional Loading**: Arcjet middleware only loads if `ARCJET_KEY` is set, allowing development without Arcjet.

2. **Production vs Development**:
   - HSTS and CSP only enabled in production
   - In development, these are disabled for easier debugging

3. **Rate Limiters**: Ready to use but not yet applied to routes. They will be applied when implementing:
   - POST /v1/auth/login → `loginRateLimit`
   - POST /v1/auth/register → `registerRateLimit`
   - POST /v1/auth/refresh → `refreshRateLimit`
   - POST /v1/withdrawals → `withdrawalRateLimit`
   - POST /v1/chat/messages → `chatRateLimit`

4. **No Express Rate Limit**: As per AGENTS.md, we use Arcjet exclusively for rate limiting.

5. **Callback Exception**: Per AGENTS.md, Arcjet bot rules will NOT be applied to `/v1/callbacks/ayet` because ayeT's servers look like automated clients. This route is protected by ayeT's HMAC verification instead.

6. **XSS Protection**: Custom implementation using HTML entity escaping to avoid deprecated packages like `xss-clean`.

7. **Node Version Warning**: Arcjet requires Node 22.21.0+, but you're on Node 20.19.3. The Arcjet middleware will only load if `ARCJET_KEY` is set in `.env`. For full functionality, upgrade to Node 22.21.0+.

## Security Layers

1. **Network Layer**: Helmet (HSTS, CSP), CORS
2. **Application Layer**: Arcjet (Shield WAF, Bot detection, Rate limiting)
3. **Input Validation**: Zod (validation), XSS Sanitizer (XSS prevention)
4. **Database Layer**: express-mongo-sanitize (NoSQL injection)
5. **HTTP Layer**: HPP (parameter pollution)

## Next Steps

When implementing auth routes, apply the appropriate rate limiter:

```typescript
import { loginRateLimit } from '../lib/arcjet.js';

router.post('/login', async (req, res, next) => {
  const decision = await loginRateLimit.protect(req);
  if (decision.isDenied()) {
    res.status(429).json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } });
    return;
  }
  next();
}, loginController);
```

The same pattern applies to register, refresh, withdrawals, and chat endpoints.
