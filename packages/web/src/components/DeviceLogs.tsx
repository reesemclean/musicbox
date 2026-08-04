import { useEffect, useRef, useState } from 'react'
import { Trash2, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDeviceLogs, type DeviceLogLine } from '@/hooks/useMqtt'

const LEVEL_STYLE: Record<DeviceLogLine['level'], string> = {
  E: 'text-red-600 dark:text-red-400',
  W: 'text-yellow-600 dark:text-yellow-400',
  I: 'text-foreground',
  D: 'text-muted-foreground',
}

/** Seconds of device uptime as m:ss / h:mm:ss, which reads better than raw seconds. */
function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/**
 * Live log output from a device.
 *
 * Devices batch their logs over MQTT every few seconds and the browser is
 * already subscribed to that topic, so this needs no polling and no server
 * round trip — it renders data that was arriving regardless.
 */
export function DeviceLogs({ mac }: { mac: string }) {
  const { lines, clear } = useDeviceLogs(mac)
  const [debug, setDebug] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedToBottom = useRef(true)

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
          {visible.length > 0 ? `${visible.length} lines` : 'waiting…'}
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
            onClick={clear}
            disabled={lines.length === 0}
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
        {visible.length === 0 ? (
          <p className="text-muted-foreground">
            Devices send their logs every few seconds. Nothing has arrived yet —
            if this stays empty, the device isn't connected to the broker.
          </p>
        ) : (
          visible.map((line, i) => (
            <div key={i} className="flex gap-2 whitespace-pre-wrap break-all">
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatUptime(line.uptime)}
              </span>
              <span className={`shrink-0 ${LEVEL_STYLE[line.level]}`}>
                [{line.module}]
              </span>
              <span className={LEVEL_STYLE[line.level]}>{line.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
