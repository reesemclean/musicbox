import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/admin' || location.pathname === '/admin/') {
      throw redirect({
        to: '/admin/library',
      })
    }
  },
  component: AdminLayout,
})

function AdminLayout() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : ''
  const activeTab = pathname.includes('/admin/downloads')
    ? 'downloads'
    : pathname.includes('/admin/cards')
    ? 'cards'
    : 'library'

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-7xl mx-auto p-6">
        <h1 className="text-4xl font-bold mb-8">🎵 MusicBox Admin</h1>

        <div className="flex gap-4 mb-8 border-b border-slate-700">
          <Link
            to="/admin/library"
            className={`px-4 py-2 font-semibold transition-colors ${
              activeTab === 'library'
                ? 'text-amber-400 border-b-2 border-amber-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Library
          </Link>
          <Link
            to="/admin/downloads"
            className={`px-4 py-2 font-semibold transition-colors ${
              activeTab === 'downloads'
                ? 'text-amber-400 border-b-2 border-amber-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Downloads
          </Link>
          <Link
            to="/admin/cards"
            className={`px-4 py-2 font-semibold transition-colors ${
              activeTab === 'cards'
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
