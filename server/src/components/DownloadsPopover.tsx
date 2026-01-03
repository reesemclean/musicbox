import { useQuery } from '@tanstack/react-query'
import { Download, Loader2, XCircle } from 'lucide-react'
import { useState } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { getDownloadQueueStatus } from '@/services/ytmusicServerFunctions'

const downloadQueueOptions = {
  queryKey: ['downloadQueue'],
  queryFn: async () => {
    const result = await getDownloadQueueStatus()
    return result
  },
}

export function DownloadsPopover() {
  const [isOpen, setIsOpen] = useState(false)

  const { data: queue = [] } = useQuery({
    ...downloadQueueOptions,
    refetchInterval: 2000, // Refresh every 2 seconds
  })

  const activeDownloads = queue.filter(
    (item) => item.status === 'downloading' || item.status === 'pending',
  )
  const failedDownloads = queue.filter((item) => item.status === 'failed')

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-300 hover:text-white"
          aria-label="Downloads"
        >
          <Download size={20} />
          {activeDownloads.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
              {activeDownloads.length}
            </span>
          )}
          {failedDownloads.length > 0 && activeDownloads.length === 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
              {failedDownloads.length}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-96 max-h-[80vh] overflow-hidden flex flex-col p-0"
        align="end"
      >
        <div className="p-4 border-b">
          <h3 className="font-semibold text-lg">Downloads</h3>
          {queue.length === 0 && (
            <p className="text-muted-foreground text-sm mt-1">
              No active downloads
            </p>
          )}
        </div>

        {queue.length > 0 && (
          <div className="overflow-y-auto flex-1">
            <div className="p-2 space-y-2">
              {queue.map((item) => (
                <div key={item.id} className="p-3 bg-secondary rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      {item.status === 'downloading' && (
                        <Loader2
                          size={18}
                          className="text-blue-400 animate-spin"
                        />
                      )}
                      {item.status === 'pending' && (
                        <Loader2 size={18} className="text-muted-foreground" />
                      )}
                      {item.status === 'failed' && (
                        <XCircle size={18} className="text-red-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {item.title}
                      </p>
                      <p className="text-muted-foreground text-xs truncate">
                        {item.artist}
                      </p>

                      {item.status === 'downloading' && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                            <span>Downloading</span>
                            <span>{item.progress}%</span>
                          </div>
                          <div className="w-full bg-secondary rounded-full h-1.5">
                            <div
                              className="bg-blue-500 h-1.5 rounded-full transition-all"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {item.status === 'pending' && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Waiting to start...
                        </p>
                      )}

                      {item.status === 'failed' && item.error && (
                        <p className="text-xs text-red-400 mt-1">
                          {item.error}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
