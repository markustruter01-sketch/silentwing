export const MAX_TILE_SESSIONS = 20;

type TileSessionResult =
  | {
      ok: true;
      count: number;
      limit: number;
    }
  | {
      ok: false;
      count: number;
      limit: number;
      reason: string;
    };

let tileSessionCount = 0;

export function requestTileSession(): TileSessionResult {
  if (tileSessionCount >= MAX_TILE_SESSIONS) {
    return {
      ok: false,
      count: tileSessionCount,
      limit: MAX_TILE_SESSIONS,
      reason: `Tile session limit reached: ${MAX_TILE_SESSIONS} requests maximum per session.`,
    };
  }

  tileSessionCount += 1;
  return {
    ok: true,
    count: tileSessionCount,
    limit: MAX_TILE_SESSIONS,
  };
}

export function getTileSessionCount(): number {
  return tileSessionCount;
}

export function resetTileSessionForTests(): void {
  tileSessionCount = 0;
}