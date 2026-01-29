import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: HomePage })

function HomePage() {
  return (
    <div>
      <h1 className="text-3xl font-bold">Welcome to MusicBox</h1>
      <p className="mt-2 text-gray-600">
        NFC-powered music player for kids. Manage your library, playlists, cards, and devices.
      </p>
    </div>
  )
}
