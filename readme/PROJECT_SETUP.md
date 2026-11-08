# Earnbridge Backend - Project Setup

This document explains the project setup, configuration, and development process for the Earnbridge API backend.

## Project Overview

Earnbridge is an AI rewards web app where users earn money by completing offers through the ayeT-Studios offerwall. This backend service handles:

- User accounts and authentication (email + password, and Google)
- Generating each user's offerwall link
- Crediting rewards from ayeT-Studios server-to-server callbacks
- The wallet ledger and balances
- Withdrawal requests
- The AI support chat
- Support tickets (human handoff)

## Tech Stack

- **Runtime**: Node.js 22.21.0+ (required for Arcjet)
- **Framework**: Express 4.19+
- **Language**: TypeScript (strict mode, ESM only)
- **Database**: MongoDB (Atlas, replica set required for transactions) + Mongoose
- **Validation**: Zod
- **Authentication**: Custom (jsonwebtoken, bcryptjs, cookie-parser, google-auth-library)
- **Security**: Arcjet, helmet, cors, hpp, express-mongo-sanitize
- **Logging**: Pino with pino-pretty for development
- **Testing**: Vitest + supertest + mongodb-memory-server
- **AI Provider**: [To be decided before building chat]

## Folder Structure

```
src/
  config/       - Environment loading and constants
  controllers/  - Request/response handling, calls services
  lib/          - External clients (ayet, ai, google, arcjet)
  middleware/   - Auth, validation, security, error handling, logging
  models/       - Mongoose schemas and models
  routes/       - Route definitions only, no business logic
  services/     - Business logic, no knowledge of req/res
  types/        - Shared TypeScript types
  utils/        - Utility functions (errors, global handlers)
  tests/        - Test files
readme/         - Feature documentation
```

## Getting Started

### Prerequisites

- Node.js 22.21.0 or later
- MongoDB Atlas account (replica set cluster)
- Arcjet account (for security)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

4. Configure environment variables in `.env`:
   - MongoDB connection string
   - JWT secrets (minimum 32 characters each)
   - Arcjet key (optional for development)
   - Frontend origin
   - Other required configuration

### Running the Application

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

**Testing:**
```bash
npm test              # Watch mode
npm run test:run      # Single run
```

**Type Checking:**
```bash
npm run typecheck
```

## Configuration

### Environment Variables

Required variables are validated at startup using Zod. See `.env.example` for the complete list.

Key variables:
- `NODE_ENV` - development/production/test
- `PORT` - Server port (default: 3000)
- `MONGODB_URI` - MongoDB connection string
- `JWT_ACCESS_SECRET` - Access token secret (min 32 chars)
- `JWT_REFRESH_SECRET` - Refresh token secret (min 32 chars)
- `FRONTEND_ORIGIN` - Frontend URL for CORS
- `ARCJET_KEY` - Arcjet API key (optional for dev)

### TypeScript Configuration

- Strict mode enabled
- ESM modules only (`"type": "module"`)
- Node types included
- Build output: `dist/`

## Security

### Middleware Order (Applied in Order)

1. Disable x-powered-by
2. Trust proxy configuration
3. Helmet (security headers)
4. CORS (explicit allow-list)
5. Arcjet (Shield WAF + Bot detection)
6. Body parser (10kb limit)
7. Cookie parser
8. XSS Sanitizer (custom HTML escaping)
9. express-mongo-sanitize (NoSQL injection)
10. HPP (HTTP parameter pollution)
11. Request logger
12. Routes
13. Error handler

### Security Components

- **Arcjet**: Shield WAF, bot detection, rate limiting
- **Helmet**: HSTS, CSP, security headers
- **CORS**: Explicit allow-list from FRONTEND_ORIGIN
- **XSS Sanitizer**: Custom middleware to escape HTML entities
- **express-mongo-sanitize**: Strips NoSQL operators
- **HPP**: Protects against parameter pollution

### Rate Limiting

Route-specific rate limiters (via Arcjet):
- Login: 5 req/min, 10 burst
- Register: 3 req/min, 5 burst
- Refresh: 10 req/min, 20 burst
- Withdrawals: 2 req/min, 5 burst
- Chat: 10 req/min, 20 burst

## Error Handling

- Centralized error handler in `src/middleware/errorHandler.ts`
- Custom error classes in `src/utils/errors.ts`
- HTTP status code constants in `src/config/httpStatus.ts`
- Global handlers for unhandled rejections and exceptions
- Production responses never include stack traces

## Logging

- Pino logger configured in `src/config/logger.ts`
- pino-pretty for development (colorized, formatted output)
- Logs request method, path, status, and duration
- Never logs sensitive data (passwords, tokens, API keys)

## API Design

- REST conventions
- All routes versioned under `/v1` (except `/health`)
- Success response: `{ data: ... }`
- Error response: `{ error: { code, message } }`
- Standard HTTP status codes
- Cursor pagination for list endpoints

## Development Philosophy

1. Build one endpoint or feature at a time
2. Keep implementation simple
3. Avoid overengineering
4. Validate all inputs at route boundary with Zod
5. Handle errors explicitly
6. Write at least one test per endpoint

## Build Order

Features are built in this order:

1. GET /health
2. Register
3. Login
4. Get current user, refresh, logout
5. Google login
6. Get wallet balance
7. Get transaction history
8. Offerwall link
9. ayeT callback endpoint
10. Create withdrawal, then list withdrawals
11. AI chat, stage 1 only

## Documentation

After completing each full feature, create a README in the `readme/` folder explaining:
- Feature overview
- API endpoints with examples
- Data models
- Business logic
- Security considerations
- Testing approach

## Important Notes

- **Node Version**: Arcjet requires Node 22.21.0+. Current setup may show warnings on Node 20.
- **bcryptjs vs argon2**: Using bcryptjs (pure-JS) instead of argon2 to avoid native compilation issues on Windows.
- **MongoDB**: Requires replica set for transactions (required for money operations).
- **Callback Route**: Arcjet bot rules NOT applied to `/v1/callbacks/ayet` (ayeT servers look like bots).
- **No Third-Party Auth**: Using custom authentication, not Clerk or Auth0.

## Testing

- Use mongodb-memory-server for testing (configured as replica set)
- Never call real third-party services in tests
- Mock ayeT, Google, Arcjet, and AI provider
- Test money operations thoroughly (duplicates, reversals, insufficient balance)
- Run full test suite before committing

## Next Steps

See individual feature READMEs in the `readme/` folder for detailed implementation guides.
