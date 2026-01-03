import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useMatchRoute,
} from '@tanstack/react-router'

export const Route = createFileRoute('/admin')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/admin' || location.pathname === '/admin/') {
      throw redirect({
        to: '/admin/songs',
      })
    }
  },
  component: AdminLayout,
})

function AdminLayout() {
  const matchRoute = useMatchRoute()
  const isSongs = matchRoute({ to: '/admin/songs' })
  const isPlaylists = matchRoute({ to: '/admin/playlists' })
  const isDownloads = matchRoute({ to: '/admin/downloads' })
  const isCards = matchRoute({ to: '/admin/cards' })

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-7xl mx-auto p-6">
        <h1 className="text-4xl font-bold mb-8">🎵 MusicBox Admin</h1>

        <div className="flex gap-4 mb-8 border-b border-slate-700">
          <Link
            to="/admin/songs"
            className={`px-4 py-2 font-semibold transition-colors ${
              isSongs
                ? 'text-amber-400 border-b-2 border-amber-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Songs
          </Link>
          <Link
            to="/admin/playlists"
            className={`px-4 py-2 font-semibold transition-colors ${
              isPlaylists
                ? 'text-amber-400 border-b-2 border-amber-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Playlists
          </Link>
          <Link
            to="/admin/downloads"
            className={`px-4 py-2 font-semibold transition-colors ${
              isDownloads
                ? 'text-amber-400 border-b-2 border-amber-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Downloads
          </Link>
          <Link
            to="/admin/cards"
            className={`px-4 py-2 font-semibold transition-colors ${
              isCards
                ? 'text-amber-400 border-b-2 border-amber-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            NFC Cards
          </Link>
        </div>

        <Outlet />
      </div>
    </div>
  )
}
