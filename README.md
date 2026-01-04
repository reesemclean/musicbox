# MusicBox 🎵

A physical music player system where NFC cards trigger instant playback across multiple locations.

## Project Structure

```
musicbox/
├── flake.nix              # Nix development environment
├── .mise.toml             # Tool version definitions (Node 22, Python 3.11)
├── package.json           # Monorepo root package
├──
├── server/                # Central library service (TanStack Start)
│   ├── src/
│   │   ├── routes/        # File-based routing
│   │   ├── components/    # React components
│   │   ├── api/          # API routes
│   │   └── db/
│   │       └── schema.ts  # Database schema (Drizzle ORM)
│   ├── drizzle/          # Generated migrations
│   └── package.json
│
├── player/                # Raspberry Pi player application
│   ├── src/
│   │   └── index.ts      # Player entrypoint
│   └── package.json
│
├── shared/                # Shared TypeScript types
│   ├── src/
│   │   ├── types/
│   │   │   └── index.ts  # All shared types
│   │   └── index.ts
│   └── package.json
│
└── library/               # Music library (local development)
    ├── songs/            # Individual tracks
    └── playlists/        # Playlist folders
```

## Development Environment

### Using mise (recommended)

```bash
# Install tools (Node 22, Python 3.11)
mise install

# Verify
node --version   # v22.x
python3 --version # 3.11.x
```

### Using Nix (full isolation)

```bash
# Full-stack development (all dependencies)
nix develop

# Server only (includes Python, ytmusicapi, yt-dlp)
nix develop .#server

# Player only (minimal dependencies)
nix develop .#player
```

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Database

```bash
cd server
npm run db:generate  # Already done, generates migrations
npm run db:push      # Push schema to SQLite
```

### 3. Start Development

```bash
# Terminal 1: Start the server
npm run dev:server
# Runs on http://localhost:3000

# Terminal 2: Start the player (mock)
npm run dev:player
```

### 4. Access Web UI

Open http://localhost:3000 in your browser to see the management interface.

## Database Schema

### Tables

- **cards**: NFC card to content mappings
  - `nfcId` (unique): Card UID
  - `contentType`: 'song' | 'playlist' | 'action'
  - `contentPath`: Path to song/playlist file
  - `action`: 'play' | 'pause' | 'next' | 'previous' | 'stop'

- **devices**: Registered Raspberry Pi players
  - `name`: Device identifier (e.g., 'living-room')
  - `ipAddress`: Network address
  - `lastSeen`: Last heartbeat timestamp
  - `libraryVersion`: Current synced library version

- **downloadQueue**: YouTube Music download progress
  - `videoId`: YouTube video ID
  - `status`: 'pending' | 'downloading' | 'complete' | 'failed'
  - `progress`: 0-100

- **playHistory**: Play statistics
  - `deviceId`: Which device played it
  - `songPath`: Path to the song file
  - `playedAt`: Timestamp

- **libraryVersion**: Version tracking for library sync
  - `version`: Incrementing version number
  - `changeDescription`: What changed (e.g., "Added song: Artist - Title")

## Available Commands

### Server (TanStack Start)

```bash
cd server
npm run dev          # Start development server (port 3000)
npm run build        # Build for production
npm run lint         # Run ESLint
npm run format       # Format with Prettier
npm run db:generate  # Generate migrations
npm run db:push      # Push to database
npm run db:studio    # Open Drizzle Studio UI
```

### Player

```bash
cd player
npm run dev          # Start player in watch mode
npm run build        # Compile TypeScript
npm run start        # Run compiled player
npm run simulate-nfc # Simulate NFC card scan (random ID)
npm run simulate-nfc 04:A3:2F:BA  # Simulate with specific ID
```

### Shared

```bash
cd shared
npm run build        # Compile shared types
```

### Monorepo

```bash
npm run dev:server   # Start server from root
npm run dev:player   # Start player from root
npm run build:server # Build server from root
npm run build:player # Build player from root
npm run lint         # Lint all workspaces
npm run format       # Format all workspaces
```

## Tech Stack

### Server (TanStack Start)

- **Framework**: TanStack Start (full-stack React)
- **Database**: SQLite + Drizzle ORM
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **File Serving**: Static HTTP
- **WebSocket**: Push notifications to players
- **YouTube Music**: ytmusicapi (Python child process)
- **Downloads**: yt-dlp

### Player

- **Runtime**: Node.js + TypeScript
- **Audio**: mpg123 (subprocess)
- **NFC**: Mock HTTP endpoint (real: pn532.js I2C)
- **Sync**: HTTP client to fetch music files
- **WebSocket**: Push notification client

### Shared

- **Type System**: TypeScript + Zod

### Infrastructure

- **Tool Management**: mise
- **Development Environment**: Nix flakes
- **Monorepo**: npm workspaces

## Environment Variables

### Server (`.env.local`)

```
DATABASE_URL=file:./data/musicbox.db
PROXMOX_URL=http://localhost:3000
```

### Player

```
DEVICE_NAME=living-room
PROXMOX_URL=http://localhost:3000
MOCK_NFC=true
```

## Key Features (Roadmap)

### Phase 1: MVP ✅

- [x] Nix development environment
- [x] TanStack Start scaffold
- [x] Database schema with Drizzle ORM
- [x] Shared type definitions
- [x] Library file serving (BLOB storage in SQLite)
- [x] Mock NFC endpoint
- [x] File upload endpoint
- [x] Card linking flow (WebSocket-based registration)

### Phase 2: YouTube Integration ✅

- [x] YouTube Music search API
- [x] Download service (yt-dlp)
- [x] Download queue tracking
- [x] Album download with playlist creation

### Phase 3: Playlists ✅

- [x] Create/edit playlists
- [x] Add/remove songs from playlists
- [x] Drag-and-drop reordering
- [x] Web-based MiniPlayer with queue

### Phase 4: Pi Player

- [ ] WebSocket sync client
- [ ] File sync with HTTP
- [ ] mpg123 playback control
- [ ] Real PN532 NFC reader

### Phase 5: Production

- [ ] NixOS modules for both services
- [ ] Deployment documentation
- [ ] Statistics and monitoring

## Testing NFC Card Registration

To test NFC card registration during development:

1. **Start the server** (in terminal 1):
   ```bash
   cd server
   npm run dev
   ```

2. **Open the web UI** in your browser:
   ```
   http://localhost:3000/cards
   ```

3. **Click "Register New Card"** - the dialog will wait for an NFC scan

4. **Simulate an NFC tap** (in terminal 2):
   ```bash
   cd player
   npm run simulate-nfc           # Random card ID
   # or
   npm run simulate-nfc 04:A3:2F  # Specific card ID
   ```

5. **The dialog should detect the card** and show the assignment form

6. **Select content** (song/playlist/action) and save

The simulation works by:
- Player CLI sends POST request to `/api/nfc/scan`
- Server broadcasts via WebSocket to all connected browsers
- CardDialog receives the WebSocket message and transitions to assignment form

## Next Steps

1. **Test the setup**: Verify all dev commands work
2. **Build API routes**: Library scanning, file serving
3. **File upload**: Accept MP3 uploads to library
4. **Basic playback**: Wire up music files to player

## Troubleshooting

### Nix not found

```bash
# Install Nix (macOS)
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install

# Enable experimental features
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
```

### Database issues

```bash
# Reset database
rm server/data/musicbox.db
npm run db:push
```

### Port already in use

```bash
# Change port in server/package.json
"dev": "vite dev --port 3001"
```

## Learning Resources

- [TanStack Start](https://tanstack.com/start)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Nix Flakes](https://nixos.wiki/wiki/Flakes)
- [mise Task Runner](https://mise.jdx.dev/)

---

Happy coding! 🎵
