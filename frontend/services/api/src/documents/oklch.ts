type Vector = readonly [number, number, number];
type Matrix = readonly [Vector, Vector, Vector];

const OKLAB_TO_LMS: Matrix = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_LINEAR_SRGB: Matrix = [
  [4.0767416360759583, -3.3077115392580629, 0.2309699031821043],
  [-1.2684379732850315, 2.6097573492876882, -0.341319376002657],
  [-0.0041960761386756, -0.7034186179359362, 1.7076146940746117],
];

const multiply = (matrix: Matrix, [x, y, z]: Vector): Vector => {
  const row = ([a, b, c]: Vector) => a * x + b * y + c * z;
  return [row(matrix[0]), row(matrix[1]), row(matrix[2])];
};

const encode = (linear: number) => {
  const clipped = Math.min(1, Math.max(0, linear));
  const gamma = clipped <= 0.0031308 ? clipped * 12.92 : 1.055 * clipped ** (1 / 2.4) - 0.055;
  return Math.round(gamma * 255)
    .toString(16)
    .padStart(2, '0');
};

export function oklchToHex(value: string): string | undefined {
  const match = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/iu.exec(value);
  if (!match) return undefined;
  const chroma = Number(match[2]);
  const radians = (Number(match[3]) * Math.PI) / 180;
  const [l, m, s] = multiply(OKLAB_TO_LMS, [
    Number(match[1]) / 100,
    chroma * Math.cos(radians),
    chroma * Math.sin(radians),
  ]);
  const [red, green, blue] = multiply(LMS_TO_LINEAR_SRGB, [l ** 3, m ** 3, s ** 3]);
  return `#${encode(red)}${encode(green)}${encode(blue)}`;
}
