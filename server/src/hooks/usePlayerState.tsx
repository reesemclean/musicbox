import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  type ReactNode,
} from 'react'

export interface PlayerState {
  currentSongId: number | null
  currentPlaylistId: number | null
  isPlaying: boolean
  volume: number
  queue: Array<number>
  queueIndex: number
}

const DEFAULT_STATE: PlayerState = {
  currentSongId: null,
  currentPlaylistId: null,
  isPlaying: false,
  volume: 0.8,
  queue: [],
  queueIndex: 0,
}

// Load initial state from localStorage
function getInitialState(): PlayerState {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('music-player-state')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        return {
          ...DEFAULT_STATE,
          ...parsed,
          isPlaying: false, // Never auto-play on load
        }
      } catch {
        // Fall through to default
      }
    }
  }
  return DEFAULT_STATE
}

// Actions
type PlayerAction =
  | { type: 'PLAY_SONG'; songId: number; playlistId?: number }
  | {
      type: 'PLAY_PLAYLIST'
      playlistId: number
      songIds: Array<number>
      startIndex?: number
    }
  | { type: 'TOGGLE_PLAY_PAUSE' }
  | { type: 'SET_VOLUME'; volume: number }
  | { type: 'NEXT_SONG' }
  | { type: 'PREVIOUS_SONG' }
  | { type: 'CLEAR_PLAYER' }

// Reducer
function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  let newState: PlayerState
  switch (action.type) {
    case 'PLAY_SONG':
      newState = {
        ...state,
        currentSongId: action.songId,
        currentPlaylistId: action.playlistId || null,
        isPlaying: true,
        queue: [action.songId],
        queueIndex: 0,
      }
      break
    case 'PLAY_PLAYLIST':
      newState = {
        ...state,
        currentPlaylistId: action.playlistId,
        currentSongId: action.songIds[action.startIndex ?? 0] || null,
        isPlaying: true,
        queue: action.songIds,
        queueIndex: action.startIndex ?? 0,
      }
      break
    case 'TOGGLE_PLAY_PAUSE':
      newState = {
        ...state,
        isPlaying: !state.isPlaying,
      }
      break
    case 'SET_VOLUME':
      newState = {
        ...state,
        volume: Math.max(0, Math.min(1, action.volume)),
      }
      break
    case 'NEXT_SONG':
      if (state.queueIndex < state.queue.length - 1) {
        const newIndex = state.queueIndex + 1
        newState = {
          ...state,
          currentSongId: state.queue[newIndex],
          queueIndex: newIndex,
        }
      } else {
        newState = state
      }
      break
    case 'PREVIOUS_SONG':
      if (state.queueIndex > 0) {
        const newIndex = state.queueIndex - 1
        newState = {
          ...state,
          currentSongId: state.queue[newIndex],
          queueIndex: newIndex,
        }
      } else {
        newState = state
      }
      break
    case 'CLEAR_PLAYER':
      newState = {
        ...DEFAULT_STATE,
        volume: state.volume,
      }
      break
    default:
      newState = state
  }

  return newState
}

// Context
interface PlayerContextType {
  state: PlayerState
  playSong: (songId: number, playlistId?: number) => void
  playPlaylist: (
    playlistId: number,
    songIds: Array<number>,
    startIndex?: number,
  ) => void
  togglePlayPause: () => void
  setVolume: (volume: number) => void
  nextSong: () => void
  previousSong: () => void
  clearPlayer: () => void
}

const PlayerContext = createContext<PlayerContextType | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    playerReducer,
    undefined,
    getInitialState,
  )

  // Persist to localStorage on state changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'music-player-state',
        JSON.stringify({
          currentSongId: state.currentSongId,
          currentPlaylistId: state.currentPlaylistId,
          volume: state.volume,
          queue: state.queue,
          queueIndex: state.queueIndex,
        }),
      )
    }
  }, [
    state.currentSongId,
    state.currentPlaylistId,
    state.volume,
    state.queue,
    state.queueIndex,
  ])

  const value: PlayerContextType = {
    state,
    playSong: (songId, playlistId) =>
      dispatch({ type: 'PLAY_SONG', songId, playlistId }),
    playPlaylist: (playlistId, songIds, startIndex) =>
      dispatch({ type: 'PLAY_PLAYLIST', playlistId, songIds, startIndex }),
    togglePlayPause: () => dispatch({ type: 'TOGGLE_PLAY_PAUSE' }),
    setVolume: (volume) => dispatch({ type: 'SET_VOLUME', volume }),
    nextSong: () => dispatch({ type: 'NEXT_SONG' }),
    previousSong: () => dispatch({ type: 'PREVIOUS_SONG' }),
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
