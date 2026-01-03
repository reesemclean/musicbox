# Quick Start Guide

## 1. Install Tools
```bash
mise install
```

## 2. Install Dependencies
```bash
npm install
```

## 3. Initialize Database (Optional - schema already generated)
```bash
cd server
npm run db:push
```

## 4. Start Development Server
```bash
cd server
npm run dev
```

Open http://localhost:3000 in your browser.

## 5. (Optional) Start Player in Another Terminal
```bash
cd player
npm run dev
```

## Using Nix Instead of mise

### Full development environment
```bash
nix develop
npm install
cd server && npm run dev
```

### Server only (with Python for YouTube Music)
```bash
nix develop .#server
cd server && npm run dev
```

### Player only
```bash
nix develop .#player
cd player && npm run dev
```

## Database Access

View/edit database with Drizzle Studio:
```bash
cd server
npm run db:studio
```

## Development Tips

- **Hot reload**: Both server and player support hot reload
- **TypeScript**: Use `npm run lint` to check types
- **Database**: Schema is in `server/src/db/schema.ts`
- **Shared types**: In `shared/src/types/index.ts`
- **Routes**: File-based in `server/src/routes/`
- **Styles**: Tailwind CSS enabled with shadcn/ui components

## Next Steps

1. Add library API routes (`/api/library/*`)
2. Create file upload endpoint
3. Add mock NFC service
4. Build card linking UI

See SETUP.md for detailed information.
