import {
  Check,
  Music,
  Pause,
  Play,
  Podcast,
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

interface PodcastFeed {
  feed: {
    id: number
    title: string
    author?: string | null
  }
  totalEpisodes: number
  downloadedEpisodes: number
}

interface ContentPickerProps {
  contentType: 'song' | 'playlist' | 'action' | 'podcast'
  value: string | null
  onChange: (value: string) => void
  songs?: Array<Song>
  playlists?: Array<Playlist>
  podcasts?: Array<PodcastFeed>
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
  podcasts = [],
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

  // For song, playlist, and podcast types, render Command inline
  const getItems = () => {
    switch (contentType) {
      case 'song':
        return songs
      case 'playlist':
        return playlists
      case 'podcast':
        return podcasts
      default:
        return []
    }
  }

  const items = getItems()

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
              } else if (contentType === 'playlist') {
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
              } else {
                // contentType === 'podcast'
                const podcast = item as PodcastFeed
                return (
                  <CommandItem
                    key={podcast.feed.id}
                    value={`${podcast.feed.id}-${podcast.feed.title}-${podcast.feed.author || ''}`}
                    onSelect={() => {
                      onChange(podcast.feed.id.toString())
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === podcast.feed.id.toString()
                          ? 'opacity-100'
                          : 'opacity-0',
                      )}
                    />
                    <Podcast className="h-4 w-4 mr-2 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {podcast.feed.title}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {podcast.feed.author || 'Unknown author'} •{' '}
                        {podcast.downloadedEpisodes}/{podcast.totalEpisodes}{' '}
                        episodes
                      </div>
                    </div>
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
