# Server Function Authentication Plan

## Overview

Two separate auth concerns:
1. **Web UI auth** - Protect admin functions with user accounts and roles
2. **Device SSH access** - SSH keys + per-device passwords for debugging

---

## Web UI Authentication

### User Roles

| Role | Permissions |
|------|-------------|
| **Admin** | Everything: devices, deployments, users, settings, media, cards |
| **Media Manager** | Media only: songs, playlists, podcasts, cards |

### Database Schema

```typescript
// User roles
export const userRole = ['admin', 'media_manager'] as const
export type UserRole = (typeof userRole)[number]

// Users table
export const users = sqliteTable('users', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: userRole }).notNull().default('media_manager'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// App settings (for JWT secret, etc.)
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})
```

### Default Setup

On first run (no users exist):
1. Create default admin user: `admin` / `musicbox`
2. Generate and store JWT signing secret
3. First login prompts to change password

### Auth Flow

1. **Login page** (`/login`)
   - Username + password form
   - On success: set JWT cookie with user ID and role
   - Redirect to intended destination

2. **Protected routes**
   - `_library.tsx` loader checks JWT
   - Invalid/missing → redirect to `/login`
   - Valid → continue, pass user info to context

3. **Server functions**
   - Middleware checks JWT from cookie
   - Checks role against required permission
   - 401 if not authenticated, 403 if wrong role

4. **Change password** (`/settings`)
   - Requires current password
   - Updates password hash

5. **User management** (`/settings/users`) - Admin only
   - List users
   - Create new user (username, password, role)
   - Delete user (can't delete self)
   - Reset user password

### Permission Matrix

| Function Category | Admin | Media Manager |
|-------------------|-------|---------------|
| **Devices** | ✓ | ✗ |
| Approve/reject devices | ✓ | ✗ |
| Delete devices | ✓ | ✗ |
| Send commands to devices | ✓ | ✗ |
| **Deployments** | ✓ | ✗ |
| Trigger deployment | ✓ | ✗ |
| Cancel deployment | ✓ | ✗ |
| View deployment history | ✓ | ✗ |
| **Media** | ✓ | ✓ |
| Manage songs | ✓ | ✓ |
| Manage playlists | ✓ | ✓ |
| Manage podcasts | ✓ | ✓ |
| **Cards** | ✓ | ✓ |
| Create/edit/delete cards | ✓ | ✓ |
| **Users & Settings** | ✓ | ✗ |
| Manage users | ✓ | ✗ |
| Change own password | ✓ | ✓ |

### Session Token (JWT)

```typescript
interface JWTPayload {
  userId: number
  username: string
  role: UserRole
  iat: number  // issued at
}

// Cookie settings
{
  name: 'musicbox_session',
  httpOnly: true,
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60,  // 30 days
  secure: process.env.NODE_ENV === 'production',
}
```

JWT signed with secret stored in `appSettings` (generated once on first run).

### Implementation Files

#### New Files

```
src/
├── lib/
│   └── auth.ts                    # hashPassword, verifyPassword, createJWT, verifyJWT
├── services/
│   └── authService.ts             # User CRUD, password management
├── middleware/
│   └── authMiddleware.ts          # requireAuth, requireAdmin, requireMediaManager
├── routes/
│   ├── login.tsx                  # Login page
│   └── _library/
│       └── settings/
│           ├── index.tsx          # Change password
│           └── users.tsx          # User management (admin only)
```

#### Modified Files

```
src/
├── db/schema.ts                   # Add users, appSettings tables
├── routes/_library.tsx            # Auth check in loader
├── services/serverFunctions.ts    # Add middleware by permission level
├── services/songsServerFunctions.ts
├── services/libraryServerFunctions.ts
├── services/ytmusicServerFunctions.ts
```

### Middleware Usage

```typescript
// Admin only (devices, deployments, users)
export const approveDevice = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .handler(...)

// Media manager or admin (songs, playlists, cards)
export const createCard = createServerFn({ method: 'POST' })
  .middleware([requireAuth])  // Any authenticated user
  .handler(...)

// Public (streaming, health)
export const getHealth = createServerFn()
  .handler(...)  // No middleware
```

---

## Device SSH Access

### Approach: SSH Keys + Optional Password

1. **Primary access**: SSH keys (already working)
   - Server's public key added to device during bootstrap
   - Passwordless SSH from server to device

2. **Debug access**: Per-device password
   - For manual SSH when needed
   - Stored in database (hashed? or plain for display?)
   - Shown in device details UI

3. **Sudo**: Passwordless for musicbox user
   - Configured in image build
   - No password needed for Ansible become

### Database Changes

```typescript
// Add to devices table
devicePassword: text('device_password'),  // Generated on approval, shown in UI
```

### UI for Device SSH

In device details (expandable or modal):
- **SSH Command**: `ssh musicbox@192.168.1.50` (copy button)
- **Password**: `••••••••` with show/copy buttons
- Note: "Password only needed for manual SSH. Deployments use SSH keys."

### Password Generation

On device approval:
```typescript
// Generate random password (readable, no ambiguous chars)
function generateDevicePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'  // No i,l,o,0,1
  return Array.from({ length: 12 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('')
}
```

### Image Build Changes

```bash
# In pi-gen stage: configure passwordless sudo
echo "musicbox ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/musicbox
chmod 440 /etc/sudoers.d/musicbox
```

### Ansible Changes

Remove password passing since we use passwordless sudo:
```typescript
// Remove from ansibleService.ts
// if (env.MUSICBOX_PASSWORD) {
//   args.push('-e', `musicbox_password=${env.MUSICBOX_PASSWORD}`)
// }
```

---

## Implementation Order

### Phase 1: Core Auth (Web UI)

1. Add `users` and `appSettings` tables to schema
2. Run migration
3. Create `auth.ts` utilities
4. Create `authService.ts` (user CRUD)
5. Create auth middleware
6. Create `/login` route and page
7. Add auth check to `_library.tsx`
8. Apply middleware to all server functions

### Phase 2: User Management

9. Create `/settings` page (change own password)
10. Create `/settings/users` page (admin only)
11. Add user management server functions

### Phase 3: Device Passwords

12. Add `devicePassword` to devices schema
13. Generate password on device approval
14. Add SSH info section to device UI
15. Update image build for passwordless sudo
16. Remove `MUSICBOX_PASSWORD` from Ansible

---

## Security Notes

- Default password is weak → prompt to change on first login
- HTTPS recommended in production (reverse proxy)
- JWT secret generated once, stored in DB
- Device passwords are plain text in DB (needed for display)
- No rate limiting (acceptable for home use)
- Streaming endpoints remain public

---

## UI Navigation by Role

### Admin sees:
- Devices (full management)
- Library (songs, playlists)
- Podcasts
- Cards
- Downloads
- Settings (password + user management)

### Media Manager sees:
- Library (songs, playlists)
- Podcasts
- Cards
- Downloads
- Settings (password only)

Hide navigation items based on role, plus server-side enforcement.
