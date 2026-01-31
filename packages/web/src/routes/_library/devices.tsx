import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Cpu, Wifi, WifiOff, Clock, Globe, CheckCircle2, XCircle, AlertCircle, Check, X, Pause, Play, Square, Volume2, VolumeX, ChevronDown, ChevronUp } from 'lucide-react'
import { api, type Device } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { toast } from 'sonner'

const devicesQueryOptions = queryOptions({
  queryKey: ['devices'],
  queryFn: async () => {
    const { data, error } = await api.GET('/api/devices')
    if (error) throw new Error('Failed to load devices')
    return data
  },
  refetchInterval: 5000, // Poll for new devices
})

export const Route = createFileRoute('/_library/devices')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(devicesQueryOptions)
  },
  component: DevicesPage,
})

function DevicesPage() {
  const { data: devices } = useSuspenseQuery(devicesQueryOptions)

  // Separate pending devices to show prominently
  const pendingDevices = devices.filter((d) => d.status === 'pending')
  const otherDevices = devices.filter((d) => d.status !== 'pending')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Devices</h1>
      </div>

      {pendingDevices.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-500" />
            Pending Approval
          </h2>
          <div className="space-y-3">
            {pendingDevices.map((device) => (
              <PendingDeviceCard key={device.id} device={device as Device} />
            ))}
          </div>
        </div>
      )}

      {otherDevices.length === 0 && pendingDevices.length === 0 ? (
        <EmptyState />
      ) : otherDevices.length > 0 ? (
        <DevicesTable devices={otherDevices as Device[]} />
      ) : null}
    </div>
  )
}

function PendingDeviceCard({ device }: { device: Device }) {
  const queryClient = useQueryClient()

  const approveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH('/api/devices/{id}', {
        params: { path: { id: device.id.toString() } },
        body: { status: 'approved' },
      })
      if (error) throw new Error('Failed to approve device')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      toast.success(`Device ${device.name || device.mac} approved`)
    },
    onError: () => {
      toast.error('Failed to approve device')
    },
  })

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH('/api/devices/{id}', {
        params: { path: { id: device.id.toString() } },
        body: { status: 'rejected' },
      })
      if (error) throw new Error('Failed to reject device')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      toast.success(`Device ${device.name || device.mac} rejected`)
    },
    onError: () => {
      toast.error('Failed to reject device')
    },
  })

  return (
    <div className="border border-yellow-200 dark:border-yellow-900 bg-yellow-50 dark:bg-yellow-950/30 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 bg-yellow-100 dark:bg-yellow-900/50 rounded-lg flex items-center justify-center">
            <Cpu className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
          </div>
          <div>
            <div className="font-medium">{device.name || 'New Device'}</div>
            <code className="text-sm text-muted-foreground">{device.mac}</code>
            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
              {device.firmwareVersion && (
                <span>Firmware: {device.firmwareVersion}</span>
              )}
              {device.lastIp && (
                <span className="flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  {device.lastIp}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => rejectMutation.mutate()}
            disabled={rejectMutation.isPending || approveMutation.isPending}
          >
            <X className="h-4 w-4 mr-1" />
            Reject
          </Button>
          <Button
            size="sm"
            onClick={() => approveMutation.mutate()}
            disabled={rejectMutation.isPending || approveMutation.isPending}
          >
            <Check className="h-4 w-4 mr-1" />
            Approve
          </Button>
        </div>
      </div>
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
            <th className="px-4 py-3 font-medium w-10"></th>
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
  const [expanded, setExpanded] = useState(false)
  const isOnline = getIsOnline(device.lastSeen)
  const canControl = device.status === 'approved' && isOnline

  return (
    <>
      <tr
        className={`hover:bg-muted/30 transition-colors ${canControl ? 'cursor-pointer' : ''}`}
        onClick={() => canControl && setExpanded(!expanded)}
      >
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
        <td className="px-4 py-3">
          {canControl && (
            expanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )
          )}
        </td>
      </tr>
      {expanded && canControl && (
        <tr>
          <td colSpan={7} className="px-4 py-4 bg-muted/20">
            <DeviceRemoteControl device={device} />
          </td>
        </tr>
      )}
    </>
  )
}

function DeviceRemoteControl({ device }: { device: Device }) {
  const [volume, setVolume] = useState(10)
  const [isPaused, setIsPaused] = useState(false)

  const pauseMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/api/devices/{id}/pause', {
        params: { path: { id: device.id.toString() } },
      })
      if (error) throw new Error('Failed to pause')
    },
    onSuccess: () => {
      setIsPaused(true)
      toast.success('Playback paused')
    },
    onError: () => toast.error('Failed to pause'),
  })

  const resumeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/api/devices/{id}/resume', {
        params: { path: { id: device.id.toString() } },
      })
      if (error) throw new Error('Failed to resume')
    },
    onSuccess: () => {
      setIsPaused(false)
      toast.success('Playback resumed')
    },
    onError: () => toast.error('Failed to resume'),
  })

  const stopMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/api/devices/{id}/stop', {
        params: { path: { id: device.id.toString() } },
      })
      if (error) throw new Error('Failed to stop')
    },
    onSuccess: () => {
      setIsPaused(false)
      toast.success('Playback stopped')
    },
    onError: () => toast.error('Failed to stop'),
  })

  const volumeMutation = useMutation({
    mutationFn: async (level: number) => {
      const { error } = await api.POST('/api/devices/{id}/volume', {
        params: { path: { id: device.id.toString() } },
        body: { level },
      })
      if (error) throw new Error('Failed to set volume')
    },
    onError: () => toast.error('Failed to set volume'),
  })

  const handleVolumeChange = (values: number[]) => {
    const newVolume = values[0]
    setVolume(newVolume)
    volumeMutation.mutate(newVolume)
  }

  const isLoading = pauseMutation.isPending || resumeMutation.isPending || stopMutation.isPending

  return (
    <div className="flex items-center gap-6" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground mr-2">Playback</span>
        {isPaused ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => resumeMutation.mutate()}
            disabled={isLoading}
          >
            <Play className="h-4 w-4 mr-1" />
            Resume
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => pauseMutation.mutate()}
            disabled={isLoading}
          >
            <Pause className="h-4 w-4 mr-1" />
            Pause
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => stopMutation.mutate()}
          disabled={isLoading}
        >
          <Square className="h-4 w-4 mr-1" />
          Stop
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-1 max-w-xs">
        <span className="text-sm font-medium text-muted-foreground">Volume</span>
        {volume === 0 ? (
          <VolumeX className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Volume2 className="h-4 w-4 text-muted-foreground" />
        )}
        <Slider
          value={[volume]}
          onValueChange={handleVolumeChange}
          max={21}
          step={1}
          className="flex-1"
        />
        <span className="text-sm text-muted-foreground w-6 text-right">{volume}</span>
      </div>
    </div>
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
