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
  ChevronDown,
  Clock,
  Download,
  Loader2,
  MoreVertical,
  Music,
  Pause,
  Play,
  Rocket,
  SkipBack,
  SkipForward,
  Smartphone,
  Square,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  approveDevice,
  cancelDeployment,
  deleteDevice,
  getDeploymentRuns,
  getDeviceSoundMachineSetting,
  getDevices,
  getPendingDevices,
  getSoundMachineSounds,
  rejectDevice,
  sendDeviceCommand,
  triggerDeployment,
  updateDeviceSoundMachineSetting,
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

const deploymentRunsQueryOptions = queryOptions({
  queryKey: ['deploymentRuns'],
  queryFn: () => getDeploymentRuns({ data: { limit: 10 } }),
  refetchInterval: 5000, // Refresh every 5s during deployments
})

export const Route = createFileRoute('/_library/devices')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(devicesQueryOptions),
      context.queryClient.ensureQueryData(pendingDevicesQueryOptions),
      context.queryClient.ensureQueryData(deploymentRunsQueryOptions),
    ])
  },
  component: DevicesPage,
})

function DevicesPage() {
  const [approvalName, setApprovalName] = useState('')
  const [approvingDeviceId, setApprovingDeviceId] = useState<number | null>(
    null,
  )
  const [showDeploymentHistory, setShowDeploymentHistory] = useState(false)
  const [soundMachineDialogDeviceId, setSoundMachineDialogDeviceId] = useState<
    number | null
  >(null)
  const [selectedSoundName, setSelectedSoundName] = useState<string | null>(
    null,
  )

  const { data: devices } = useSuspenseQuery(devicesQueryOptions)
  const { data: pendingDevices } = useQuery(pendingDevicesQueryOptions)
  const { data: deploymentRunsData } = useQuery(deploymentRunsQueryOptions)
  const queryClient = useQueryClient()

  // Sound machine queries
  const { data: soundMachineSounds } = useQuery({
    queryKey: ['soundMachineSounds'],
    queryFn: getSoundMachineSounds,
  })

  const { data: deviceSoundSetting, isLoading: isLoadingDeviceSoundSetting } =
    useQuery({
      queryKey: ['deviceSoundMachineSetting', soundMachineDialogDeviceId],
      queryFn: () =>
        soundMachineDialogDeviceId
          ? getDeviceSoundMachineSetting({
              data: { deviceId: soundMachineDialogDeviceId },
            })
          : null,
      enabled: soundMachineDialogDeviceId !== null,
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

  const deleteMutation = useMutation({
    mutationFn: deleteDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      queryClient.invalidateQueries({ queryKey: ['pendingDevices'] })
    },
    onError: (error: any) => {
      console.error('Failed to delete device:', error)
      alert('Failed to delete device: ' + error.message)
    },
  })

  const deployMutation = useMutation({
    mutationFn: triggerDeployment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      queryClient.invalidateQueries({ queryKey: ['deploymentRuns'] })
    },
    onError: (error: any) => {
      console.error('Failed to trigger deployment:', error)
      alert('Failed to trigger deployment: ' + error.message)
    },
  })

  const cancelMutation = useMutation({
    mutationFn: cancelDeployment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      queryClient.invalidateQueries({ queryKey: ['deploymentRuns'] })
    },
    onError: (error: any) => {
      console.error('Failed to cancel deployment:', error)
      alert('Failed to cancel deployment: ' + error.message)
    },
  })

  const soundMachineMutation = useMutation({
    mutationFn: updateDeviceSoundMachineSetting,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['deviceSoundMachineSetting', soundMachineDialogDeviceId],
      })
      setSoundMachineDialogDeviceId(null)
      setSelectedSoundName(null)
    },
    onError: (error: any) => {
      console.error('Failed to update sound machine setting:', error)
      alert('Failed to update sound machine setting: ' + error.message)
    },
  })

  const handleCancelDeployment = (runId: number) => {
    if (confirm('Are you sure you want to cancel this deployment?')) {
      cancelMutation.mutate({ data: { runId } })
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

  const handleDelete = (deviceId: number, deviceName: string) => {
    if (
      confirm(
        `Are you sure you want to delete "${deviceName}"? This cannot be undone. The device will need to re-register if reflashed.`,
      )
    ) {
      deleteMutation.mutate({ data: { deviceId } })
    }
  }

  const handleDeploy = (
    deviceId?: number,
    playbook: 'site' | 'deploy-player' | 'sync-config' = 'site',
  ) => {
    deployMutation.mutate({ data: { deviceId, playbook } })
  }

  const handleOpenSoundMachineSettings = (deviceId: number) => {
    setSoundMachineDialogDeviceId(deviceId)
    setSelectedSoundName(null) // Reset selection when opening
  }

  const handleSaveSoundMachineSetting = () => {
    if (soundMachineDialogDeviceId === null) return

    const soundName = selectedSoundName ?? deviceSoundSetting?.soundName ?? null
    soundMachineMutation.mutate({
      data: { deviceId: soundMachineDialogDeviceId, soundName },
    })
  }

  const getDeploymentStatusBadge = (status?: string | null) => {
    switch (status) {
      case 'pending':
        return (
          <span className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
            Pending
          </span>
        )
      case 'deploying':
        return (
          <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Deploying
          </span>
        )
      case 'success':
        return (
          <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            Deployed
          </span>
        )
      case 'failed':
        return (
          <span className="text-xs px-2 py-1 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
            Failed
          </span>
        )
      default:
        return null
    }
  }

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'online':
        return 'text-green-500'
      case 'offline':
        return 'text-red-500'
      case 'pending_setup':
        return 'text-amber-500'
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
      case 'pending_setup':
        return '🟡'
      case 'inactive':
        return '⚪'
      default:
        return '⚪'
    }
  }

  const getStatusLabel = (status?: string) => {
    switch (status) {
      case 'online':
        return 'Online'
      case 'offline':
        return 'Offline'
      case 'pending_setup':
        return 'Pending Setup'
      case 'inactive':
        return 'Inactive'
      default:
        return status || 'Unknown'
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
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={deployMutation.isPending || devices.length === 0}
              >
                {deployMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deploying...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4 mr-2" />
                    Deploy All
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleDeploy(undefined, 'site')}>
                <Rocket className="h-4 w-4 mr-2" />
                Full Setup
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleDeploy(undefined, 'deploy-player')}
              >
                <Download className="h-4 w-4 mr-2" />
                Deploy Player Only
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleDeploy(undefined, 'sync-config')}
              >
                <Download className="h-4 w-4 mr-2" />
                Sync Config Only
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            onClick={() => setShowDeploymentHistory(!showDeploymentHistory)}
          >
            History
          </Button>
        </div>
      </div>

      {/* Deployment History Section */}
      {showDeploymentHistory && deploymentRunsData?.runs && (
        <div className="mb-8 border rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4">Deployment History</h2>
          {deploymentRunsData.runs.length === 0 ? (
            <p className="text-muted-foreground">No deployments yet</p>
          ) : (
            <div className="space-y-2">
              {deploymentRunsData.runs.map((run: any) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm">#{run.id}</span>
                    <span className="text-sm">{run.playbook}</span>
                    {run.deviceId ? (
                      <span className="text-xs text-muted-foreground">
                        Device #{run.deviceId}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        All devices
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {getDeploymentStatusBadge(run.status)}
                    {(run.status === 'queued' || run.status === 'running') && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCancelDeployment(run.id)}
                        disabled={cancelMutation.isPending}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    )}
                    {run.startedAt && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(run.startedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
          <p className="text-muted-foreground max-w-md">
            Flash a Raspberry Pi with the MusicBox image and power it on. It
            will automatically register here for approval.
          </p>
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
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-semibold">{device.name}</h3>
                        {(device as any).deploymentStatus &&
                          getDeploymentStatusBadge(
                            (device as any).deploymentStatus,
                          )}
                      </div>
                      <span
                        className={`text-sm ${getStatusColor(device.status)}`}
                      >
                        {getStatusLabel(device.status)}
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

                <div className="flex gap-2 shrink-0">
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
                        onClick={() => handleOpenSoundMachineSettings(device.id)}
                      >
                        <Music className="h-4 w-4 mr-2" />
                        Sound Machine Settings
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleDeploy(device.id, 'site')}
                        disabled={deployMutation.isPending}
                      >
                        <Rocket className="h-4 w-4 mr-2" />
                        Deploy (Full Setup)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDeploy(device.id, 'deploy-player')}
                        disabled={deployMutation.isPending}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Deploy Player Only
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDeploy(device.id, 'sync-config')}
                        disabled={deployMutation.isPending}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Sync Config Only
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleDelete(device.id, device.name)}
                        disabled={deleteMutation.isPending}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Device
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Sound Machine Settings Dialog */}
      <Dialog
        open={soundMachineDialogDeviceId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSoundMachineDialogDeviceId(null)
            setSelectedSoundName(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sound Machine Settings</DialogTitle>
            <DialogDescription>
              Configure the white noise sound that plays when holding the play
              button for 3 seconds.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {isLoadingDeviceSoundSetting ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sound-select">Sound</Label>
                  <Select
                    value={
                      selectedSoundName ??
                      deviceSoundSetting?.soundName ??
                      undefined
                    }
                    onValueChange={setSelectedSoundName}
                  >
                    <SelectTrigger id="sound-select" className="w-full">
                      <SelectValue placeholder="Select a sound..." />
                    </SelectTrigger>
                    <SelectContent>
                      {soundMachineSounds && soundMachineSounds.length > 0 ? (
                        soundMachineSounds.map((sound) => (
                          <SelectItem key={sound.name} value={sound.name}>
                            {sound.name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="_none" disabled>
                          No sounds available
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    Sounds are stored in the server's assets/soundmachine folder.
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSoundMachineDialogDeviceId(null)
                setSelectedSoundName(null)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveSoundMachineSetting}
              disabled={soundMachineMutation.isPending}
            >
              {soundMachineMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
