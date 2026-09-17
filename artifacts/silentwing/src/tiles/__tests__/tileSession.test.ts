import { beforeEach, describe, expect, it } from "vitest";
import {
  getTileSessionCount,
  MAX_TILE_SESSIONS,
  requestTileSession,
  resetTileSessionForTests,
} from "../tileSession";

describe("tile session request guard", () => {
  beforeEach(() => {
    resetTileSessionForTests();
  });

  it("starts at zero", () => {
    expect(getTileSessionCount()).toBe(0);
  });

  it("counts successful requests up correctly", () => {
    expect(requestTileSession()).toMatchObject({
      ok: true,
      count: 1,
      limit: MAX_TILE_SESSIONS,
    });
    expect(requestTileSession()).toMatchObject({
      ok: true,
      count: 2,
      limit: MAX_TILE_SESSIONS,
    });
    expect(getTileSessionCount()).toBe(2);
  });

  it("allows exactly 20 requests and refuses the 21st", () => {
    for (let index = 0; index < MAX_TILE_SESSIONS; index += 1) {
      expect(requestTileSession()).toMatchObject({
        ok: true,
        count: index + 1,
      });
    }

    expect(requestTileSession()).toMatchObject({
      ok: false,
      count: MAX_TILE_SESSIONS,
      limit: MAX_TILE_SESSIONS,
    });
    expect(getTileSessionCount()).toBe(MAX_TILE_SESSIONS);
  });

  it("states the reason when the limit refuses a request", () => {
    for (let index = 0; index < MAX_TILE_SESSIONS; index += 1) {
      requestTileSession();
    }

    const refusal = requestTileSession();
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) {
      expect(refusal.reason).toContain("Tile session limit reached");
      expect(refusal.reason).toContain("20");
    }
  });

  it("reset returns the counter to zero", () => {
    requestTileSession();
    requestTileSession();
    resetTileSessionForTests();
    expect(getTileSessionCount()).toBe(0);
  });
});