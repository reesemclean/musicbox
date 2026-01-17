import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import {
  AlertCircle,
  Check,
  Clock,
  Download,
  MoreVertical,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Smartphone,
  Square,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  approveDevice,
  createDevice,
  getDevices,
  getPendingDevices,
  rejectDevice,
  sendDeviceCommand,
  triggerDeviceUpdate,
} from '@/services/serverFunctions'

const devicesQueryOptions = queryOptions({
  queryKey: ['devices'],
  queryFn: getDevices,
  refetchInterval: 5000, // Refresh every 5s for status updates
})

const pendingDevicesQueryOptions = queryOptions({
  queryKey: ['pendingDevices'],
  queryFn: getPendingDevices,
  refetchInterval: 5000, // Refresh every 5s for new registrations
})

export const Route = createFileRoute('/_library/devices')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(devicesQueryOptions),
      context.queryClient.ensureQueryData(pendingDevicesQueryOptions),
    ])
  },
  component: DevicesPage,
})

function DevicesPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newDeviceName, setNewDeviceName] = useState('')
  const [createdDevice, setCreatedDevice] = useState<any>(null)
  const [approvalName, setApprovalName] = useState('')
  const [approvingDeviceId, setApprovingDeviceId] = useState<number | null>(
    null,
  )

  const { data: devices } = useSuspenseQuery(devicesQueryOptions)
  const { data: pendingDevices } = useQuery(pendingDevicesQueryOptions)
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: createDevice,
    onSuccess: (result) => {
      setCreatedDevice(result)
      setNewDeviceName('')
      queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
  })

  const commandMutation = useMutation({
    mutationFn: sendDeviceCommand,
    onSuccess: () => {
      // Optionally show success message
    },
    onError: (error: any) => {
      console.error('Failed to send command:', error)
      alert('Failed to send command: ' + error.message)
    },
  })

  const approveMutation = useMutation({
    mutationFn: approveDevice,
    onSuccess: () => {
      setApprovingDeviceId(null)
      setApprovalName('')
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      queryClient.invalidateQueries({ queryKey: ['pendingDevices'] })
    },
    onError: (error: any) => {
      console.error('Failed to approve device:', error)
      alert('Failed to approve device: ' + error.message)
    },
  })

  const rejectMutation = useMutation({
    mutationFn: rejectDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingDevices'] })
    },
    onError: (error: any) => {
      console.error('Failed to reject device:', error)
      alert('Failed to reject device: ' + error.message)
    },
  })

  const handleCreateDevice = () => {
    if (newDeviceName.trim()) {
      createMutation.mutate({ data: { name: newDeviceName.trim() } })
    }
  }

  const sendCommand = (
    deviceId: number,
    command: 'play' | 'pause' | 'next' | 'previous' | 'stop',
  ) => {
    commandMutation.mutate({ data: { deviceId, command } })
  }

  const handleApprove = (deviceId: number) => {
    if (approvalName.trim()) {
      approveMutation.mutate({ data: { deviceId, name: approvalName.trim() } })
    }
  }

  const handleReject = (deviceId: number) => {
    if (confirm('Are you sure you want to reject this device?')) {
      rejectMutation.mutate({ data: { deviceId } })
    }
  }

  const handleTriggerUpdate = async (deviceId: number) => {
    try {
      await triggerDeviceUpdate({ data: { deviceId } })
      alert('Update triggered successfully')
    } catch (error) {
      alert(
        `Failed to trigger update: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  const downloadConfig = (deviceId: number, closeDialog = false) => {
    window.open(`/api/devices/${deviceId}/config`, '_blank')
    if (closeDialog) {
      setCreateDialogOpen(false)
      setCreatedDevice(null)
    }
  }

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'online':
        return 'text-green-500'
      case 'offline':
        return 'text-red-500'
      case 'inactive':
        return 'text-gray-400'
      default:
        return 'text-gray-400'
    }
  }

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'online':
        return '🟢'
      case 'offline':
        return '🔴'
      case 'inactive':
        return '⚪'
      default:
        return '⚪'
    }
  }

  return (
    <div className="p-6 pb-32">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Devices</h1>
          <p className="text-muted-foreground mt-1">
            {devices.length} {devices.length === 1 ? 'device' : 'devices'} •
            Manage Raspberry Pi players and control playback remotely
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Device
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Device</DialogTitle>
              <DialogDescription>
                Create a device configuration for a new Raspberry Pi player
              </DialogDescription>
            </DialogHeader>
            {!createdDevice ? (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="deviceName">Device Name</Label>
                  <Input
                    id="deviceName"
                    value={newDeviceName}
                    onChange={(e) => setNewDeviceName(e.target.value)}
                    placeholder="living-room"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newDeviceName.trim()) {
                        handleCreateDevice()
                      }
                    }}
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    Use a descriptive name like "living-room" or "bedroom"
                  </p>
                </div>
                <Button
                  onClick={handleCreateDevice}
                  disabled={createMutation.isPending || !newDeviceName.trim()}
                  className="w-full"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Device'}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                  <p className="text-green-800 dark:text-green-200 font-medium">
                    Device created successfully!
                  </p>
                </div>
                <p className="text-sm">
                  Download the configuration file and deploy it to your
                  Raspberry Pi at:
                </p>
                <code className="block p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm">
                  /etc/musicbox/player.config.json
                </code>
                <Button
                  onClick={() => downloadConfig(createdDevice.device.id, true)}
                  className="w-full"
                >
                  Download {createdDevice.device.name}.config.json
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Pending Devices Section */}
      {pendingDevices && pendingDevices.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <h2 className="text-xl font-semibold">
              Pending Approval ({pendingDevices.length})
            </h2>
          </div>
          <div className="space-y-3">
            {pendingDevices.map((device) => (
              <div
                key={device.id}
                className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 rounded-lg p-4"
              >
                {approvingDeviceId === device.id ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                      <Clock className="h-4 w-4" />
                      <span className="font-medium">Approve Device</span>
                    </div>
                    <div className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                      <p>
                        <span className="font-medium">Hardware ID:</span>{' '}
                        {device.hardwareId}
                      </p>
                      <p>
                        <span className="font-medium">Hostname:</span>{' '}
                        {device.hostname || 'unknown'}
                      </p>
                      <p>
                        <span className="font-medium">Registered:</span>{' '}
                        {device.createdAt
                          ? new Date(device.createdAt).toLocaleString()
                          : 'unknown'}
                      </p>
                    </div>
                    <div>
                      <Label htmlFor={`name-${device.id}`}>Device Name</Label>
                      <Input
                        id={`name-${device.id}`}
                        value={approvalName}
                        onChange={(e) => setApprovalName(e.target.value)}
                        placeholder="living-room"
                        className="mt-1"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleApprove(device.id)}
                        disabled={
                          approveMutation.isPending || !approvalName.trim()
                        }
                        className="flex-1"
                      >
                        <Check className="h-4 w-4 mr-2" />
                        {approveMutation.isPending ? 'Approving...' : 'Approve'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setApprovingDeviceId(null)
                          setApprovalName('')
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                        <Clock className="h-4 w-4" />
                        <span className="font-medium">New Device</span>
                      </div>
                      <div className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                        <span className="font-mono">
                          {device.hardwareId?.slice(-12) || 'unknown'}
                        </span>
                        {device.hostname && <span> • {device.hostname}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          setApprovingDeviceId(device.id)
                          setApprovalName(device.hostname || '')
                        }}
                      >
                        <Check className="h-4 w-4 mr-2" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleReject(device.id)}
                        disabled={rejectMutation.isPending}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approved Devices Section */}
      {devices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Smartphone className="h-16 w-16 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No devices yet</h3>
          <p className="text-muted-foreground mb-4">
            Create your first device to start controlling players
          </p>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Device
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {devices.map((device) => {
            let currentSongData = null
            try {
              if (device.currentSong) {
                currentSongData = JSON.parse(device.currentSong)
              }
            } catch (e) {
              // Ignore parse errors
            }

            return (
              <div
                key={device.id}
                className="border rounded-lg p-6 flex items-start justify-between gap-6"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl">
                      {getStatusIcon(device.status)}
                    </span>
                    <div>
                      <h3 className="text-xl font-semibold">{device.name}</h3>
                      <span
                        className={`text-sm ${getStatusColor(device.status)}`}
                      >
                        {device.status}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1 text-sm text-muted-foreground">
                    {device.ipAddress ? (
                      <p>
                        <span className="font-medium">Address:</span>{' '}
                        {device.ipAddress}:{device.httpPort || 8080}
                      </p>
                    ) : (
                      <p className="text-gray-400">
                        Waiting for first heartbeat...
                      </p>
                    )}

                    {device.lastSeen && (
                      <p>
                        <span className="font-medium">Last seen:</span>{' '}
                        {new Date(device.lastSeen).toLocaleString()}
                      </p>
                    )}

                    {currentSongData && (
                      <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                        <p className="font-medium text-blue-900 dark:text-blue-200">
                          {currentSongData.isPlaying
                            ? '▶️ Playing'
                            : '⏸️ Paused'}
                        </p>
                        <p className="text-blue-800 dark:text-blue-300 truncate">
                          {currentSongData.title}
                          {currentSongData.artist && (
                            <span className="text-blue-600 dark:text-blue-400">
                              {' '}
                              • {currentSongData.artist}
                            </span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 flex-shrink-0">
                  {device.status === 'online' && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendCommand(device.id, 'play')}
                        disabled={commandMutation.isPending}
                        title="Play"
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendCommand(device.id, 'pause')}
                        disabled={commandMutation.isPending}
                        title="Pause"
                      >
                        <Pause className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendCommand(device.id, 'previous')}
                        disabled={commandMutation.isPending}
                        title="Previous"
                      >
                        <SkipBack className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendCommand(device.id, 'next')}
                        disabled={commandMutation.isPending}
                        title="Next"
                      >
                        <SkipForward className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => sendCommand(device.id, 'stop')}
                        disabled={commandMutation.isPending}
                        title="Stop"
                      >
                        <Square className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => handleTriggerUpdate(device.id)}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Trigger Update
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => downloadConfig(device.id)}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download Config
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
