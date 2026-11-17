/**
 * CSS colour values to RRGGBB, for computed-style mapping in javascript-excel/dom.
 *
 * Browsers serialise computed colours in the space they were authored in, so a computed style
 * can be `rgb()`/`rgba()`, `lab()`, `lch()`, `oklab()`, `oklch()` or `color(<space> …)` (CSS
 * Color 4). Every form is converted to sRGB: through linear sRGB (OKLab), or through CIE XYZ
 * (CIE Lab/LCH in D50 with Bradford adaptation, and the predefined RGB and XYZ spaces). Colours
 * outside sRGB are clipped per channel. `none` components count as 0. The matrices are the ones
 * in the CSS Color 4 sample code.
 */

const NAMED: Record<string, string> = {
  black: "000000", white: "FFFFFF", red: "FF0000", lime: "00FF00", green: "008000", blue: "0000FF", yellow: "FFFF00",
  cyan: "00FFFF", aqua: "00FFFF", magenta: "FF00FF", fuchsia: "FF00FF", silver: "C0C0C0", gray: "808080", grey: "808080",
  maroon: "800000", olive: "808000", purple: "800080", teal: "008080", navy: "000080", orange: "FFA500",
};

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const XYZ65_TO_LSRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const LSRGB_TO_XYZ65: Mat3 = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
/** Bradford chromatic adaptation, D50 to D65. */
const D50_TO_D65: Mat3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const LP3_TO_XYZ65: Mat3 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const LA98_TO_XYZ65: Mat3 = [
  [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
  [0.29734497525053605, 0.6273635662554661, 0.07529145849399788],
  [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
];
const LPROPHOTO_TO_XYZ50: Mat3 = [
  [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
  [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
  [0, 0, 0.8251046025104602],
];
const LREC2020_TO_XYZ65: Mat3 = [
  [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
  [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
  [0, 0.028072693049087428, 1.060985057710791],
];
const OKLAB_TO_LMS: Mat3 = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_LSRGB: Mat3 = [
  [4.0767416360759583, -3.3077115392580629, 0.2309699031821043],
  [-1.2684379732850315, 2.6097573492876882, -0.3413193760026573],
  [-0.0041960761386756, -0.7034186179359363, 1.7076146940746117],
];

const signed = (c: number, f: (a: number) => number): number => Math.sign(c) * f(Math.abs(c));
/** The sRGB (and display-p3) transfer function, inverse: encoded to linear. */
const srgbLinear = (c: number): number => signed(c, (a) => (a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4));
const srgbEncode = (c: number): number => signed(c, (a) => (a > 0.0031308 ? 1.055 * a ** (1 / 2.4) - 0.055 : 12.92 * a));
const a98Linear = (c: number): number => signed(c, (a) => a ** (563 / 256));
const prophotoLinear = (c: number): number => signed(c, (a) => (a <= 16 / 512 ? a / 16 : a ** 1.8));
const REC_A = 1.09929682680944;
const REC_B = 0.018053968510807;
const rec2020Linear = (c: number): number => signed(c, (a) => (a < REC_B * 4.5 ? a / 4.5 : ((a + REC_A - 1) / REC_A) ** (1 / 0.45)));

const xyz65ToLinearSrgb = (v: Vec3): Vec3 => mul(XYZ65_TO_LSRGB, v);
const xyz50ToLinearSrgb = (v: Vec3): Vec3 => mul(XYZ65_TO_LSRGB, mul(D50_TO_D65, v));

const D50: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
function labToLinearSrgb(l: number, a: number, b: number): Vec3 {
  const k = 24389 / 27;
  const e = 216 / 24389;
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const xyz: Vec3 = [fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k, l > k * e ? fy ** 3 : l / k, fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k];
  return xyz50ToLinearSrgb([xyz[0] * D50[0], xyz[1] * D50[1], xyz[2] * D50[2]]);
}

function oklabToLinearSrgb(l: number, a: number, b: number): Vec3 {
  const lms = mul(OKLAB_TO_LMS, [l, a, b]);
  return mul(LMS_TO_LSRGB, [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3]);
}

const toHex = (encoded: Vec3): string =>
  encoded.map((c) => Math.round(Math.min(1, Math.max(0, Number.isFinite(c) ? c : 0)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
const linearToHex = (v: Vec3): string => toHex([srgbEncode(v[0]), srgbEncode(v[1]), srgbEncode(v[2])]);

/** One component: a number, a percentage (scaled so 100% = `pct`), an angle in degrees, or none (0). */
function num(token: string, pct: number): number | undefined {
  if (token === "none") return 0;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/.exec(token);
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  switch (m[2]) {
    case "%": return (n * pct) / 100;
    case "grad": return (n * 360) / 400;
    case "rad": return (n * 180) / Math.PI;
    case "turn": return n * 360;
    default: return n;
  }
}

/** The components and optional alpha of a functional colour, or undefined if it is malformed. */
function parts(body: string): { c: string[]; alpha: string | undefined } | undefined {
  const [main, alpha, extra] = body.split("/");
  if (extra !== undefined || main === undefined) return undefined;
  const c = main.trim().split(/\s*,\s*|\s+/).filter(Boolean);
  const a = alpha?.trim();
  if (a === "") return undefined;
  // Legacy comma syntax: rgba(r, g, b, a).
  if (a === undefined && c.length === 4 && main.includes(",")) return { c: c.slice(0, 3), alpha: c[3] };
  return { c, alpha: a };
}

function hueRgb(h: number, s: number, l: number): Vec3 {
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** The predefined colour spaces of color(): encoded components to linear sRGB. */
const SPACES: Record<string, (v: Vec3) => Vec3> = {
  srgb: (v) => [srgbLinear(v[0]), srgbLinear(v[1]), srgbLinear(v[2])],
  "srgb-linear": (v) => v,
  "display-p3": (v) => xyz65ToLinearSrgb(mul(LP3_TO_XYZ65, [srgbLinear(v[0]), srgbLinear(v[1]), srgbLinear(v[2])])),
  "a98-rgb": (v) => xyz65ToLinearSrgb(mul(LA98_TO_XYZ65, [a98Linear(v[0]), a98Linear(v[1]), a98Linear(v[2])])),
  "prophoto-rgb": (v) => xyz50ToLinearSrgb(mul(LPROPHOTO_TO_XYZ50, [prophotoLinear(v[0]), prophotoLinear(v[1]), prophotoLinear(v[2])])),
  rec2020: (v) => xyz65ToLinearSrgb(mul(LREC2020_TO_XYZ65, [rec2020Linear(v[0]), rec2020Linear(v[1]), rec2020Linear(v[2])])),
  xyz: xyz65ToLinearSrgb,
  "xyz-d65": xyz65ToLinearSrgb,
  "xyz-d50": xyz50ToLinearSrgb,
};

function functional(fn: string, body: string): string | undefined {
  const p = parts(body);
  if (!p) return undefined;
  let space: string | undefined;
  let c = p.c;
  if (fn === "color") {
    space = c[0];
    c = c.slice(1);
  }
  if (c.length !== 3) return undefined;
  if (p.alpha !== undefined) {
    const a = num(p.alpha, 1);
    if (a === undefined) return undefined;
    if (!(a > 0)) return undefined;
  }
  // Scale of a percentage for each component, per function (CSS Color 4 §§ 4–9).
  const scale: Record<string, Vec3> = {
    rgb: [255, 255, 255], rgba: [255, 255, 255],
    hsl: [1, 100, 100], hsla: [1, 100, 100], hwb: [1, 100, 100],
    lab: [100, 125, 125], lch: [100, 150, 1],
    oklab: [1, 0.4, 0.4], oklch: [1, 0.4, 1],
    color: [1, 1, 1],
  };
  const s = scale[fn];
  if (!s) return undefined;
  const v: number[] = [];
  for (let i = 0; i < 3; i++) {
    const n = num(c[i]!, s[i]!);
    if (n === undefined) return undefined;
    v.push(n);
  }
  const [x, y, z] = v as Vec3;
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  switch (fn) {
    case "rgb":
    case "rgba":
      return toHex([x / 255, y / 255, z / 255]);
    case "hsl":
    case "hsla":
      return toHex(hueRgb(((x % 360) + 360) % 360, Math.max(0, y) / 100, z / 100));
    case "hwb": {
      const w = Math.max(0, y) / 100;
      const b = Math.max(0, z) / 100;
      if (w + b >= 1) {
        const g = w / (w + b);
        return toHex([g, g, g]);
      }
      return toHex(hueRgb(((x % 360) + 360) % 360, 1, 0.5).map((ch) => ch * (1 - w - b) + w) as Vec3);
    }
    case "lab":
      return linearToHex(labToLinearSrgb(Math.min(100, Math.max(0, x)), y, z));
    case "lch": {
      const ch = Math.max(0, y);
      return linearToHex(labToLinearSrgb(Math.min(100, Math.max(0, x)), ch * Math.cos(rad(z)), ch * Math.sin(rad(z))));
    }
    case "oklab":
      return linearToHex(oklabToLinearSrgb(Math.min(1, Math.max(0, x)), y, z));
    case "oklch": {
      const ch = Math.max(0, y);
      return linearToHex(oklabToLinearSrgb(Math.min(1, Math.max(0, x)), ch * Math.cos(rad(z)), ch * Math.sin(rad(z))));
    }
    default: {
      const conv = space === undefined ? undefined : SPACES[space];
      return conv ? linearToHex(conv([x, y, z])) : undefined;
    }
  }
}

/** A CSS colour as RRGGBB, or undefined for transparent or unparseable values. */
export function cssColor(value: string): string | undefined {
  const v = value.trim().toLowerCase();
  if (!v || v === "transparent" || v === "currentcolor" || v === "inherit" || v === "initial") return undefined;
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      if (hex.length === 4 && hex[3] === "0") return undefined;
      return hex.slice(0, 3).split("").map((c) => c + c).join("").toUpperCase();
    }
    if (hex.length === 6) return hex.toUpperCase();
    if (hex.length === 8) return hex.slice(6) === "00" ? undefined : hex.slice(0, 6).toUpperCase();
    return undefined;
  }
  const fn = /^([a-z]+)\(\s*([^()]*)\)$/.exec(v);
  if (fn) return functional(fn[1]!, fn[2]!);
  return NAMED[v];
}
