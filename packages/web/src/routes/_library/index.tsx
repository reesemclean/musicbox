import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Music, Search } from 'lucide-react'
import { api, type Media } from '@/lib/api-client'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute('/_library/')({
  component: SongsLibraryPage,
})

function SongsLibraryPage() {
  const [search, setSearch] = useState('')

  const { data: songs, isLoading, error } = useQuery({
    queryKey: ['media', 'songs'],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/media', {
        params: { query: { type: 'song' } },
      })
      if (error) throw new Error('Failed to load songs')
      return data
    },
  })

  const filteredSongs = songs?.filter((song) =>
    song.title.toLowerCase().includes(search.toLowerCase()) ||
    (song.metadata as any)?.artist?.toLowerCase().includes(search.toLowerCase()) ||
    (song.metadata as any)?.album?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">All Songs</h1>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search songs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-muted-foreground">
          Loading songs...
        </div>
      )}

      {error && (
        <div className="text-center py-12 text-destructive">
          Error: {error instanceof Error ? error.message : 'Failed to load'}
        </div>
      )}

      {songs && songs.length === 0 && (
        <EmptyState />
      )}

      {filteredSongs && filteredSongs.length > 0 && (
        <SongsTable songs={filteredSongs} />
      )}

      {songs && songs.length > 0 && filteredSongs?.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No songs match your search.
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-center py-12">
      <Music className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold mb-2">No songs yet</h2>
      <p className="text-muted-foreground">
        Upload some music to get started.
      </p>
    </div>
  )
}

function SongsTable({ songs }: { songs: Media[] }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr className="text-left text-sm text-muted-foreground">
            <th className="px-4 py-3 font-medium">Title</th>
            <th className="px-4 py-3 font-medium">Artist</th>
            <th className="px-4 py-3 font-medium">Album</th>
            <th className="px-4 py-3 font-medium text-right">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {songs.map((song) => (
            <SongRow key={song.id} song={song} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SongRow({ song }: { song: Media }) {
  const metadata = song.metadata as { artist?: string; album?: string } | null

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-muted rounded flex items-center justify-center">
            <Music className="h-5 w-5 text-muted-foreground" />
          </div>
          <span className="font-medium">{song.title}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {metadata?.artist || '—'}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {metadata?.album || '—'}
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground">
        {formatDuration(song.duration)}
      </td>
    </tr>
  )
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
