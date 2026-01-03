import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Music, Plus } from 'lucide-react'
import { useState } from 'react'
import {
  addPlaylist,
  getPlaylists,
  getSongs,
} from '@/services/songsServerFunctions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const songsQueryOptions = queryOptions({
  queryKey: ['songs'],
  queryFn: getSongs,
})

const playlistsQueryOptions = queryOptions({
  queryKey: ['playlists'],
  queryFn: getPlaylists,
})

export const Route = createFileRoute('/_library')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(songsQueryOptions)
    await context.queryClient.ensureQueryData(playlistsQueryOptions)
  },
  component: LibraryLayout,
})

function LibraryLayout() {
  const { data: songs } = useSuspenseQuery(songsQueryOptions)
  const { data: playlists } = useSuspenseQuery(playlistsQueryOptions)
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const queryClient = useQueryClient()

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
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Sidebar */}
      <div className="w-64 border-r bg-background/50 p-4 space-y-6">
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
            to="/cards"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors [&.active]:bg-accent [&.active]:text-accent-foreground hover:bg-accent/50"
          >
            <Music className="h-4 w-4" />
            <span>Cards</span>
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
                <Music className="h-4 w-4" />
                <span className="truncate">{playlist.name}</span>
              </Link>
            ))}
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
