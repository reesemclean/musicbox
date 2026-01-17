import { ClientOnly } from '@tanstack/react-router'
import { GripVertical, MoreVertical, Play, Trash2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SongPlayButton } from './SongPlayButton'
import type { CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { usePlayer } from '@/hooks/usePlayerState'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Helper function to format duration from seconds to MM:SS
function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export interface Song {
  id: number
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | string | null
}

interface SongListProps<T extends Song> {
  songs: Array<T>
  playlistId?: number
  renderActions?: (song: T) => React.ReactNode
  emptyMessage?: string
  getRowKey?: (song: T) => string | number
  // Multiselect props
  selectable?: boolean
  selectedSongs?: Set<number>
  onToggleSelection?: (songId: number) => void
  onToggleSelectAll?: () => void
  // Drag and drop props
  enableDragAndDrop?: boolean
  // Delete props
  onDeleteSong?: (song: T) => void
  deletingSongId?: number | null
}

// Drag handle component
function DragHandle({ rowId }: { rowId: string | number }) {
  const { attributes, listeners } = useSortable({
    id: rowId,
  })
  return (
    <button
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing p-1 hover:bg-accent rounded"
    >
      <GripVertical className="h-4 w-4 text-muted-foreground" />
    </button>
  )
}

// Draggable row component
function DraggableRow<T extends Song>({
  song,
  rowKey,
  playlistId,
  player,
  selectable,
  selectedSongs,
  onToggleSelection,
  renderActions,
  handlePlaySong,
  handleTogglePlay,
  enableDragAndDrop,
  onDeleteSong,
  deletingSongId,
}: {
  song: T
  rowKey: string | number
  playlistId: number
  player: any
  selectable: boolean
  selectedSongs: Set<number>
  onToggleSelection?: (songId: number) => void
  renderActions?: (song: T) => React.ReactNode
  handlePlaySong: (song: T) => void
  handleTogglePlay: (song: T) => void
  enableDragAndDrop?: boolean
  onDeleteSong?: (song: T) => void
  deletingSongId?: number | null
}) {
  const { transform, transition, setNodeRef, isDragging } = useSortable({
    id: rowKey,
  })

  const style: CSSProperties = enableDragAndDrop
    ? {
        transform: CSS.Transform.toString(transform),
        transition: transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1 : 'auto',
        position: isDragging ? 'relative' : 'static',
        backgroundColor: isDragging ? 'var(--accent)' : undefined,
      }
    : {}

  const isSelected = selectedSongs.has(song.id)

  return (
    <tr
      ref={enableDragAndDrop ? setNodeRef : undefined}
      style={style}
      className="border-b last:border-0 hover:bg-accent/50 transition-colors group"
    >
      {enableDragAndDrop && (
        <td className="p-4 w-12">
          <DragHandle rowId={rowKey} />
        </td>
      )}
      {selectable && (
        <td className="p-4">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelection?.(song.id)}
            aria-label={`Select ${song.title}`}
          />
        </td>
      )}
      <td className="p-4">
        <ClientOnly
          fallback={
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 opacity-0 group-hover:opacity-100"
            >
              <Play className="h-4 w-4" />
            </Button>
          }
        >
          <SongPlayButton
            songId={song.id}
            songTitle={song.title}
            playlistId={playlistId}
            getIsCurrentSong={() =>
              player.state.currentSongId === song.id &&
              player.state.currentPlaylistId === playlistId &&
              player.state.currentRowKey === rowKey
            }
            onTogglePlay={() => handleTogglePlay(song)}
          />
        </ClientOnly>
      </td>
      <td className="p-4 cursor-pointer" onClick={() => handlePlaySong(song)}>
        <div className="font-medium">{song.title}</div>
      </td>
      <td
        className="p-4 text-muted-foreground cursor-pointer"
        onClick={() => handlePlaySong(song)}
      >
        {song.artist || '—'}
      </td>
      <td
        className="p-4 text-muted-foreground cursor-pointer"
        onClick={() => handlePlaySong(song)}
      >
        {song.album || '—'}
      </td>
      <td
        className="p-4 text-right text-muted-foreground cursor-pointer"
        onClick={() => handlePlaySong(song)}
      >
        {typeof song.duration === 'number'
          ? formatDuration(song.duration)
          : song.duration || '—'}
      </td>
      {renderActions && (
        <td className="p-4 text-right">{renderActions(song)}</td>
      )}
      {onDeleteSong && (
        <td className="p-4 text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100"
                disabled={deletingSongId === song.id}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onDeleteSong(song)}
                disabled={deletingSongId === song.id}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Song
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      )}
    </tr>
  )
}

export function SongList<T extends Song>({
  songs,
  playlistId = 0,
  renderActions,
  emptyMessage = 'No songs available',
  getRowKey,
  selectable = false,
  selectedSongs = new Set(),
  onToggleSelection,
  onToggleSelectAll,
  enableDragAndDrop = false,
  onDeleteSong,
  deletingSongId,
}: SongListProps<T>) {
  const player = usePlayer()

  const handlePlaySong = (song: T) => {
    const songIds = songs.map((s) => s.id)
    const songIndex = songIds.indexOf(song.id)
    const rowKey = getRowKey ? getRowKey(song) : song.id
    player.playPlaylist(playlistId, songIds, songIndex, rowKey)
  }

  const handleTogglePlay = (song: T) => {
    const rowKey = getRowKey ? getRowKey(song) : song.id
    // If this song is currently playing, toggle play/pause
    if (
      player.state.currentSongId === song.id &&
      player.state.currentPlaylistId === playlistId &&
      player.state.currentRowKey === rowKey
    ) {
      player.togglePlayPause()
    } else {
      // Otherwise, play the song
      handlePlaySong(song)
    }
  }

  const allSelected = songs.length > 0 && selectedSongs.size === songs.length

  if (songs.length === 0) {
    return (
      <div className="bg-card rounded-lg border">
        <div className="text-center py-12 text-muted-foreground">
          {emptyMessage}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-lg border overflow-hidden">
      <table className="w-full">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b">
            {enableDragAndDrop && <th className="w-12 p-4"></th>}
            {selectable && (
              <th className="w-12 p-4">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={onToggleSelectAll}
                  aria-label="Select all songs"
                />
              </th>
            )}
            <th className="w-12"></th>
            <th className="text-left p-4 font-medium">Title</th>
            <th className="text-left p-4 font-medium">Artist</th>
            <th className="text-left p-4 font-medium">Album</th>
            <th className="text-right p-4 font-medium">Duration</th>
            {renderActions && (
              <th className="text-right p-4 font-medium">Actions</th>
            )}
            {onDeleteSong && <th className="w-12"></th>}
          </tr>
        </thead>
        <tbody>
          {songs.map((song) => {
            const rowKey = getRowKey ? getRowKey(song) : song.id
            return (
              <DraggableRow
                key={rowKey}
                song={song}
                rowKey={rowKey}
                playlistId={playlistId}
                player={player}
                selectable={selectable}
                selectedSongs={selectedSongs}
                onToggleSelection={onToggleSelection}
                renderActions={renderActions}
                handlePlaySong={handlePlaySong}
                handleTogglePlay={handleTogglePlay}
                enableDragAndDrop={enableDragAndDrop}
                onDeleteSong={onDeleteSong}
                deletingSongId={deletingSongId}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
