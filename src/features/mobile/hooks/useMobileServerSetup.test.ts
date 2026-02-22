import { describe, expect, it } from "vitest";
import { normalizeMobileRemoteDrafts } from "./useMobileServerSetup";

describe("normalizeMobileRemoteDrafts", () => {
  it("keeps host and token when already split correctly", () => {
    expect(
      normalizeMobileRemoteDrafts("macbook.tailnet.ts.net:4732", "token-123"),
    ).toEqual({
      host: "macbook.tailnet.ts.net:4732",
      token: "token-123",
      hostWasAutoCorrected: false,
    });
  });

  it("removes a token accidentally appended to the host", () => {
    expect(
      normalizeMobileRemoteDrafts("192.168.24.189:4732testing123", "testing123"),
    ).toEqual({
      host: "192.168.24.189:4732",
      token: "testing123",
      hostWasAutoCorrected: true,
    });
  });

  it("does not strip token text when host already has a valid port", () => {
    expect(normalizeMobileRemoteDrafts("192.168.24.189:4732", "732")).toEqual({
      host: "192.168.24.189:4732",
      token: "732",
      hostWasAutoCorrected: false,
    });
  });

  it("does not trim host text when no port remains after stripping", () => {
    expect(normalizeMobileRemoteDrafts("deskboxtoken", "token")).toEqual({
      host: "deskboxtoken",
      token: "token",
      hostWasAutoCorrected: false,
    });
  });

  it("returns null token when the token draft is blank", () => {
    expect(normalizeMobileRemoteDrafts("192.168.24.189:4732", "   ")).toEqual({
      host: "192.168.24.189:4732",
      token: null,
      hostWasAutoCorrected: false,
    });
  });
});
