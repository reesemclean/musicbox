import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CreditCard, ListMusic, Mic, Music, Plus, Smartphone } from 'lucide-react'
import { MiniPlayer } from '@/components/MiniPlayer'
import { getQueue } from '@/server/downloads'

export const Route = createFileRoute('/_library')({
  component: LibraryLayout,
})

function LibraryLayout() {
  // Poll download queue for badge
  const { data: queue = [] } = useQuery({
    queryKey: ['downloadQueue'],
    queryFn: () => getQueue(),
    refetchInterval: 2000,
  })

  const activeDownloads = queue.filter(
    (item) => item.status === 'downloading' || item.status === 'pending'
  ).length

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-background/50 flex flex-col">
        {/* Mini Player */}
        <MiniPlayer />

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Songs Section */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
              Songs
            </h3>
            <NavLink to="/" icon={Music} label="All Songs" exact />
            <NavLink to="/playlists" icon={ListMusic} label="Playlists" />
            <NavLink
              to="/add-songs"
              icon={Plus}
              label="Add Songs"
              badge={activeDownloads > 0 ? activeDownloads : undefined}
            />
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
  badge,
}: {
  to: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  exact?: boolean
  badge?: number
}) {
  return (
    <Link
      to={to}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors [&.active]:bg-accent [&.active]:text-accent-foreground hover:bg-accent/50"
      activeOptions={{ exact }}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span className="bg-blue-500 text-white text-xs font-medium px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
          {badge}
        </span>
      )}
    </Link>
  )
}
