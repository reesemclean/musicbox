interface MiniPlayerEmptyProps {
  error?: boolean
}

export function MiniPlayerEmpty({ error = false }: MiniPlayerEmptyProps) {
  return (
    <div className="p-4 border-b bg-background/50">
      <div className="flex flex-col gap-2">
        {/* Song Info */}
        <div className="min-w-0">
          <div
            className={`text-xs font-medium truncate ${error ? 'text-destructive' : ''}`}
          >
            {error ? 'Failed to load song' : 'No song playing'}
          </div>
          <div className="text-xs text-muted-foreground truncate invisible">
            Placeholder
          </div>
          <div className="text-xs text-muted-foreground truncate invisible">
            Placeholder
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-1">
          <button
            disabled
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-sm font-medium opacity-50 cursor-not-allowed"
          >
            <span className="sr-only">Previous</span>
          </button>
          <button
            disabled
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-sm font-medium opacity-50 cursor-not-allowed"
          >
            <span className="sr-only">Play</span>
          </button>
          <button
            disabled
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-sm font-medium opacity-50 cursor-not-allowed"
          >
            <span className="sr-only">Next</span>
          </button>
        </div>
      </div>
    </div>
  )
}
