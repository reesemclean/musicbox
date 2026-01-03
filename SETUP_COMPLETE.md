# MusicBox Setup Complete ✅

## What's Been Set Up

### 1. Project Structure
```
musicbox/
├── flake.nix              # Nix development environment
├── .mise.toml             # Tool versions (Node 22, Python 3.11)
├── README.md              # Comprehensive project guide
├── package.json           # Monorepo root
│
├── server/                # TanStack Start application
│   ├── src/routes/        # File-based routing
│   ├── src/db/schema.ts   # Database schema (Drizzle)
│   ├── drizzle/           # Generated migrations
│   └── package.json
│
├── player/                # Raspberry Pi player (placeholder)
│   ├── src/index.ts       # Player entry point
│   └── package.json
│
├── shared/                # Shared types
│   ├── src/types/index.ts # All shared types
│   └── package.json
│
└── library/               # Music library (development)
    ├── songs/             # Individual tracks
    └── playlists/         # Playlist folders
```

### 2. Database Schema ✅
Five tables created with Drizzle ORM:
- **cards**: NFC card ↔ content mappings
- **devices**: Registered Raspberry Pi devices
- **downloadQueue**: YouTube Music download tracking
- **playHistory**: Play statistics
- **libraryVersion**: Library sync versioning

Migrations generated in `server/drizzle/0000_shocking_jackal.sql`

### 3. Development Environment ✅

**Two Options:**

**Option A: Using mise (Recommended)**
```bash
mise install        # Installs Node 22 + Python 3.11
node --version      # Verify
python3 --version   # Verify
```

**Option B: Using Nix (Full Isolation)**
```bash
nix develop              # Everything (server + player deps)
nix develop .#server     # Server only (with Python, ytmusicapi, yt-dlp)
nix develop .#player     # Player only (minimal)
```

### 4. Shared TypeScript Types ✅
All types in `shared/src/types/index.ts`:
- `CardMapping`, `Device`, `Song`, `Playlist`
- `DownloadQueue`, `PlayHistory`, `LibraryVersion`
- `WebSocketMessage` union type
- `ContentType`, `Action` enums

### 5. Server Framework ✅
- TanStack Start (full-stack React)
- Drizzle ORM with SQLite
- Tailwind CSS + shadcn/ui components
- File-based routing
- Vite for development/building

### 6. Monorepo Setup ✅
- npm workspaces configured
- Shared dependencies hoisted to root
- Cross-workspace type imports working
- Individual build/dev scripts per workspace

---

## Next Steps: Phase 1 Implementation

### 1. Library Service API Routes
```typescript
// server/src/routes/api/library/
GET    /songs        # List all songs (scan filesystem)
GET    /playlists    # List all playlists
GET    /search?q=... # Search library
```

### 2. File Upload Endpoint
```typescript
// server/src/routes/api/upload/
POST   /           # Accept MP3 file, save to library/songs/
```

### 3. Mock NFC Endpoint
```typescript
// server/src/routes/api/mock/
POST   /nfc-tap    # Simulate card tap { nfcId: string }
```

### 4. Card Management API
```typescript
// server/src/routes/api/cards/
GET    /              # List all card mappings
POST   /              # Link card { nfcId, contentType, contentPath }
DELETE /:nfcId        # Unlink card
```

### 5. Basic Web UI
- File upload form
- Card linking interface
- Library browser

---

## Development Commands

```bash
# From root directory:
npm run dev:server    # Start server (port 3000)
npm run dev:player    # Start player
npm run build:server  # Build server
npm run lint          # Lint all workspaces

# From server/ directory:
cd server
npm run dev           # Start development server
npm run db:generate   # Generate new migrations
npm run db:push       # Apply migrations to SQLite
npm run db:studio     # Open Drizzle Studio UI

# Using mise:
mise install          # Install tools
node --version        # Verify Node 22
python3 --version     # Verify Python 3.11
```

---

## Key Files to Know

- `flake.nix` - Nix development environment definition
- `server/src/db/schema.ts` - All database tables
- `server/drizzle/` - Generated migrations
- `shared/src/types/index.ts` - All shared TypeScript types
- `README.md` - Comprehensive project documentation

---

## Technology Stack Summary

| Layer | Technology |
|-------|-----------|
| **Framework** | TanStack Start (full-stack React) |
| **Database** | SQLite + Drizzle ORM |
| **UI** | React 19 + Tailwind CSS + shadcn/ui |
| **Types** | TypeScript + Zod validation |
| **Tooling** | Vite, ESLint, Prettier |
| **Monorepo** | npm workspaces |
| **Dev Tools** | mise, Nix flakes |
| **YouTube** | ytmusicapi (Python), yt-dlp |
| **Pi Audio** | mpg123 (subprocess) |
| **Pi NFC** | pn532.js (I2C, real) / HTTP (mock) |

---

## Ready to Build! 🚀

The foundation is solid. Next phase:
1. Implement library scanning API
2. Add file upload endpoint
3. Create mock NFC service
4. Build card linking UI
5. Test end-to-end flow

See `README.md` for detailed documentation and troubleshooting.
