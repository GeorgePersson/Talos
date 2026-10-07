/** Remote tabs accept web URLs only. This also blocks local files and privileged schemes. */
export function normalizeURL(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "about:blank") return "about:blank";
  if (trimmed.length > 8192) throw new Error("This address is too long.");
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
  const localHostWithPort =
    /^(localhost|[\w.-]+\.[\w.-]+|\d{1,3}(?:\.\d{1,3}){3}):\d+(?:[/?#]|$)/i.test(
      trimmed,
    );
  const candidate =
    hasScheme && !localHostWithPort
      ? trimmed
      : /^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(trimmed)
        ? `http://${trimmed}`
        : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Enter a valid website address.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Use an HTTP or HTTPS address without embedded credentials.",
    );
  }
  return url.href;
}
export function isWebURL(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export function addressURL(input: string): string {
  const value = input.trim();
  const searchOperator = /^(site|inurl|intitle|filetype|before|after):/i.test(
    value,
  );
  if (
    value &&
    (searchOperator ||
      (!/^[a-z][a-z\d+.-]*:/i.test(value) &&
        !/^(localhost|\[::1\]|[^\s/]+\.[^\s/]+)(?:[:/?#]|$)/i.test(value)))
  ) {
    if (value.length > 8192) throw new Error("This search is too long.");
    return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
  }
  return normalizeURL(value);
}
/** Do not persist callback tokens or fragment state in the saved workspace. */
export function savedURL(value: string): string {
  if (!isWebURL(value)) return "about:blank";
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.href;
}
