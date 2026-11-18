import { AUTH_COOKIES } from './constants.js';

const errorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['code', 'message'],
          },
        },
        required: ['error'],
      },
    },
  },
} as const;

const dataResponse = (data: Record<string, unknown>, description = 'OK') => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: { data },
        required: ['data'],
      },
    },
  },
});

const publicUserSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    publicId: { type: 'string' },
    email: { type: 'string', format: 'email' },
    displayName: { type: 'string' },
    avatarUrl: { type: 'string', format: 'uri' },
    role: { type: 'string', enum: ['user', 'admin'] },
    emailVerified: { type: 'boolean' },
  },
  required: ['id', 'publicId', 'email', 'role', 'emailVerified'],
} as const;

const messageSchema = {
  type: 'object',
  properties: { message: { type: 'string' } },
  required: ['message'],
} as const;

const emailSchema = { type: 'string', format: 'email', maxLength: 320 } as const;
const passwordSchema = { type: 'string', minLength: 8, maxLength: 128 } as const;

const jsonBody = (schema: Record<string, unknown>) => ({
  required: true,
  content: {
    'application/json': {
      schema: { type: 'object', ...schema, additionalProperties: false },
    },
  },
});

const cookieAuth = [{ cookieAuth: [] }];
const refreshCookieAuth = [{ refreshCookieAuth: [] }];

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'EarnBridge API',
    version: '1.0.0',
    description:
      'EarnBridge backend API. Successful responses use the `{ data }` envelope; errors use `{ error: { code, message } }`. Authentication uses httpOnly cookies set by login/register/google/refresh endpoints.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'health', description: 'Service health checks' },
    { name: 'auth', description: 'Registration, login, sessions, and password flows' },
    { name: 'me', description: 'Authenticated user endpoints' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: AUTH_COOKIES.accessToken,
      },
      refreshCookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: AUTH_COOKIES.refreshToken,
      },
    },
    schemas: {
      PublicUser: publicUserSchema,
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['code', 'message'],
          },
        },
        required: ['error'],
      },
    },
  },
  paths: {
    '/': {
      get: {
        tags: ['health'],
        summary: 'Welcome message',
        responses: {
          200: dataResponse({
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
          }),
        },
      },
    },
    '/health': {
      get: {
        tags: ['health'],
        summary: 'Health check',
        responses: {
          200: dataResponse({
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'unhealthy'] },
              environment: { type: 'string' },
            },
          }),
          503: dataResponse({
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['unhealthy'] },
              environment: { type: 'string' },
            },
          }),
        },
      },
    },
    '/v1/auth/register': {
      post: {
        tags: ['auth'],
        summary: 'Register a new account',
        description:
          'Creates an unverified account and emails a 6-digit verification OTP. Always returns the same response whether or not the email is already registered.',
        requestBody: jsonBody({
          properties: {
            email: emailSchema,
            password: passwordSchema,
            displayName: { type: 'string', minLength: 1, maxLength: 80 },
          },
          required: ['email', 'password'],
        }),
        responses: {
          201: dataResponse(messageSchema, 'Verification OTP sent'),
          403: errorResponse,
          422: errorResponse,
          429: errorResponse,
          503: errorResponse,
        },
      },
    },
    '/v1/auth/verify-otp': {
      post: {
        tags: ['auth'],
        summary: 'Verify registration email OTP',
        description:
          'Verifies the emailed OTP and marks the email as verified. Does not sign the user in; call login afterwards.',
        requestBody: jsonBody({
          properties: {
            email: emailSchema,
            otp: { type: 'string', pattern: '^\\d{6}$' },
          },
          required: ['email', 'otp'],
        }),
        responses: {
          200: dataResponse({
            type: 'object',
            properties: { user: { $ref: '#/components/schemas/PublicUser' } },
          }),
          400: errorResponse,
          403: errorResponse,
          422: errorResponse,
          429: errorResponse,
          503: errorResponse,
        },
      },
    },
    '/v1/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Log in with email and password',
        description:
          'Requires a verified email. Sets the access and refresh token httpOnly cookies.',
        requestBody: jsonBody({
          properties: {
            email: emailSchema,
            password: { type: 'string', minLength: 1, maxLength: 128 },
          },
          required: ['email', 'password'],
        }),
        responses: {
          200: dataResponse({
            type: 'object',
            properties: { user: { $ref: '#/components/schemas/PublicUser' } },
          }),
          401: errorResponse,
          403: errorResponse,
          422: errorResponse,
          429: errorResponse,
          503: errorResponse,
        },
      },
    },
    '/v1/auth/google': {
      post: {
        tags: ['auth'],
        summary: 'Log in or register with Google',
        description:
          'Verifies a Google ID token server-side and sets the standard auth cookies. Does not link to an existing password account by email.',
        requestBody: jsonBody({
          properties: {
            idToken: { type: 'string', minLength: 1, maxLength: 8192 },
          },
          required: ['idToken'],
        }),
        responses: {
          200: dataResponse({
            type: 'object',
            properties: { user: { $ref: '#/components/schemas/PublicUser' } },
          }),
          401: errorResponse,
          403: errorResponse,
          409: errorResponse,
          422: errorResponse,
          429: errorResponse,
          503: errorResponse,
        },
      },
    },
    '/v1/auth/refresh': {
      post: {
        tags: ['auth'],
        summary: 'Rotate the refresh token',
        description:
          'Reads the refresh token cookie, rotates it, and sets new auth cookies. Reusing a rotated token revokes the whole token family.',
        security: refreshCookieAuth,
        responses: {
          200: dataResponse({
            type: 'object',
            properties: { user: { $ref: '#/components/schemas/PublicUser' } },
          }),
          401: errorResponse,
          403: errorResponse,
          429: errorResponse,
        },
      },
    },
    '/v1/auth/logout': {
      post: {
        tags: ['auth'],
        summary: 'Log out',
        description:
          'Revokes the refresh token if its cookie is present (optional) and always clears both auth cookies.',
        responses: {
          200: dataResponse(messageSchema),
        },
      },
    },
    '/v1/auth/forgot-password': {
      post: {
        tags: ['auth'],
        summary: 'Request a password reset email',
        description:
          'Always returns the same response. If the account exists and is verified, a reset link is emailed.',
        requestBody: jsonBody({
          properties: { email: emailSchema },
          required: ['email'],
        }),
        responses: {
          200: dataResponse(messageSchema),
          403: errorResponse,
          422: errorResponse,
          429: errorResponse,
          503: errorResponse,
        },
      },
    },
    '/v1/auth/verify-reset-token': {
      post: {
        tags: ['auth'],
        summary: 'Check a password reset token',
        description: 'Validates that the token exists and has not expired. Does not consume it.',
        requestBody: jsonBody({
          properties: {
            token: {
              type: 'string',
              minLength: 32,
              maxLength: 128,
              pattern: '^[A-Za-z0-9_-]+$',
            },
          },
          required: ['token'],
        }),
        responses: {
          200: dataResponse({
            type: 'object',
            properties: { valid: { type: 'boolean' } },
          }),
          400: errorResponse,
          403: errorResponse,
          422: errorResponse,
          429: errorResponse,
          503: errorResponse,
        },
      },
    },
    '/v1/auth/reset-password': {
      post: {
        tags: ['auth'],
        summary: 'Reset password with a token',
        description:
          'Consumes the reset token, sets the new password, and revokes all existing sessions.',
        requestBody: jsonBody({
          properties: {
            token: {
              type: 'string',
              minLength: 32,
              maxLength: 128,
              pattern: '^[A-Za-z0-9_-]+$',
            },
            newPassword: passwordSchema,
          },
          required: ['token', 'newPassword'],
        }),
        responses: {
          200: dataResponse(messageSchema),
          400: errorResponse,
          403: errorResponse,
          422: errorResponse,
          429: errorResponse,
          503: errorResponse,
        },
      },
    },
    '/v1/me': {
      get: {
        tags: ['me'],
        summary: 'Get the current user',
        security: cookieAuth,
        responses: {
          200: dataResponse({
            type: 'object',
            properties: { user: { $ref: '#/components/schemas/PublicUser' } },
          }),
          401: errorResponse,
        },
      },
    },
    '/v1/me/password': {
      post: {
        tags: ['me'],
        summary: 'Change password',
        description:
          'Requires the current password. Revokes all existing sessions and clears auth cookies on success.',
        security: cookieAuth,
        requestBody: jsonBody({
          properties: {
            oldPassword: passwordSchema,
            newPassword: passwordSchema,
          },
          required: ['oldPassword', 'newPassword'],
        }),
        responses: {
          200: dataResponse(messageSchema),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          422: errorResponse,
          429: errorResponse,
          503: errorResponse,
        },
      },
    },
  },
};
