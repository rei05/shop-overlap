import { describe, expect, it } from "vitest";

import { apiUrl } from "../api-url";

describe("apiUrl", () => {
  it("uses a same-origin relative path when no development override is supplied", () => {
    expect(apiUrl("/api/search", "")).toBe("/api/search");
  });

  it("can target a separately running local Worker", () => {
    expect(apiUrl("/api/search", "http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787/api/search");
  });
});
