import sharp from 'sharp';
import { config } from '../config';
import { fetchWithTimeout } from './httpQueue';
import { logger } from '../logger';
import { BadgeInfo } from '../types';

export interface RenderedImage {
  buffer: Buffer;
  contentType: string;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rgbToHex(rgb: RgbColor): string {
  return '#' + [rgb.r, rgb.g, rgb.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/** White or near-black text, whichever contrasts better against `rgb`. */
function idealTextColor(rgb: RgbColor): string {
  const luminance = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  return luminance > 150 ? '#1a1a1a' : '#ffffff';
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s, l };
}

/**
 * Picks a representative "main color" from the poster - not a flat average
 * (which tends toward muddy gray-brown), but the most vibrant, reasonably
 * populated color present, similar in spirit to Android's Palette/Vibrant
 * swatch. Returns null when nothing in the image is saturated enough to be
 * worth using (a mostly black/white/desaturated poster), signaling the
 * caller to use the neutral dark-gray fallback instead.
 */
async function extractAccentColor(buffer: Buffer): Promise<RgbColor | null> {
  try {
    const { data, info } = await sharp(buffer)
      .resize(48, 48, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const buckets = new Map<string, { r: number; g: number; b: number; count: number; satSum: number; lightSum: number }>();

    for (let i = 0; i + channels <= data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const { h, s, l } = rgbToHsl(r, g, b);
      const hueBucket = Math.floor(h / 20); // 18 hue buckets
      const lightTier = l < 0.15 ? 0 : l < 0.85 ? 1 : 2; // avoid merging near-black/near-white with mid-tones
      const key = `${hueBucket}-${lightTier}`;
      const entry = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0, satSum: 0, lightSum: 0 };
      entry.r += r;
      entry.g += g;
      entry.b += b;
      entry.count += 1;
      entry.satSum += s;
      entry.lightSum += l;
      buckets.set(key, entry);
    }

    const totalPixels = data.length / channels;
    let best: { r: number; g: number; b: number; score: number } | null = null;

    for (const entry of buckets.values()) {
      const avgSat = entry.satSum / entry.count;
      const avgLight = entry.lightSum / entry.count;
      const population = entry.count / totalPixels;
      const lightnessFit = Math.max(1 - Math.abs(avgLight - 0.5) * 1.6, 0.1); // favor mid-tones, not extremes
      const score = avgSat * lightnessFit * Math.min(population * 6, 1);
      if (!best || score > best.score) {
        best = { r: entry.r / entry.count, g: entry.g / entry.count, b: entry.b / entry.count, score };
      }
    }

    if (!best || best.score < config.sashMinSaturationScore) return null;
    return { r: best.r, g: best.g, b: best.b };
  } catch (err) {
    logger.debug('[imageCompose] accent color extraction failed', err);
    return null;
  }
}

/**
 * "Thin line -> bump up around the label -> thin line" shape: a full-width
 * thin baseline plus a taller, centered, top-rounded tag sitting on it -
 * matching the reference image rather than a plain full-height bar.
 */
function buildSashSvg(width: number, height: number, label: string, color: string, textColor: string): string {
  const baselineHeight = Math.max(1, Math.round(height * (config.sashBaselineHeightPercent / 100)));
  const bumpHeight = Math.round(height * (config.sashHeightPercent / 100));
  const bumpWidth = Math.round(width * (config.sashBumpWidthPercent / 100));
  const bumpX = (width - bumpWidth) / 2;
  const bumpY = height - bumpHeight;
  const baselineY = height - baselineHeight;
  const radius = Math.round(bumpHeight * 0.32);
  const fontSize = Math.max(10, Math.round(bumpHeight * 0.42));

  const bumpPath = `M ${bumpX} ${height}
    L ${bumpX} ${bumpY + radius}
    Q ${bumpX} ${bumpY} ${bumpX + radius} ${bumpY}
    L ${bumpX + bumpWidth - radius} ${bumpY}
    Q ${bumpX + bumpWidth} ${bumpY} ${bumpX + bumpWidth} ${bumpY + radius}
    L ${bumpX + bumpWidth} ${height}
    Z`;

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${baselineY}" width="${width}" height="${baselineHeight}" fill="${color}" />
    <path d="${bumpPath}" fill="${color}" />
    <text x="${width / 2}" y="${bumpY + bumpHeight / 2}" text-anchor="middle" dominant-baseline="central"
      font-family="DejaVu Sans, sans-serif" font-weight="bold"
      font-size="${fontSize}" letter-spacing="1" fill="${textColor}">${escapeXml(label.toUpperCase())}</text>
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
      let color = config.sashColorDarkFallback;
      let textColor = '#ffffff';

      if (config.sashColorMode === 'status') {
        color = badges.sash.color;
        textColor = idealTextColor(hexToRgb(color));
      } else {
        const accent = await extractAccentColor(baseBuffer);
        if (accent) {
          color = rgbToHex(accent);
          textColor = idealTextColor(accent);
        }
        // else: no sufficiently vibrant color found - keep the dark fallback.
      }

      overlays.push({ input: Buffer.from(buildSashSvg(width, height, badges.sash.label, color, textColor)), top: 0, left: 0 });
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

function hexToRgb(hex: string): RgbColor {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}
