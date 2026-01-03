# MusicBox Setup Complete ✅

## What's Been Created

### 1. Monorepo Structure

```
musicbox/
├── flake.nix              # Nix development environment with 3 shells
├── .mise.toml             # Tool versions (Node 22, Python 3.11)
├── package.json           # Workspace root
├── server/                # TanStack Start application
├── player/                # Raspberry Pi player (placeholder)
├── shared/                # Shared TypeScript types
└── library/               # Music library folder (development)
```

### 2. Server (TanStack Start)

- ✅ Full-stack React framework with file-based routing
- ✅ Drizzle ORM with SQLite
- ✅ Tailwind CSS + shadcn/ui components
- ✅ TanStack Query + React Form + React Router
- ✅ TypeScript with strict mode
- ✅ ESLint + Prettier configured

### 3. Database Schema (Generated)

```sql
✅ cards          - NFC card to content mappings
✅ devices        - Registered Pi players
✅ downloadQueue  - YouTube Music download progress
✅ playHistory    - Play statistics
✅ libraryVersion - Library sync version tracking
```

### 4. Shared Types

- ✅ CardMapping, Device, Song, Playlist types
- ✅ WebSocket message types
- ✅ Enum types for content/actions

### 5. Development Environment

- ✅ Nix flake with multiple dev shells
  - `nix develop` - Full stack
  - `nix develop .#server` - Server + Python + YouTube tools
  - `nix develop .#player` - Player only
- ✅ mise for Node/Python version management
- ✅ npm workspace support

## What's Ready to Use

### Development Commands

**From project root:**

```bash
npm run dev:server    # Start TanStack Start dev server (port 3000)
npm run dev:player    # Start player in watch mode
npm run build:server  # Build for production
npm run build:player  # Build player
npm run lint          # Lint all workspaces
npm run format        # Format all workspaces
```

**Server-specific (cd server/):**

```bash
npm run dev           # Development server
npm run build         # Production build
npm run db:generate   # Generate migrations (already done)
npm run db:push       # Push schema to SQLite
npm run db:studio     # Open Drizzle Studio UI
npm run lint          # ESLint
npm run format        # Prettier
```

### Environment Setup

**mise:**

```bash
mise install    # Install Node 22 + Python 3.11
```

**Nix:**

```bash
nix develop .#server    # Enter server environment
nix flake check         # Validate flake
```

## What's NOT Yet Implemented (Roadmap)

### Phase 1: MVP (Core Features)

- [ ] Library file scanning and serving
- [ ] Mock NFC HTTP endpoint (/api/mock/nfc-tap)
- [ ] File upload endpoint
- [ ] Card linking UI flow
- [ ] Basic static file serving

### Phase 2: YouTube Integration

- [ ] YouTube Music API wrapper (ytmusicapi)
- [ ] Download service (yt-dlp)
- [ ] Download queue management
- [ ] Progress tracking

### Phase 3: Playlists

- [ ] Create/edit playlists
- [ ] Add/remove songs from playlists
- [ ] Folder operations

### Phase 4: Pi Player

- [ ] WebSocket sync client
- [ ] File sync with HTTP
- [ ] mpg123 playback control
- [ ] Real PN532 NFC reader
- [ ] Player state management

### Phase 5: Production

- [ ] NixOS modules for deployment
- [ ] Health checks and monitoring
- [ ] Statistics aggregation
- [ ] Error recovery

## Database Migrations

Generated migration file: `server/drizzle/0000_shocking_jackal.sql`

This migration creates all 5 tables with proper indexes and foreign keys. To apply:

```bash
cd server
npm run db:push    # Push to SQLite
```

Database location: `server/data/musicbox.db`

## Key Decisions Made

1. **Nix + mise**: Nix for reproducible development shells, mise for simple tool version management
2. **TanStack Start**: Full-stack React with SSR ready, built-in routing
3. **better-sqlite3**: Lightweight, synchronous SQLite driver (no need for Postgres)
4. **Drizzle ORM**: Type-safe, schema-first ORM
5. **File-based routing**: TanStack Start convention for cleaner code organization
6. **Static file serving**: Simpler than rsync for development
7. **Mock NFC first**: Build with mocks before tackling real hardware

## Next Immediate Tasks

1. **Test server startup**

   ```bash
   npm run dev:server
   # Should start on http://localhost:3000
   ```

2. **Create API routes**
   - `/api/library/songs` - List songs
   - `/api/library/playlists` - List playlists
   - `/api/upload` - Upload MP3
   - `/api/cards` - CRUD card mappings

3. **Add file serving**
   - Serve library folder via `/public/library/`
   - Implement library scanning

4. **Mock NFC endpoint**
   - `/api/mock/nfc-tap` - Simulate card detection
   - Used for development and testing

5. **Simple UI**
   - List songs and playlists
   - Upload interface
   - Card linking workflow

## Files Modified/Created

```
✅ flake.nix                   - Nix development environment
✅ .mise.toml                  - Tool versions
✅ .gitignore                  - Git ignore rules
✅ package.json                - Workspace root
✅ README.md                   - Project documentation
✅ shared/package.json         - Shared types package
✅ shared/tsconfig.json        - TypeScript config
✅ shared/src/types/index.ts   - Shared types
✅ player/package.json         - Player package
✅ player/tsconfig.json        - Player TypeScript config
✅ player/src/index.ts         - Player entrypoint
✅ server/src/db/schema.ts     - Database schema (MODIFIED)
✅ server/drizzle/             - Generated migration
```

## How to Proceed

The project is now set up with:

- ✅ Working monorepo structure
- ✅ Full development environment (Nix + mise)
- ✅ Database schema and migrations ready
- ✅ Shared types defined
- ✅ TypeScript configured everywhere
- ✅ TanStack Start with all addons installed

**Next step**: Implement Phase 1 features (library, file upload, mock NFC, card linking).

Good luck! 🎵
