/**
 * Every downloadable file in this app is named `{username}_{timestamp}.{ext}`
 * (see CLAUDE.md — "Download file naming"). Use this for any new export/download
 * feature instead of inventing a new naming scheme.
 */
export function buildDownloadFilename(username: string, ext: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${username}_${timestamp}.${ext}`;
}
