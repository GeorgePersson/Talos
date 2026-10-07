import { test, expect } from "@playwright/test";
import { addressURL } from "../src/url";

test("address bar distinguishes searches, search operators and website addresses", () => {
  for (const query of [
    "qa designers",
    "site:example.com login",
    "filetype:pdf QA",
    "example.com login guide",
  ]) {
    const result = new URL(addressURL(query));
    expect(result.hostname).toBe("duckduckgo.com");
    expect(result.searchParams.get("q")).toBe(query);
  }
  expect(addressURL("localhost:3000")).toBe("http://localhost:3000/");
  expect(addressURL("example.com/test")).toBe("https://example.com/test");
  expect(addressURL("https://example.com/?q=QA design")).toBe(
    "https://example.com/?q=QA%20design",
  );
  for (const address of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:secret@example.com",
  ])
    expect(() => addressURL(address)).toThrow();
});
