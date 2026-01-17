import {
  Check,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
} from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface Song {
  id: number
  title: string
  artist?: string | null
  album?: string | null
}

interface Playlist {
  id: number
  name: string
}

interface ContentPickerProps {
  contentType: 'song' | 'playlist' | 'action'
  value: string | null
  onChange: (value: string) => void
  songs?: Array<Song>
  playlists?: Array<Playlist>
  disabled?: boolean
}

const actionOptions = [
  { value: 'play', label: 'Play', icon: Play },
  { value: 'pause', label: 'Pause', icon: Pause },
  { value: 'next', label: 'Next', icon: SkipForward },
  { value: 'previous', label: 'Previous', icon: SkipBack },
  { value: 'stop', label: 'Stop', icon: Square },
]

export function ContentPicker({
  contentType,
  value,
  onChange,
  songs = [],
  playlists = [],
  disabled = false,
}: ContentPickerProps) {
  // For action type, use a simple select dropdown
  if (contentType === 'action') {
    return (
      <Select
        value={value || undefined}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select an action" />
        </SelectTrigger>
        <SelectContent>
          {actionOptions.map((action) => (
            <SelectItem key={action.value} value={action.value}>
              <div className="flex items-center">
                <action.icon className="h-4 w-4 mr-2" />
                {action.label}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  // For song and playlist types, render Command inline (not in Popover to avoid nesting issues)
  const items = contentType === 'song' ? songs : playlists

  return (
    <div className="space-y-2">
      <Command className="rounded-lg border">
        <CommandInput placeholder={`Search ${contentType}s...`} />
        <CommandList className="max-h-[200px]">
          <CommandEmpty>No {contentType} found.</CommandEmpty>
          <CommandGroup>
            {items.map((item) => {
              if (contentType === 'song') {
                const song = item as Song
                return (
                  <CommandItem
                    key={song.id}
                    value={`${song.id}-${song.title}-${song.artist || ''}-${song.album || ''}`}
                    onSelect={() => {
                      onChange(song.id.toString())
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === song.id.toString()
                          ? 'opacity-100'
                          : 'opacity-0',
                      )}
                    />
                    <Music className="h-4 w-4 mr-2 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{song.title}</div>
                      {(song.artist || song.album) && (
                        <div className="text-xs text-muted-foreground truncate">
                          {[song.artist, song.album]
                            .filter(Boolean)
                            .join(' • ')}
                        </div>
                      )}
                    </div>
                  </CommandItem>
                )
              } else {
                const playlist = item as Playlist
                return (
                  <CommandItem
                    key={playlist.id}
                    value={`${playlist.id}-${playlist.name}`}
                    onSelect={() => {
                      onChange(playlist.id.toString())
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === playlist.id.toString()
                          ? 'opacity-100'
                          : 'opacity-0',
                      )}
                    />
                    <div className="font-medium truncate">{playlist.name}</div>
                  </CommandItem>
                )
              }
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  )
}
