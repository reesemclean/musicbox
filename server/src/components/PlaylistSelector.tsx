import { useState } from 'react'
import { ChevronsUpDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

interface Playlist {
  id: number
  name: string
}

interface PlaylistSelectorProps {
  playlists: Array<Playlist>
  onSelect: (playlistId: number) => void
  onCreatePlaylist?: (name: string) => void
  disabled?: boolean
}

export function PlaylistSelector({
  playlists,
  onSelect,
  onCreatePlaylist,
  disabled = false,
}: PlaylistSelectorProps) {
  const [open, setOpen] = useState(false)
  const [showCreateInput, setShowCreateInput] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredPlaylists = playlists.filter((playlist) =>
    playlist.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const handleSelect = (playlistId: number) => {
    onSelect(playlistId)
    setOpen(false)
    setSearchQuery('')
  }

  const handleCreatePlaylist = () => {
    if (newPlaylistName.trim() && onCreatePlaylist) {
      onCreatePlaylist(newPlaylistName.trim())
      setNewPlaylistName('')
      setShowCreateInput(false)
      setSearchQuery('')
      setOpen(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleCreatePlaylist()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setShowCreateInput(false)
      setNewPlaylistName('')
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="default"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="justify-between"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add to Playlist
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-75 p-0" align="end">
        <div className="flex flex-col">
          {/* Search Input */}
          <div className="p-3 border-b">
            <Input
              placeholder="Search playlists..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8"
            />
          </div>

          {/* Playlist List */}
          <ScrollArea className="max-h-75">
            {filteredPlaylists.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                No playlists found.
              </div>
            ) : (
              <div className="p-1">
                {filteredPlaylists.map((playlist) => (
                  <button
                    key={playlist.id}
                    onClick={() => handleSelect(playlist.id)}
                    className="w-full text-left px-3 py-2 text-sm rounded-sm hover:bg-accent transition-colors"
                  >
                    {playlist.name}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Create New Playlist Section */}
          {onCreatePlaylist && (
            <>
              <div className="border-t" />
              {showCreateInput ? (
                <div className="p-3">
                  <Input
                    placeholder="New playlist name..."
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    className="h-8 mb-2"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleCreatePlaylist}
                      disabled={!newPlaylistName.trim()}
                      className="h-7 text-xs flex-1"
                    >
                      Create
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowCreateInput(false)
                        setNewPlaylistName('')
                      }}
                      className="h-7 text-xs flex-1"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCreateInput(true)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  <span>Create New Playlist</span>
                </button>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
