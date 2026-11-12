// Installed-font detection by measuring text. The candidate list, the probe
// text and the font size are part of recipe 1.

import { yieldTask } from './schedule.ts';

const BUDGET_MS = 3000;
const GROUP_SIZE = 4;
const BASE_FAMILIES = ['monospace', 'serif', 'sans-serif'] as const;

// Latin letters of very different widths, four Arabic letters (U+0639 U+0631
// U+0628 U+064A) so that Arabic-only fonts change the measurement too, and digits.
const PROBE_TEXT = 'mmmmmmmmmmlliWWW\u0639\u0631\u0628\u064a123';

// System fonts of the common desktop and mobile platforms, vendor interface
// fonts, and widely installed office and developer fonts.
const CANDIDATES: readonly string[] = [
  'Arial',
  'Arial Black',
  'Arial Narrow',
  'Calibri',
  'Cambria',
  'Candara',
  'Comic Sans MS',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Georgia',
  'Impact',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Microsoft Sans Serif',
  'Palatino Linotype',
  'Segoe UI',
  'Segoe UI Emoji',
  'Segoe Print',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Webdings',
  'Wingdings',
  'MS Gothic',
  'SimSun',
  'Malgun Gothic',
  'Yu Gothic',
  'Bahnschrift',
  'Cascadia Code',
  'Ebrima',
  'Gadugi',
  'Leelawadee UI',
  'Nirmala UI',
  'Sakkal Majalla',
  'Traditional Arabic',
  'Arabic Typesetting',
  'Simplified Arabic',
  'Andalus',
  'Aldhabi',
  'Urdu Typesetting',
  'Helvetica',
  'Helvetica Neue',
  'Menlo',
  'Monaco',
  'San Francisco',
  'Geeza Pro',
  'Damascus',
  'Al Nile',
  'Baghdad',
  'Roboto',
  'Noto Sans',
  'Noto Naskh Arabic',
  'Noto Sans Arabic',
  'Droid Sans',
  'Droid Sans Mono',
  'Ubuntu',
  'DejaVu Sans',
  'Liberation Sans',
  'Cantarell',
  'Samsung Sans',
  'SamsungOne',
  'MIUI',
  'Mi Sans',
  'HarmonyOS Sans',
  'OPPOSans',
  'Product Sans',
  'Google Sans',
  'Adobe Arabic',
  'Myriad Pro',
  'Minion Pro',
  'Calibri Light',
  'Office Code Pro',
  'Source Code Pro',
  'Fira Code',
  'JetBrains Mono',
  'Dubai',
  'Tajawal',
  'Cairo',
  'Amiri',
];

/**
 * Returns the sorted names of the candidates that are installed, or `null`
 * when the page has no body, the probe runs out of time, or `cancelled()`
 * turns true.
 *
 * A candidate is installed when text set in it measures differently from the
 * same text in any of the three generic families. The first lookup of a family
 * is slow, so candidates are measured four at a time with a yield in between.
 */
export async function fonts(cancelled: () => boolean = () => false): Promise<string[] | null> {
  const body = document.body as HTMLElement | null;
  if (!body) return null;
  const started = performance.now();
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:0;visibility:hidden;pointer-events:none;contain:strict';
  const probe = (family: string) => {
    const span = document.createElement('span');
    span.textContent = PROBE_TEXT;
    span.style.cssText = 'position:absolute;top:0;white-space:nowrap;font-size:72px';
    span.style.fontFamily = family;
    box.appendChild(span);
    return span;
  };
  const size = (span: HTMLElement) => `${span.offsetWidth}x${span.offsetHeight}`;
  body.appendChild(box);
  try {
    const base = BASE_FAMILIES.map(probe).map(size);
    const found: string[] = [];
    for (let start = 0; start < CANDIDATES.length; start += GROUP_SIZE) {
      await yieldTask();
      if (cancelled() || performance.now() - started > BUDGET_MS) return null;
      const group = CANDIDATES.slice(start, start + GROUP_SIZE);
      const probes = group.map((name) => BASE_FAMILIES.map((family) => probe(`'${name}',${family}`)));
      group.forEach((name, index) => {
        if (probes[index]?.some((span, family) => size(span) !== base[family])) found.push(name);
      });
      for (const span of probes.flat()) box.removeChild(span);
    }
    return found.sort();
  } finally {
    box.remove();
  }
}
