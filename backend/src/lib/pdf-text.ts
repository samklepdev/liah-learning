import { execFileSync } from 'node:child_process';

/** Runs pdftotext on a PDF buffer and returns the extracted plain text. */
export function extractPdfText(buffer: Buffer): string {
  return execFileSync('pdftotext', ['-layout', '-', '-'], {
    input: buffer,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}
