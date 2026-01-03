import { useState } from 'react'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { MoreVertical, Play, Trash2, X } from 'lucide-react'
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  getPlaylist,
  removePlaylist,
  removeSongFromPlaylistFn,
  reorderPlaylistSongsFn,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
  const reorderSongsFn = useServerFn(reorderPlaylistSongsFn)

  const removeSongMutation = useMutation({
    mutationFn: async (playlistSongId: number) => {
      return await removeSongFn({ data: { playlistId, playlistSongId } })
    },
    onMutate: (playlistSongId) => {
      // If the song being removed is currently playing, we need to handle it
      const songToRemove = playlist.songs.find(
        (s) => s.playlistSongId === playlistSongId,
      )

      if (
        songToRemove &&
        player.state.currentSongId === songToRemove.id &&
        player.state.currentPlaylistId === playlistId
      ) {
        // Get the remaining songs after removal
        const remainingSongs = playlist.songs.filter(
          (s) => s.playlistSongId !== playlistSongId,
        )

        if (remainingSongs.length === 0) {
          // No songs left, clear the player
          player.clearPlayer()
        } else {
          // Find the index of the song being removed
          const removedIndex = playlist.songs.findIndex(
            (s) => s.playlistSongId === playlistSongId,
          )

          // Play the next song if available, otherwise play the previous song
          const nextIndex =
            removedIndex < remainingSongs.length
              ? removedIndex
              : removedIndex - 1
          const nextSong = remainingSongs[nextIndex]
          const newSongIds = remainingSongs.map((s) => s.id)
          const newRowKey = nextSong.playlistSongId

          player.playPlaylist(playlistId, newSongIds, nextIndex, newRowKey)
        }
      }

      return { songToRemove }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['playlist', playlistId],
      })
      await queryClient.invalidateQueries({ queryKey: ['playlists'] })
    },
  })

  const reorderMutation = useMutation({
    mutationFn: async (
      reorderedSongs: Array<{ playlistSongId: number; position: number }>,
    ) => {
      return await reorderSongsFn({ data: { playlistId, reorderedSongs } })
    },
    onMutate: async (reorderedSongs) => {
      // Cancel any outgoing refetches to avoid overwriting our optimistic update
      await queryClient.cancelQueries({
        queryKey: ['playlist', playlistId],
      })

      // Snapshot the previous value
      const previousPlaylist = queryClient.getQueryData([
        'playlist',
        playlistId,
      ])

      // Optimistically update to the new value
      queryClient.setQueryData(['playlist', playlistId], (old: any) => {
        if (!old) return old

        // Create a map of playlistSongId to new position
        const positionMap = new Map(
          reorderedSongs.map((s) => [s.playlistSongId, s.position]),
        )

        // Sort songs by their new positions
        const reorderedSongsList = [...old.songs].sort((a, b) => {
          const posA = positionMap.get(a.playlistSongId) ?? a.position
          const posB = positionMap.get(b.playlistSongId) ?? b.position
          return posA - posB
        })

        // Update player queue if this playlist is currently playing
        if (
          player.state.currentPlaylistId === playlistId &&
          player.state.currentSongId
        ) {
          const newSongIds = reorderedSongsList.map((s: any) => s.id)
          const currentSongIndex = newSongIds.indexOf(
            player.state.currentSongId,
          )

          if (currentSongIndex !== -1) {
            // Update the queue and index to reflect the new order
            player.playPlaylist(playlistId, newSongIds, currentSongIndex)
          }
        }

        return {
          ...old,
          songs: reorderedSongsList,
        }
      })

      // Return context with the snapshot
      return { previousPlaylist }
    },
    onError: (_err, _variables, context) => {
      // If the mutation fails, rollback to the previous value
      if (context?.previousPlaylist) {
        queryClient.setQueryData(
          ['playlist', playlistId],
          context.previousPlaylist,
        )
      }
    },
    onSettled: () => {
      // Always refetch after error or success to ensure we're in sync with the server
      queryClient.invalidateQueries({
        queryKey: ['playlist', playlistId],
      })
    },
  })

  const deletePlaylistMutation = useMutation({
    mutationFn: async () => {
      return await deletePlaylistFn({ data: { id: playlistId } })
    },
    onSuccess: async () => {
      // If this playlist is currently playing, clear the player
      if (player.state.currentPlaylistId === playlistId) {
        player.clearPlayer()
      }

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
  const songIds = songsInPlaylist.map((s: any) => s.playlistSongId)

  // Handle drag and drop reordering
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = songIds.indexOf(active.id as number)
      const newIndex = songIds.indexOf(over.id as number)

      // Optimistically update UI
      const newOrder = arrayMove(songsInPlaylist, oldIndex, newIndex)

      // Update positions in database
      const reorderedSongs = newOrder.map((song: any, index: number) => ({
        playlistSongId: song.playlistSongId,
        position: index,
      }))

      reorderMutation.mutate(reorderedSongs)
    }
  }

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {}),
  )

  return (
    <DndContext
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
      sensors={sensors}
    >
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

        <SortableContext items={songIds} strategy={verticalListSortingStrategy}>
          <SongList
            songs={songsInPlaylist}
            playlistId={playlistId}
            getRowKey={(song) => song.playlistSongId}
            emptyMessage="No songs in this playlist. Add songs from the All Songs view."
            enableDragAndDrop={true}
            renderActions={(song: any) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={removeSongMutation.isPending}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      removeSongMutation.mutate(song.playlistSongId)
                    }
                    disabled={removeSongMutation.isPending}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Remove from Playlist
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          />
        </SortableContext>

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
    </DndContext>
  )
}
