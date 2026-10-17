/**
 * Colour arithmetic for the design-system checks: WCAG contrast, CIELAB
 * lightness, CIEDE2000 distance and colour-vision-deficiency simulation.
 * Pure functions over six-digit hex strings; no token knowledge lives here.
 */

const channels = (hex) =>
  hex
    .slice(1)
    .match(/../g)
    .map((channel) => Number.parseInt(channel, 16) / 255);

const toLinear = (channel) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const fromLinear = (channel) =>
  channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;

export const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value ?? '');

function relativeLuminance(hex) {
  const [red, green, blue] = channels(hex).map(toLinear);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Source-over composite of `rgb(r g b / a%)` or a hex onto an opaque hex. */
export function composite(value, backdrop) {
  if (isHex(value)) return value.toLowerCase();
  const match = value?.match(/^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)%\)$/);
  if (!match || !isHex(backdrop)) return undefined;
  const alpha = Number(match[4]) / 100;
  const base = channels(backdrop).map((channel) => channel * 255);
  return (
    '#' +
    [1, 2, 3]
      .map((index) => Math.round(Number(match[index]) * alpha + base[index - 1] * (1 - alpha)))
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')
  );
}

function linearToLab([red, green, blue]) {
  const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047;
  const y = 0.2126729 * red + 0.7151522 * green + 0.072175 * blue;
  const z = (0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const lab = (hex) => linearToLab(channels(hex).map(toLinear));
export const lightness = (hex) => lab(hex)[0];

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear RGB.
const DEFICIENCY = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
};

function simulate(hex, deficiency) {
  const matrix = DEFICIENCY[deficiency];
  const linear = channels(hex).map(toLinear);
  const mixed = matrix.map((row) =>
    Math.min(
      1,
      Math.max(
        0,
        row.reduce((sum, weight, index) => sum + weight * linear[index], 0),
      ),
    ),
  );
  return (
    '#' +
    mixed
      .map((channel) =>
        Math.round(fromLinear(channel) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** CIEDE2000 colour difference between two hex colours. */
export function deltaE2000(first, second) {
  const [l1, a1, b1] = lab(first);
  const [l2, a2, b2] = lab(second);
  const rad = Math.PI / 180;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const meanC = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hue = (b, a) => {
    if (b === 0 && a === 0) return 0;
    const angle = Math.atan2(b, a) / rad;
    return angle < 0 ? angle + 360 : angle;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const deltaL = l2 - l1;
  const deltaC = c2p - c1p;
  let deltaHue = 0;
  if (c1p * c2p !== 0) {
    deltaHue = h2p - h1p;
    if (deltaHue > 180) deltaHue -= 360;
    else if (deltaHue < -180) deltaHue += 360;
  }
  const deltaH = 2 * Math.sqrt(c1p * c2p) * Math.sin((deltaHue * rad) / 2);
  const meanL = (l1 + l2) / 2;
  const meanCp = (c1p + c2p) / 2;
  let meanH = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) meanH += h1p + h2p < 360 ? 360 : -360;
    meanH /= 2;
  }
  const t =
    1 -
    0.17 * Math.cos((meanH - 30) * rad) +
    0.24 * Math.cos(2 * meanH * rad) +
    0.32 * Math.cos((3 * meanH + 6) * rad) -
    0.2 * Math.cos((4 * meanH - 63) * rad);
  const sl = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const sc = 1 + 0.045 * meanCp;
  const sh = 1 + 0.015 * meanCp * t;
  const rt =
    -2 *
    Math.sqrt(meanCp ** 7 / (meanCp ** 7 + 25 ** 7)) *
    Math.sin(60 * Math.exp(-(((meanH - 275) / 25) ** 2)) * rad);
  return Math.sqrt(
    (deltaL / sl) ** 2 +
      (deltaC / sc) ** 2 +
      (deltaH / sh) ** 2 +
      rt * (deltaC / sc) * (deltaH / sh),
  );
}

/**
 * Two marks are separable when their lightness differs by `minLightness`, or
 * when they stay `minDistance` apart under both red–green deficiencies.
 */
export function separation(first, second) {
  return {
    lightness: Math.abs(lightness(first) - lightness(second)),
    deuteranopia: deltaE2000(simulate(first, 'deuteranopia'), simulate(second, 'deuteranopia')),
    protanopia: deltaE2000(simulate(first, 'protanopia'), simulate(second, 'protanopia')),
  };
}
