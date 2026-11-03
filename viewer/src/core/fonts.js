// Sign fonts. Lettering is drawn with fonts available on the rendering machine; font files are
// never committed or distributed (docs/SETUP_GPU_PC.md, section 2).
//   1. Preferred: the fonts are installed on the machine (system fonts).
//   2. Fallback where installing fonts is not possible: the same files in the git-ignored
//      local-fonts/ directory. Only a family that is NOT installed is loaded from there, so a
//      machine with the fonts installed draws exactly as before.
// A family that is neither installed nor in local-fonts/ silently falls back to another face and
// changes the lettering; it is reported in window.__fontWarnings.
export const SIGN_FONTS = [
  { family: 'IPAGothic', file: 'ipag.ttf' },
  { family: 'IPAPGothic', file: 'ipagp.ttf' },
  { family: 'IPAMincho', file: 'ipam.ttf' },
  { family: 'IPAPMincho', file: 'ipamp.ttf' },
  { family: 'MotoyaLMaru', file: 'MTLmr3m.ttf' },
  { family: 'MotoyaLCedar', file: 'MTLc3m.ttf' },
  // Chrome rejects the Debian .ttc as a web font (OTS: misaligned FFTM table); a .ttf of its first
  // face (docs/SETUP_GPU_PC.md) loads
  { family: 'WenQuanYi Zen Hei', file: ['wqy-zenhei.ttf', 'wqy-zenhei.ttc'] },
];
// families whose absence changes the lettering (the P-variants are only fallbacks in the stacks)
export const REQUIRED_FONTS = ['IPAGothic', 'IPAMincho', 'MotoyaLMaru', 'MotoyaLCedar', 'WenQuanYi Zen Hei'];

const probe = document.createElement('canvas').getContext('2d');
const width = (f) => { probe.font = `64px ${f}`; return probe.measureText('喫茶歌舞伎町一番街ABC123').width; };
const available = (family) => !(width(`"${family}", monospace`) === width('monospace') && width(`"${family}", serif`) === width('serif'));

/** Make the sign fonts available. Returns { missing: [family], sources: { family: 'system' | 'local-fonts/<file>' | 'missing' } }. */
export async function prepareSignFonts(log) {
  const sources = {};
  for (const { family, file } of SIGN_FONTS) {
    sources[family] = available(family) ? 'system' : 'missing';
    for (const f of sources[family] === 'missing' ? [].concat(file) : []) {
      try {
        const face = new FontFace(family, `url(/local-fonts/${f})`);
        await face.load();
        document.fonts.add(face);
        if (available(family)) { sources[family] = `local-fonts/${f}`; break; }
      } catch { /* not present or not loadable: try the next candidate */ }
    }
  }
  const local = Object.entries(sources).filter(([, s]) => s.startsWith('local-fonts/')).map(([f]) => f);
  if (local.length) log(`fonts loaded from local-fonts/ (not installed on this machine): ${local.join(', ')}`);
  const missing = REQUIRED_FONTS.filter((f) => sources[f] === 'missing');
  if (missing.length) log(`WARNING fonts not installed (fallbacks used): ${missing.join(', ')}`);
  return { missing, sources };
}
