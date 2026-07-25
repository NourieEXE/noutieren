/**
 * Local file download and read helpers.
 *
 * Downloads go through an object URL and a synthetic anchor click, which needs
 * no `downloads` permission and never leaves the device.
 */

export function downloadTextFile(
  filename: string,
  contents: string,
  mimeType = 'application/json',
): void {
  const blob = new Blob([contents], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Give Firefox time to start the download before releasing the blob.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

/** Reads a user-selected file as text. */
export async function readTextFile(file: File): Promise<string> {
  return file.text();
}

/** Guards against accidentally opening a huge file as a backup. */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
