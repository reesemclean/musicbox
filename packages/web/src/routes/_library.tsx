import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { CreditCard, Download, Mic, Music, Smartphone } from 'lucide-react'

export const Route = createFileRoute('/_library')({
  component: LibraryLayout,
})

const navItems = [
  { to: '/', label: 'All Songs', icon: Music },
  { to: '/downloads', label: 'Add Media', icon: Download },
  { to: '/cards', label: 'Cards', icon: CreditCard },
  { to: '/podcasts', label: 'Podcasts', icon: Mic },
  { to: '/devices', label: 'Devices', icon: Smartphone },
]

function LibraryLayout() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-background/50 flex flex-col">
        {/* Mini Player placeholder */}
        <div className="h-20 border-b border-border flex items-center justify-center text-muted-foreground text-sm">
          Mini Player
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Library Section */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
              Library
            </h3>
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors [&.active]:bg-accent [&.active]:text-accent-foreground hover:bg-accent/50"
                activeOptions={{ exact: item.to === '/' }}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>

          {/* Playlists Section */}
          <div>
            <div className="flex items-center justify-between mb-2 px-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Playlists
              </h3>
            </div>
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No playlists yet
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  )
}
