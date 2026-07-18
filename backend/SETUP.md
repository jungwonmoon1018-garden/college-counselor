# Local Administrator Setup

The installed desktop application has one localhost-only administrator account.
That account can configure exactly three installation secrets and cannot read
student profiles, chats, exports, attachments, or advice history.

## First launch

1. Start the installed College Counselor application.
2. Open **Administrator** from the local application.
3. Create a password of at least 12 characters.
4. Store the one-time recovery code offline.
5. Add an OpenRouter key and an IPEDS/College Scorecard key.

The desktop host generates the 256-bit vault encryption key once and stores it
with Windows DPAPI or macOS Keychain. Its value is never displayed. The
administrator screen can report whether it exists but cannot rotate or clear
it, because doing so would make existing encrypted records unreadable.

OpenRouter and Scorecard keys are validated against fixed official HTTPS
endpoints before they are saved. Saving or clearing either key restarts the
bundled local backend automatically.

## Authentication boundary

- Administrator bootstrap and recovery are privileged Electron IPC operations.
- Login creates an HttpOnly, SameSite=Strict session cookie.
- Secret IPC checks the active backend administrator session before each action.
- Mutating admin requests require the matching CSRF token and exact desktop
  origin.
- The backend accepts admin requests only from a loopback socket.
- Status responses contain booleans and verification timestamps, never values.

## Student setup

Students create an email-and-password account and receive a one-time recovery
code. All student profiles use minor-safe privacy defaults. Registration never
logs into an existing email account, and changing a password revokes every
existing session.

Before the first external AI request, the student must explicitly grant data
processing, AI interaction, and cross-border transfer consent. Offline,
deterministic features remain available without an OpenRouter key.

## Development-only configuration

The standalone backend supports these environment variables for tests and local
development:

```text
ENCRYPTION_KEY=<64 hexadecimal characters>
OPENROUTER_API_KEY=<OpenRouter key>
SCORECARD_API_KEY=<api.data.gov key>
ALLOWED_ORIGINS=http://127.0.0.1:5173
```

Production installers do not write these values to `.env`. The old console
setup token, counselor Basic auth, Tavily key, student BYOK, and custom provider
URL mechanisms are unsupported.
