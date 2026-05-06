# Test Credentials

No authentication required — dashboard is open access (as requested by user).

## Environment Variables Required
| Variable | Location | Purpose |
|----------|----------|---------|
| ENCRYPTION_KEY | /app/backend/.env | 32-byte hex key for encrypting OF credentials. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| OF_API_KEY | /app/backend/.env | OnlyFans API key from app.onlyfansapi.com |

## API Base URL
https://9d05ba4f-dc79-4f69-9cd3-948e3fb39319.preview.emergentagent.com

## Test Account (created during testing, deleted)
No persistent test data — all accounts are user-created.
