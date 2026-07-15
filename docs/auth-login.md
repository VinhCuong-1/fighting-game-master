# Auth & Login — Developer Guide

**For teammates implementing the AWS authentication backend.**
This document covers everything from the current mock state to the full Cognito production setup.

---

## Overview: What the Auth Layer Does

The authentication layer sits at steps **A1 → A2 → A3 → A5** in the architecture diagram:

```
Player            index.js           auth.js          AWS Cognito
  │                   │                 │                   │
  │── type username ──>│                 │                   │
  │                   │── login() ──────>│                   │
  │                   │                 │── AuthenticateUser >│ (A2)
  │                   │                 │<── idToken, tokens ─│
  │                   │<── { idToken,  ─│                   │
  │                   │    userId }     │                   │
  │                   │                 │                   │
  │                   │── to matchmaking (A5: idToken used as Bearer header)
```

The single exported API is:

| Function | Returns | Description |
|---|---|---|
| `login(username, password)` | `{ idToken, userId, username }` | Authenticates user |
| `getSession()` | `{ idToken, userId, ... } \| null` | Returns cached session |
| `logout()` | void | Clears session and tokens |

---

## Step 1 — Running in Mock Mode (Default)

`Config.MOCK_AUTH = true` is the default. No AWS setup required.

**Behaviour:**
- `login()` accepts **any** username and password.
- Returns a fake JWT string prefixed with `MOCK_JWT_`.
- The matchmaking and WebSocket layers also use mock responses.

**Use this to:**
- Develop and test all UI flows locally.
- Test game physics and fighter interactions.
- Verify the complete Login → Lobby → Game flow without touching AWS.

---

## Step 2 — Creating the Cognito User Pool (AWS Console)

> **Prerequisite**: You must have Admin access to the AWS account.

1. Go to **AWS Console → Cognito → User Pools → Create user pool**.

2. **Sign-in options**: Select `User name`. Do NOT select email (keep it simple for now).

3. **Password policy**: Minimum 8 characters (default is fine).

4. **MFA**: Select `No MFA` for the prototype.

5. **User pool name**: `FightingGameUserPool`

6. **App client**:
   - Click **Add an app client**.
   - Name: `FightingGameClient`
   - **Uncheck** "Generate client secret" — browser clients cannot use secrets.
   - Authentication flows: Enable `USER_PASSWORD_AUTH`.

7. After creation, copy these values into `src/config.js`:
   ```js
   COGNITO_USER_POOL_ID:   "ap-southeast-1_XXXXXXXXX",   // Pool overview page
   COGNITO_APP_CLIENT_ID:  "XXXXXXXXXXXXXXXXXXXXXXXXXX",  // App Clients tab
   ```

---

## Step 3 — Creating the Cognito Identity Pool

The Identity Pool issues temporary AWS credentials (A3) so the client can access S3 assets.

1. Go to **AWS Console → Cognito → Federated Identities → Create new identity pool**.

2. **Identity pool name**: `FightingGameIdentityPool`

3. **Authentication providers**: Select `Cognito`.
   - User Pool ID: paste from Step 2.
   - App Client ID: paste from Step 2.

4. **IAM Role**: Cognito will auto-create two roles (`Authenticated` and `Unauthenticated`).
   - Edit the **Authenticated** role in IAM to add:
     ```json
     {
       "Effect": "Allow",
       "Action": ["s3:GetObject"],
       "Resource": "arn:aws:s3:::your-asset-bucket/*"
     }
     ```

5. Copy the Identity Pool ID into `src/config.js`:
   ```js
   COGNITO_IDENTITY_POOL_ID: "ap-southeast-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
   ```

---

## Step 4 — Enabling the API Gateway Cognito Authorizer

The `matchmaking.js` module sends the Cognito `idToken` in the `Authorization: Bearer <token>` header of every request. The API Gateway must validate it.

1. In API Gateway, go to **Authorizers → Create authorizer**.
   - Type: `Cognito`
   - Cognito user pool: select `FightingGameUserPool`
   - Token source: `Authorization`

2. Attach this authorizer to the `/join` (POST) and `/check` (GET) methods.

3. That's it — API Gateway now validates the Cognito JWT before invoking your Lambda.

---

## Step 5 — Going Live

Once all STUB values are filled in `src/config.js`:

```js
// src/config.js
MOCK_AUTH:                false,           // ← This is the only toggle
COGNITO_REGION:           "ap-southeast-1",
COGNITO_USER_POOL_ID:     "ap-southeast-1_XXXXXXXXX",
COGNITO_APP_CLIENT_ID:    "2abc...",
COGNITO_IDENTITY_POOL_ID: "ap-southeast-1:xxxx...",
MATCHMAKER_API_BASE:      "https://abc123.execute-api.ap-southeast-1.amazonaws.com/prod",
WS_SERVER:                "wss://game.yourdomain.com",
```

The `auth.js` module will automatically use the real Cognito SDK path. No other code changes are needed.

---

## Error Reference

| Error Message | Cause | Fix |
|---|---|---|
| `Username and password are required.` | Empty form fields | Client-side validation |
| `Incorrect username or password.` | Wrong credentials | User re-enters creds |
| `Password reset required.` | Admin forced reset | Use Cognito console |
| `NotAuthorizedException` | Wrong App Client ID | Check `COGNITO_APP_CLIENT_ID` |
| `ResourceNotFoundException` | Wrong User Pool ID | Check `COGNITO_USER_POOL_ID` |
| `Failed to load Cognito SDK` | No internet / CDN blocked | Host SDK locally |

---

## Security Notes

> [!CAUTION]
> - **Never put the Cognito App Client SECRET in client-side code.** Create the App Client with no secret.
> - **Never commit `src/config.js` to git.** It is already listed in `.gitignore`. Each developer copies `src/config.example.js` locally.
> - **Token expiry**: idTokens expire after 1 hour. For production, implement silent token refresh using the `refreshToken` stored in `localStorage`.
