import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { Cpu, Wifi, WifiOff, Clock, Globe, CheckCircle2, XCircle, AlertCircle, Check, X, Pause, Play, Square, Volume2, VolumeX, ChevronDown, ChevronUp, Music, Moon, Download } from 'lucide-react'
import { api, type Device } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

// Sound machine sounds query
const soundsQueryOptions = queryOptions({
  queryKey: ['soundmachine-sounds'],
  queryFn: async () => {
    const { data, error } = await api.GET('/api/soundmachine/sounds')
    if (error) throw new Error('Failed to load sounds')
    return data
  },
})

// Firmware info query
const firmwareQueryOptions = queryOptions({
  queryKey: ['firmware-latest'],
  queryFn: async () => {
    const { data, error } = await api.GET('/api/firmware/latest')
    if (error) return null // No firmware available is ok
    return data
  },
})

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
    await Promise.all([
      context.queryClient.ensureQueryData(devicesQueryOptions),
      context.queryClient.ensureQueryData(soundsQueryOptions),
      context.queryClient.ensureQueryData(firmwareQueryOptions),
    ])
  },
  component: DevicesPage,
})

function DevicesPage() {
  const queryClient = useQueryClient()
  const { data: devices } = useSuspenseQuery(devicesQueryOptions)

  // Listen for playback status updates via WebSocket - triggers refetch
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    const wsUrl = apiUrl.replace(/^http/, 'ws') + '/ws/control'
    let reconnectTimeout: ReturnType<typeof setTimeout>
    let mounted = true
    let ws: WebSocket | null = null

    const connect = () => {
      if (!mounted) return

      ws = new WebSocket(wsUrl)

      ws.onmessage = (event) => {
        if (!mounted) return
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'playback_status') {
            // Refetch devices to get updated playback status
            queryClient.invalidateQueries({ queryKey: ['devices'] })
          }
        } catch {
          // Ignore non-JSON messages
        }
      }

      ws.onclose = () => {
        if (mounted) {
          reconnectTimeout = setTimeout(connect, 3000)
        }
      }

      ws.onerror = () => {
        ws?.close()
      }
    }

    connect()

    return () => {
      mounted = false
      clearTimeout(reconnectTimeout)
      if (ws) {
        ws.onclose = null
        ws.close()
      }
    }
  }, [queryClient])

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
  const playback = device.playback
  const isPlaying = playback?.status === 'playing'

  return (
    <>
      <tr
        className={`hover:bg-muted/30 transition-colors ${canControl ? 'cursor-pointer' : ''}`}
        onClick={() => canControl && setExpanded(!expanded)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded flex items-center justify-center ${isPlaying ? 'bg-green-100 dark:bg-green-900/30' : 'bg-muted'}`}>
              {isPlaying ? (
                <Music className="h-5 w-5 text-green-600 dark:text-green-400" />
              ) : (
                <Cpu className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div>
              <span className="font-medium block">{device.name || 'Unnamed Device'}</span>
              <code className="text-xs text-muted-foreground">{device.mac}</code>
              {playback && playback.status !== 'stopped' && playback.status !== 'finished' && (
                <span className="text-xs text-muted-foreground ml-2">
                  ({playback.status}{playback.mediaTitle ? `: ${playback.mediaTitle}` : ''})
                </span>
              )}
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
  const queryClient = useQueryClient()
  const [volume, setVolume] = useState(10)
  const playback = device.playback
  const isPaused = playback?.status === 'paused'
  const isPlaying = playback?.status === 'playing'

  // Fetch available sound machine sounds (use useQuery to avoid suspense flash)
  const { data: sounds } = useQuery(soundsQueryOptions)

  // Fetch firmware info
  const { data: firmware } = useQuery(firmwareQueryOptions)

  const [soundMachineVolume, setSoundMachineVolume] = useState(device.soundMachineVolume ?? 10)

  // Check if update is available
  const updateAvailable = firmware && device.firmwareVersion && firmware.version !== device.firmwareVersion

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/api/devices/{id}/update', {
        params: { path: { id: device.id.toString() } },
      })
      if (error) throw new Error('Failed to trigger update')
    },
    onSuccess: () => {
      toast.success('Firmware update started')
    },
    onError: () => toast.error('Failed to trigger update'),
  })

  const soundMachineMutation = useMutation({
    mutationFn: async (update: { soundId?: string | null; volume?: number | null }) => {
      const body: { soundMachineSound?: string | null; soundMachineVolume?: number | null } = {}
      if (update.soundId !== undefined) body.soundMachineSound = update.soundId
      if (update.volume !== undefined) body.soundMachineVolume = update.volume
      const { error } = await api.PATCH('/api/devices/{id}', {
        params: { path: { id: device.id.toString() } },
        body,
      })
      if (error) throw new Error('Failed to update sound machine setting')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: () => toast.error('Failed to update sound machine setting'),
  })

  const handleSoundMachineVolumeChange = (values: number[]) => {
    const newVolume = values[0]
    setSoundMachineVolume(newVolume)
    soundMachineMutation.mutate({ volume: newVolume })
  }

  const pauseMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/api/devices/{id}/pause', {
        params: { path: { id: device.id.toString() } },
      })
      if (error) throw new Error('Failed to pause')
    },
    onSuccess: () => {
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

  // Track if update was triggered (persists across re-renders during OTA)
  const [updateTriggered, setUpdateTriggered] = useState(false)
  const [targetVersion, setTargetVersion] = useState<string | null>(null)

  // Reset updateTriggered when device version matches target (update complete)
  useEffect(() => {
    if (updateTriggered && targetVersion && device.firmwareVersion === targetVersion) {
      setUpdateTriggered(false)
      setTargetVersion(null)
      toast.success('Firmware update complete!')
    }
  }, [updateTriggered, targetVersion, device.firmwareVersion])

  const isLoading = pauseMutation.isPending || resumeMutation.isPending || stopMutation.isPending || updateTriggered

  const handleUpdate = () => {
    setUpdateTriggered(true)
    setTargetVersion(firmware?.version ?? null)
    updateMutation.mutate()
  }

  return (
    <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
      {/* Playback Controls */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Playback</h4>

        {/* Status indicator */}
        {playback && (
          <div className="flex items-center gap-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-green-500 animate-pulse' : isPaused ? 'bg-yellow-500' : 'bg-gray-400'}`} />
            <span>
              {isPlaying ? 'Playing' : isPaused ? 'Paused' : playback.status}
              {playback.mediaTitle ? ` - ${playback.mediaTitle}` : ''}
            </span>
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
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

          {/* Volume */}
          <div className="flex items-center gap-2">
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
              className="w-24"
              disabled={updateTriggered}
            />
            <span className="text-sm text-muted-foreground w-5">{volume}</span>
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Settings</h4>

        {/* Sound Machine */}
        <div className="flex items-center gap-3">
          <Moon className="h-4 w-4 text-muted-foreground" />
          <Select
            value={device.soundMachineSound || 'none'}
            onValueChange={(value) => soundMachineMutation.mutate({ soundId: value === 'none' ? null : value })}
            disabled={soundMachineMutation.isPending || updateTriggered}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Sound machine..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {sounds?.map((sound) => (
                <SelectItem key={sound.id} value={sound.id.toString()}>
                  {sound.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {device.soundMachineSound && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Vol</span>
              <Slider
                value={[soundMachineVolume]}
                onValueChange={handleSoundMachineVolumeChange}
                max={21}
                step={1}
                className="w-16"
                disabled={updateTriggered}
              />
              <span className="text-xs text-muted-foreground w-4">{soundMachineVolume}</span>
            </div>
          )}
        </div>

        {/* Firmware */}
        <div className="flex items-center gap-3">
          <Download className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">v{device.firmwareVersion || '?'}</span>
          {firmware && updateAvailable && !updateTriggered ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleUpdate}
            >
              Update to v{firmware.version}
            </Button>
          ) : updateTriggered ? (
            <span className="text-xs text-yellow-600 dark:text-yellow-400">Update in progress...</span>
          ) : (
            <span className="text-xs text-green-600 dark:text-green-400">Up to date</span>
          )}
        </div>
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
