import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { CreditCard, ListMusic, Mic, Music, Smartphone, Volume2 } from 'lucide-react'

export const Route = createFileRoute('/_library')({
  component: LibraryLayout,
})

function LibraryLayout() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-background/50 flex flex-col">
        {/* Mini Player placeholder */}
        <div className="h-20 border-b border-border flex items-center justify-center text-muted-foreground text-sm">
          Mini Player
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Songs Section */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
              Songs
            </h3>
            <NavLink to="/" icon={Music} label="All Songs" exact />
            <NavLink to="/playlists" icon={ListMusic} label="Playlists" />
          </div>

          <div className="border-t border-border" />

          {/* Podcasts Section */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
              Podcasts
            </h3>
            <NavLink to="/podcasts" icon={Mic} label="Podcasts" />
          </div>

          <div className="border-t border-border" />

          {/* Sound Machine Section */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
              Sound Machine
            </h3>
            <NavLink to="/soundmachine" icon={Volume2} label="Sounds" />
          </div>

          <div className="border-t border-border" />

          {/* System Section */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
              System
            </h3>
            <NavLink to="/cards" icon={CreditCard} label="Cards" />
            <NavLink to="/devices" icon={Smartphone} label="Devices" />
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

function NavLink({
  to,
  icon: Icon,
  label,
  exact,
}: {
  to: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  exact?: boolean
}) {
  return (
    <Link
      to={to}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors [&.active]:bg-accent [&.active]:text-accent-foreground hover:bg-accent/50"
      activeOptions={{ exact }}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </Link>
  )
}
