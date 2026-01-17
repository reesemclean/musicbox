import {
  ClientOnly,
  Link,
  Outlet,
  createFileRoute,
} from '@tanstack/react-router'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { CreditCard, Download, Music, Plus, Smartphone } from 'lucide-react'
import { useState } from 'react'
import {
  addPlaylist,
  getPlaylists,
  getSongs,
} from '@/services/songsServerFunctions'
import { getAllCards } from '@/services/serverFunctions'
import { getDownloadQueueStatus } from '@/services/ytmusicServerFunctions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MiniPlayer } from '@/components/MiniPlayer'
import { MiniPlayerEmpty } from '@/components/MiniPlayerEmpty'

const songsQueryOptions = queryOptions({
  queryKey: ['songs'],
  queryFn: getSongs,
})

const playlistsQueryOptions = queryOptions({
  queryKey: ['playlists'],
  queryFn: getPlaylists,
})

const cardsQueryOptions = queryOptions({
  queryKey: ['cards'],
  queryFn: getAllCards,
})

export const Route = createFileRoute('/_library')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(songsQueryOptions)
    await context.queryClient.ensureQueryData(playlistsQueryOptions)
    await context.queryClient.ensureQueryData(cardsQueryOptions)
  },
  component: LibraryLayout,
})

function LibraryLayout() {
  const { data: songs } = useSuspenseQuery(songsQueryOptions)
  const { data: playlists } = useSuspenseQuery(playlistsQueryOptions)
  const { data: cards } = useSuspenseQuery(cardsQueryOptions)
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const queryClient = useQueryClient()

  // Track download queue for badge
  const { data: queue = [] } = useQuery({
    queryKey: ['downloadQueue'],
    queryFn: getDownloadQueueStatus,
    refetchInterval: 2000,
  })

  const activeDownloadsCount = queue.filter(
    (item) => item.status === 'downloading' || item.status === 'pending',
  ).length

  const createPlaylistFn = useServerFn(addPlaylist)
  const createPlaylistMutation = useMutation({
    mutationFn: async (name: string) => {
      return await createPlaylistFn({ data: { name } })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playlists'] })
      setNewPlaylistName('')
      setShowCreatePlaylist(false)
    },
  })

  const handleCreatePlaylist = () => {
    if (newPlaylistName.trim()) {
      createPlaylistMutation.mutate(newPlaylistName)
    }
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-64 border-r bg-background/50 flex flex-col">
        {/* Mini Player at top */}
        <ClientOnly fallback={<MiniPlayerEmpty />}>
          <MiniPlayer />
        </ClientOnly>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Library Section */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
              Library
            </h3>
            <Link
              to="/"
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors [&.active]:bg-accent [&.active]:text-accent-foreground hover:bg-accent/50"
              activeOptions={{ exact: true }}
            >
              <Music className="h-4 w-4" />
              <span>All Songs</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {songs.length}
              </span>
            </Link>
            <Link
              to="/downloads"
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors [&.active]:bg-accent [&.active]:text-accent-foreground hover:bg-accent/50"
            >
              <Download className="h-4 w-4" />
              <span>Add Media</span>
              {activeDownloadsCount > 0 && (
                <span className="ml-auto flex items-center justify-center h-5 w-5 rounded-full bg-blue-500 text-white text-xs font-bold">
                  {activeDownloadsCount}
                </span>
              )}
            </Link>
            <Link
              to="/cards"
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors [&.active]:bg-accent [&.active]:text-accent-foreground hover:bg-accent/50"
            >
              <CreditCard className="h-4 w-4" />
              <span>Cards</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {cards.length}
              </span>
            </Link>
            <Link
              to="/devices"
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors [&.active]:bg-accent [&.active]:text-accent-foreground hover:bg-accent/50"
            >
              <Smartphone className="h-4 w-4" />
              <span>Devices</span>
            </Link>
          </div>

          {/* Playlists Section */}
          <div>
            <div className="flex items-center justify-between mb-2 px-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Playlists
              </h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setShowCreatePlaylist(true)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {showCreatePlaylist && (
              <div className="mb-2 px-2 space-y-2">
                <Input
                  placeholder="Playlist name"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreatePlaylist()
                    if (e.key === 'Escape') {
                      setShowCreatePlaylist(false)
                      setNewPlaylistName('')
                    }
                  }}
                  autoFocus
                  className="h-8"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleCreatePlaylist}
                    disabled={!newPlaylistName.trim()}
                    className="h-7 text-xs"
                  >
                    Create
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowCreatePlaylist(false)
                      setNewPlaylistName('')
                    }}
                    className="h-7 text-xs"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-1">
              {playlists.map((playlist) => (
                <Link
                  key={playlist.id}
                  to="/playlist/$id"
                  params={{ id: playlist.id.toString() }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors [&.active]:bg-accent [&.active]:text-accent-foreground hover:bg-accent/50"
                >
                  <span className="truncate">{playlist.name}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
