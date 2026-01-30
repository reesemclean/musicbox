import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { Cpu, Wifi, WifiOff, Clock, Globe, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { api, type Device } from '@/lib/api-client'

const devicesQueryOptions = queryOptions({
  queryKey: ['devices'],
  queryFn: async () => {
    const { data, error } = await api.GET('/api/devices')
    if (error) throw new Error('Failed to load devices')
    return data
  },
})

export const Route = createFileRoute('/_library/devices')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(devicesQueryOptions)
  },
  component: DevicesPage,
})

function DevicesPage() {
  const { data: devices } = useSuspenseQuery(devicesQueryOptions)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Devices</h1>
      </div>

      {devices.length === 0 ? (
        <EmptyState />
      ) : (
        <DevicesTable devices={devices as Device[]} />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-center py-12">
      <Cpu className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold mb-2">No devices registered</h2>
      <p className="text-muted-foreground">
        Power on a MusicBox device to have it appear here.
      </p>
    </div>
  )
}

function DevicesTable({ devices }: { devices: Device[] }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr className="text-left text-sm text-muted-foreground">
            <th className="px-4 py-3 font-medium">Device</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Connection</th>
            <th className="px-4 py-3 font-medium">Firmware</th>
            <th className="px-4 py-3 font-medium">Last Seen</th>
            <th className="px-4 py-3 font-medium">IP Address</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {devices.map((device) => (
            <DeviceRow key={device.id} device={device} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DeviceRow({ device }: { device: Device }) {
  const isOnline = getIsOnline(device.lastSeen)

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-muted rounded flex items-center justify-center">
            <Cpu className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <span className="font-medium block">{device.name || 'Unnamed Device'}</span>
            <code className="text-xs text-muted-foreground">{device.mac}</code>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={device.status} />
      </td>
      <td className="px-4 py-3">
        <ConnectionStatus isOnline={isOnline} />
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-muted-foreground">
          {device.firmwareVersion || '—'}
        </span>
      </td>
      <td className="px-4 py-3">
        <LastSeen lastSeen={device.lastSeen} />
      </td>
      <td className="px-4 py-3">
        {device.lastIp ? (
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Globe className="h-3 w-3" />
            <span>{device.lastIp}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  )
}

function StatusBadge({ status }: { status: Device['status'] }) {
  switch (status) {
    case 'approved':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
          <CheckCircle2 className="h-3 w-3" />
          Approved
        </span>
      )
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <XCircle className="h-3 w-3" />
          Rejected
        </span>
      )
    case 'pending':
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
          <AlertCircle className="h-3 w-3" />
          Pending
        </span>
      )
  }
}

function ConnectionStatus({ isOnline }: { isOnline: boolean }) {
  if (isOnline) {
    return (
      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
        <Wifi className="h-4 w-4" />
        <span className="text-sm">Online</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <WifiOff className="h-4 w-4" />
      <span className="text-sm">Offline</span>
    </span>
  )
}

function LastSeen({ lastSeen }: { lastSeen: string | null }) {
  if (!lastSeen) {
    return <span className="text-muted-foreground">—</span>
  }

  const date = new Date(lastSeen)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  let timeAgo: string
  if (diffMins < 1) {
    timeAgo = 'Just now'
  } else if (diffMins < 60) {
    timeAgo = `${diffMins}m ago`
  } else if (diffHours < 24) {
    timeAgo = `${diffHours}h ago`
  } else {
    timeAgo = `${diffDays}d ago`
  }

  return (
    <div className="flex items-center gap-1 text-sm text-muted-foreground">
      <Clock className="h-3 w-3" />
      <span title={date.toLocaleString()}>{timeAgo}</span>
    </div>
  )
}

function getIsOnline(lastSeen: string | null): boolean {
  if (!lastSeen) return false

  const date = new Date(lastSeen)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const fiveMinutes = 5 * 60 * 1000

  return diffMs < fiveMinutes
}
