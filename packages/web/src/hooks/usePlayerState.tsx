import { createContext, useContext, useEffect, useReducer } from 'react'
import type { ReactNode } from 'react'

export interface PlayerState {
  currentMediaId: number | null
  currentPlaylistId: number | null
  isPlaying: boolean
  volume: number
  queue: Array<number>
  queueIndex: number
}

const DEFAULT_STATE: PlayerState = {
  currentMediaId: null,
  currentPlaylistId: null,
  isPlaying: false,
  volume: 0.8,
  queue: [],
  queueIndex: 0,
}

// Load state from localStorage (called after hydration)
function loadPersistedState(): Partial<PlayerState> | null {
  if (typeof window === 'undefined') return null
  const saved = localStorage.getItem('musicbox-player-state')
  if (saved) {
    try {
      return JSON.parse(saved)
    } catch {
      return null
    }
  }
  return null
}

// Actions
type PlayerAction =
  | {
      type: 'PLAY_MEDIA'
      mediaId: number
      playlistId?: number
    }
  | {
      type: 'PLAY_PLAYLIST'
      playlistId: number
      mediaIds: Array<number>
      startIndex?: number
    }
  | { type: 'TOGGLE_PLAY_PAUSE' }
  | { type: 'SET_VOLUME'; volume: number }
  | { type: 'NEXT' }
  | { type: 'PREVIOUS' }
  | { type: 'CLEAR_PLAYER' }
  | { type: 'HYDRATE'; state: Partial<PlayerState> }

// Reducer
function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'PLAY_MEDIA':
      return {
        ...state,
        currentMediaId: action.mediaId,
        currentPlaylistId: action.playlistId || null,
        isPlaying: true,
        queue: [action.mediaId],
        queueIndex: 0,
      }
    case 'PLAY_PLAYLIST': {
      const startIndex = action.startIndex ?? 0
      return {
        ...state,
        currentPlaylistId: action.playlistId,
        currentMediaId: action.mediaIds[startIndex] || null,
        isPlaying: true,
        queue: action.mediaIds,
        queueIndex: startIndex,
      }
    }
    case 'TOGGLE_PLAY_PAUSE':
      return {
        ...state,
        isPlaying: !state.isPlaying,
      }
    case 'SET_VOLUME':
      return {
        ...state,
        volume: Math.max(0, Math.min(1, action.volume)),
      }
    case 'NEXT':
      if (state.queueIndex < state.queue.length - 1) {
        const newIndex = state.queueIndex + 1
        return {
          ...state,
          currentMediaId: state.queue[newIndex],
          queueIndex: newIndex,
        }
      }
      return state
    case 'PREVIOUS':
      if (state.queueIndex > 0) {
        const newIndex = state.queueIndex - 1
        return {
          ...state,
          currentMediaId: state.queue[newIndex],
          queueIndex: newIndex,
        }
      }
      return state
    case 'CLEAR_PLAYER':
      return {
        ...DEFAULT_STATE,
        volume: state.volume,
      }
    case 'HYDRATE':
      return {
        ...state,
        ...action.state,
        isPlaying: false, // Never auto-play on hydrate
      }
    default:
      return state
  }
}

// Context
interface PlayerContextType {
  state: PlayerState
  playMedia: (mediaId: number, playlistId?: number) => void
  playPlaylist: (
    playlistId: number,
    mediaIds: Array<number>,
    startIndex?: number
  ) => void
  togglePlayPause: () => void
  setVolume: (volume: number) => void
  next: () => void
  previous: () => void
  clearPlayer: () => void
}

const PlayerContext = createContext<PlayerContextType | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(playerReducer, DEFAULT_STATE)

  // Hydrate from localStorage after initial render (avoids SSR mismatch)
  useEffect(() => {
    const persisted = loadPersistedState()
    if (persisted) {
      dispatch({ type: 'HYDRATE', state: persisted })
    }
  }, [])

  // Persist to localStorage on state changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'musicbox-player-state',
        JSON.stringify({
          currentMediaId: state.currentMediaId,
          currentPlaylistId: state.currentPlaylistId,
          volume: state.volume,
          queue: state.queue,
          queueIndex: state.queueIndex,
        })
      )
    }
  }, [
    state.currentMediaId,
    state.currentPlaylistId,
    state.volume,
    state.queue,
    state.queueIndex,
  ])

  const value: PlayerContextType = {
    state,
    playMedia: (mediaId, playlistId) =>
      dispatch({ type: 'PLAY_MEDIA', mediaId, playlistId }),
    playPlaylist: (playlistId, mediaIds, startIndex) =>
      dispatch({
        type: 'PLAY_PLAYLIST',
        playlistId,
        mediaIds,
        startIndex,
      }),
    togglePlayPause: () => dispatch({ type: 'TOGGLE_PLAY_PAUSE' }),
    setVolume: (volume) => dispatch({ type: 'SET_VOLUME', volume }),
    next: () => dispatch({ type: 'NEXT' }),
    previous: () => dispatch({ type: 'PREVIOUS' }),
    clearPlayer: () => dispatch({ type: 'CLEAR_PLAYER' }),
  }

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  )
}

export function usePlayer() {
  const context = useContext(PlayerContext)
  if (!context) {
    throw new Error('usePlayer must be used within PlayerProvider')
  }
  return context
}
