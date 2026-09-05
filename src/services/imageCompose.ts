import sharp from 'sharp';
import { config } from '../config';
import { fetchWithTimeout } from './httpQueue';
import { logger } from '../logger';
import { BadgeInfo } from '../types';

export interface RenderedImage {
  buffer: Buffer;
  contentType: string;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Average color of a horizontal strip, used to decide if the sash should go neutral gray. */
async function sampleStripLuminance(buffer: Buffer, width: number, top: number, stripHeight: number): Promise<number> {
  try {
    const region = await sharp(buffer)
      .extract({ left: 0, top: Math.max(0, top), width, height: Math.max(1, stripHeight) })
      .resize(1, 1)
      .raw()
      .toBuffer();
    const [r, g, b] = region;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  } catch (err) {
    logger.debug('[imageCompose] luminance sample failed, defaulting to bright', err);
    return 255; // default to "bright" so we don't accidentally always gray-out on failure
  }
}

function buildSashSvg(width: number, height: number, label: string, color: string): string {
  const sashHeight = Math.round(height * (config.sashHeightPercent / 100));
  const fontSize = Math.max(11, Math.round(sashHeight * 0.46));
  const y = height - sashHeight;
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${y}" width="${width}" height="${sashHeight}" fill="${color}" />
    <text x="${width / 2}" y="${y + sashHeight / 2}" text-anchor="middle" dominant-baseline="central"
      font-family="DejaVu Sans, sans-serif" font-weight="bold"
      font-size="${fontSize}" letter-spacing="1.2" fill="#ffffff">${escapeXml(label.toUpperCase())}</text>
  </svg>`;
}

function buildTrendingBadgeSvg(width: number, height: number): string {
  const margin = Math.round(width * 0.04);
  const badgeHeight = Math.round(width * 0.11);
  const badgeWidth = Math.round(badgeHeight * 2.6);
  const rx = badgeHeight / 2;
  const fontSize = Math.round(badgeHeight * 0.44);
  const flameSize = badgeHeight * 0.6;
  const flameX = badgeHeight * 0.34;
  const flameY = (badgeHeight - flameSize) / 2;

  // Simple stylized flame, drawn as a path rather than relying on an emoji
  // font (not reliably available in the container's font set) - filled
  // white to match the flat orange-and-white look you asked for.
  const flame = `<path transform="translate(${flameX},${flameY}) scale(${flameSize / 24})"
    d="M12 2c1 3-2 4-2 7a3 3 0 0 0 6 0c0-1-0.5-2-0.5-2 1.5 1 2.5 3 2.5 5a6 6 0 0 1-12 0c0-4 3-5 4-7 0.5-1 1-2 2-3z"
    fill="#ffffff" />`;

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <g transform="translate(${margin}, ${margin})">
      <rect width="${badgeWidth}" height="${badgeHeight}" rx="${rx}" ry="${rx}" fill="${config.trendingBadgeColor}" />
      ${flame}
      <text x="${badgeHeight * 0.8 + (badgeWidth - badgeHeight * 0.8) / 2}" y="${badgeHeight / 2}"
        text-anchor="middle" dominant-baseline="central"
        font-family="DejaVu Sans, sans-serif" font-weight="bold"
        font-size="${fontSize}" letter-spacing="0.5" fill="#ffffff">TOP</text>
    </g>
  </svg>`;
}

/**
 * Fetches the base poster, draws whichever badges apply, and returns the
 * composited bytes. Returns null on any failure so the caller can fall back
 * to a plain redirect instead of erroring out the whole request.
 */
export async function renderBadgedPoster(baseUrl: string, badges: BadgeInfo): Promise<RenderedImage | null> {
  if (!badges.trending && !badges.sash) return null;

  try {
    const res = await fetchWithTimeout(baseUrl, config.requestTimeoutMs);
    if (!res.ok) return null;
    const baseBuffer = Buffer.from(await res.arrayBuffer());

    const metadata = await sharp(baseBuffer).metadata();
    const width = metadata.width || 780;
    const height = metadata.height || Math.round(width * 1.5);

    const overlays: sharp.OverlayOptions[] = [];

    if (badges.sash) {
      const sashHeight = Math.round(height * (config.sashHeightPercent / 100));
      const luminance = await sampleStripLuminance(baseBuffer, width, height - sashHeight, sashHeight);
      const color = luminance < config.sashDarkLuminanceThreshold ? config.sashColorDarkFallback : badges.sash.color;
      overlays.push({ input: Buffer.from(buildSashSvg(width, height, badges.sash.label, color)), top: 0, left: 0 });
    }

    if (badges.trending) {
      overlays.push({ input: Buffer.from(buildTrendingBadgeSvg(width, height)), top: 0, left: 0 });
    }

    const output = await sharp(baseBuffer).composite(overlays).jpeg({ quality: 90 }).toBuffer();
    return { buffer: output, contentType: 'image/jpeg' };
  } catch (err) {
    logger.warn('[imageCompose] failed, caller should fall back to a plain redirect', err);
    return null;
  }
}
