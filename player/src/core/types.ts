/**
 * Internal type definitions for the Player Core
 */

export interface SongInfo {
  id: number;
  title: string;
  artist?: string | null;
  streamUrl: string;
}

export interface PlayerState {
  currentSong: SongInfo | null;
  playlist: SongInfo[];
  playlistIndex: number;
  isPlaying: boolean;
}

export interface PlayerStatus {
  currentSong: SongInfo | null;
  isPlaying: boolean;
  playlistPosition: string | null;
}

export interface SongMetadata {
  title: string;
  artist?: string | null;
}
