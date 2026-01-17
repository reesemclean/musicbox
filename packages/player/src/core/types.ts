/**
 * Internal type definitions for the Player Core
 */

export interface SongInfo {
  id: number;
  title: string;
  artist?: string | null;
  streamUrl: string;
}

export interface PlayerStatus {
  currentSong: SongInfo | null;
  isPlaying: boolean;
  playlistPosition: string | null;
}
