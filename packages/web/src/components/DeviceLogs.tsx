import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getDeviceLogs, clearDeviceLogs } from '@/server/devices'

interface LogLine {
  seq: number
  uptime: number
  level: string
  module: string
  message: string
}

const LEVEL_STYLE: Record<string, string> = {
  E: 'text-red-600 dark:text-red-400',
  W: 'text-yellow-600 dark:text-yellow-400',
  I: 'text-foreground',
  D: 'text-muted-foreground',
}

/** Device uptime as m:ss / h:mm:ss, which reads better than raw seconds. */
function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/**
 * Log output from a device.
 *
 * Read from the server rather than from live MQTT. Device logs are published
 * as ordinary messages, so a subscriber only ever sees what was sent while it
 * was connected — a browser opened after boot has permanently missed the boot
 * sequence, which is the part worth reading. The server is connected from
 * startup and keeps the history, so asking it returns everything regardless of
 * when this page was opened.
 */
export function DeviceLogs({ mac }: { mac: string }) {
  const queryClient = useQueryClient()
  const [debug, setDebug] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedToBottom = useRef(true)

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['device-logs', mac],
    queryFn: () => getDeviceLogs({ data: { mac } }) as Promise<LogLine[]>,
    // Devices batch their output every couple of seconds; matching that is
    // close enough to live for reading logs.
    refetchInterval: 2000,
  })

  const clearMutation = useMutation({
    mutationFn: async () => {
      await clearDeviceLogs({ data: { mac } })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['device-logs', mac] }),
  })

  const visible = debug ? lines : lines.filter((l) => l.level !== 'D')

  // Follow new output, but stop fighting the user if they scroll up to read
  // something.
  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [visible.length])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <ScrollText className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Device log
        </h4>
        <span className="text-xs text-muted-foreground">
          {visible.length > 0 ? `${visible.length} lines` : ''}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={debug}
              onChange={(e) => setDebug(e.target.checked)}
              className="h-3 w-3 accent-current"
            />
            Debug
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground"
            onClick={() => clearMutation.mutate()}
            disabled={lines.length === 0 || clearMutation.isPending}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-48 overflow-y-auto rounded border border-border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed"
      >
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-muted-foreground">
            No output recorded since the server started. Devices send their logs
            every couple of seconds — if this stays empty, the device isn't
            reaching the broker.
          </p>
        ) : (
          visible.map((line) => (
            <div key={line.seq} className="flex gap-2 whitespace-pre-wrap break-all">
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatUptime(line.uptime)}
              </span>
              <span className={`shrink-0 ${LEVEL_STYLE[line.level] ?? ''}`}>
                [{line.module}]
              </span>
              <span className={LEVEL_STYLE[line.level] ?? ''}>{line.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
