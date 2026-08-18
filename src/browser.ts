import { spawn } from "node:child_process";

/** Hands a URL to the OS's default browser. Best-effort by design. */
export function openBrowser(url: string): boolean {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    const child = spawn(opener, [url], { stdio: "ignore", detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
