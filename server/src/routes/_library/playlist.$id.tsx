import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  getPlaylist,
  removePlaylist,
  removeSongFromPlaylistFn,
} from '@/services/songsServerFunctions'
import { Button, buttonVariants } from '@/components/ui/button'
import { usePlayer } from '@/hooks/usePlayerState'
import { SongList } from '@/components/SongList'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const playlistQueryOptions = (playlistId: number) => ({
  queryKey: ['playlist', playlistId],
  queryFn: async () => {
    const playlist = await getPlaylist({ data: { id: playlistId } })
    if (!playlist) {
      throw notFound()
    }
    return playlist
  },
})

export const Route = createFileRoute('/_library/playlist/$id')({
  loader: async ({ context, params }) => {
    const playlistId = parseInt(params.id)
    const playlist = await context.queryClient.ensureQueryData(
      playlistQueryOptions(playlistId),
    )

    return playlist
  },
  component: PlaylistView,
})

function PlaylistView() {
  const { id } = Route.useParams()
  const playlistId = parseInt(id)
  const player = usePlayer()
  const navigate = useNavigate()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const { data: playlist } = useSuspenseQuery(playlistQueryOptions(playlistId))

  const queryClient = useQueryClient()

  const removeSongFn = useServerFn(removeSongFromPlaylistFn)
  const deletePlaylistFn = useServerFn(removePlaylist)

  const removeSongMutation = useMutation({
    mutationFn: async (playlistSongId: number) => {
      return await removeSongFn({ data: { playlistId, playlistSongId } })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['playlist', playlistId],
      })
      await queryClient.invalidateQueries({ queryKey: ['playlists'] })
    },
  })

  const deletePlaylistMutation = useMutation({
    mutationFn: async () => {
      return await deletePlaylistFn({ data: { id: playlistId } })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playlists'] })
      // Navigate to library home after deletion
      navigate({ to: '/' })
    },
  })

  const handlePlayPlaylist = (startIndex: number = 0) => {
    if (playlist.songs.length === 0) return
    const songIds = playlist.songs.map((s: any) => s.id)
    player.playPlaylist(playlistId, songIds, startIndex)
  }

  const songsInPlaylist = playlist.songs
  console.log('Playlist songs:', songsInPlaylist)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold">{playlist.name}</h1>
          {songsInPlaylist.length > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={() => handlePlayPlaylist(0)}
            >
              <Play className="h-4 w-4 mr-2" />
              Play Playlist
            </Button>
          )}
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowDeleteDialog(true)}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Playlist
        </Button>
      </div>

      <SongList
        songs={songsInPlaylist}
        playlistId={playlistId}
        getRowKey={(song) => song.playlistSongId}
        emptyMessage="No songs in this playlist. Add songs from the All Songs view."
        renderActions={(song: any) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeSongMutation.mutate(song.playlistSongId)}
            disabled={removeSongMutation.isPending}
          >
            Remove
          </Button>
        )}
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Playlist</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{playlist.name}"? This action
              cannot be undone. Songs will not be deleted, only removed from
              this playlist.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => deletePlaylistMutation.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
