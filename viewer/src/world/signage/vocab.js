// Text vocabulary for added signage. Everything here is period-plausible-generic:
//  - TRADES are generic trade words (no real businesses).
//  - NAME_STEMS / KANA_NAMES are FICTIONAL shop-name parts invented for this reconstruction.
//    Every sign that uses one is tagged `fictional: true` in its provenance entry.
//  - No real brands, logos, company names, film titles or performers.
// Words that collide with real local businesses or brands (e.g. well-known Shinjuku cafes,
// department stores, theatre names, drink brands) are deliberately absent; see BLOCKLIST.

/** Colour schemes (sRGB). bg = board, fg = lettering, ac = accent/trim, ed = edge paint. */
export const SCHEMES = {
  redOnWhite: { bg: '#ede7d8', fg: '#c0261d', ac: '#1f3f8a', ed: '#9b1c15' },
  whiteOnRed: { bg: '#b3251c', fg: '#f3eee2', ac: '#efc12f', ed: '#6e1710' },
  blackOnYellow: { bg: '#eec12c', fg: '#1b1a17', ac: '#c0261d', ed: '#3a3428' },
  whiteOnBlue: { bg: '#1e4a91', fg: '#f1efe8', ac: '#e9c43c', ed: '#122c58' },
  blueOnWhite: { bg: '#ebe9e2', fg: '#1d438e', ac: '#c0261d', ed: '#1d438e' },
  whiteOnGreen: { bg: '#1d6a44', fg: '#f1efe4', ac: '#eec12c', ed: '#0f3a25' },
  greenOnWhite: { bg: '#ece9df', fg: '#1b6640', ac: '#c0261d', ed: '#1b6640' },
  whiteOnOrange: { bg: '#de6b1c', fg: '#fbf5e8', ac: '#1d3f86', ed: '#8a3c0c' },
  yellowOnBlack: { bg: '#1c1b19', fg: '#efc32d', ac: '#d6382a', ed: '#0c0c0b' },
  goldOnMaroon: { bg: '#5b1a28', fg: '#e6c46a', ac: '#efe6d0', ed: '#2e0c14' },
  blackOnWhite: { bg: '#efece4', fg: '#1b1b1a', ac: '#c0261d', ed: '#2a2a28' },
  brownOnCream: { bg: '#e6d9bc', fg: '#4a2a17', ac: '#9a2a1c', ed: '#5a3a22' },
  whiteOnBlack: { bg: '#1d1d1c', fg: '#efede6', ac: '#de3a2a', ed: '#0a0a0a' },
  redOnYellow: { bg: '#f0c936', fg: '#bd201a', ac: '#1b1a17', ed: '#8a6a10' },
  whiteOnPurple: { bg: '#4a2a68', fg: '#f1edf4', ac: '#e8c66a', ed: '#26143a' },
  pinkOnWhite: { bg: '#f0e9e2', fg: '#cf3668', ac: '#3a2a6a', ed: '#8a2244' },
  navyOnSky: { bg: '#8fc3dd', fg: '#13386a', ac: '#f0efe6', ed: '#3a6a8a' },
  whiteOnTeal: { bg: '#1f6f78', fg: '#f0efe6', ac: '#eec12c', ed: '#0e3a40' },
  redOnCream: { bg: '#efe2c4', fg: '#b3241a', ac: '#2a2a28', ed: '#7a5a3a' },
  whiteOnBrown: { bg: '#5a3a24', fg: '#f0e6d0', ac: '#e6b44a', ed: '#2e1c10' },
};

/**
 * Generic trades. g = may occupy ground floor, u = may occupy an upper floor,
 * noren = a cloth noren is plausible, sch = preferred schemes, fmt = name pattern:
 *   'pre'  -> "<trade> <name>"     'suf' -> "<name><suffix>"   'bare' -> trade word only
 */
export const TRADES = [
  { w: '喫茶', g: 1, u: 1, sch: ['brownOnCream', 'goldOnMaroon', 'whiteOnGreen', 'redOnWhite', 'whiteOnBrown'], fmt: 'pre', kana: 1 },
  { w: '純喫茶', g: 1, u: 1, sch: ['brownOnCream', 'goldOnMaroon', 'whiteOnBrown', 'redOnCream'], fmt: 'pre', kana: 1 },
  { w: '喫茶室', g: 0, u: 1, sch: ['brownOnCream', 'whiteOnTeal', 'goldOnMaroon'], fmt: 'pre', kana: 1 },
  { w: '麻雀', g: 0, u: 1, sch: ['whiteOnGreen', 'greenOnWhite', 'redOnWhite', 'yellowOnBlack', 'whiteOnBlue'], fmt: 'suf', suf: ['荘', '荘', 'クラブ'] },
  { w: '中華料理', g: 1, u: 1, sch: ['whiteOnRed', 'redOnYellow', 'redOnWhite'], fmt: 'suf', suf: ['飯店', '楼', '軒', '園', '菜館'] },
  { w: 'ラーメン', g: 1, u: 0, sch: ['whiteOnRed', 'redOnYellow', 'redOnWhite', 'blackOnYellow'], fmt: 'pre', noren: 1 },
  { w: '寿司', g: 1, u: 1, sch: ['blackOnWhite', 'whiteOnBlue', 'redOnCream', 'whiteOnBlack'], fmt: 'pre', noren: 1 },
  { w: '焼鳥', g: 1, u: 0, sch: ['whiteOnRed', 'blackOnWhite', 'redOnCream', 'whiteOnBlack'], fmt: 'pre', noren: 1 },
  { w: '酒場', g: 1, u: 1, sch: ['blackOnWhite', 'whiteOnRed', 'redOnCream'], fmt: 'pre', noren: 1 },
  { w: '大衆酒場', g: 1, u: 0, sch: ['blackOnWhite', 'whiteOnRed', 'redOnCream'], fmt: 'pre', noren: 1 },
  { w: 'スナック', g: 1, u: 1, sch: ['goldOnMaroon', 'whiteOnPurple', 'pinkOnWhite', 'yellowOnBlack', 'whiteOnBlack', 'whiteOnTeal'], fmt: 'pre', kana: 1 },
  { w: 'バー', g: 0, u: 1, sch: ['goldOnMaroon', 'whiteOnBlack', 'yellowOnBlack', 'whiteOnPurple'], fmt: 'pre', kana: 1 },
  { w: 'クラブ', g: 0, u: 1, sch: ['goldOnMaroon', 'whiteOnPurple', 'pinkOnWhite', 'whiteOnBlack'], fmt: 'pre', kana: 1 },
  { w: '洋品', g: 1, u: 0, sch: ['blueOnWhite', 'whiteOnBlue', 'navyOnSky', 'blackOnWhite'], fmt: 'pre' },
  { w: '時計', g: 1, u: 0, sch: ['blueOnWhite', 'blackOnWhite', 'whiteOnBlue'], fmt: 'suf', suf: ['時計店', '堂'] },
  { w: '眼鏡', g: 1, u: 0, sch: ['blueOnWhite', 'blackOnWhite', 'navyOnSky'], fmt: 'suf', suf: ['眼鏡店', 'メガネ'] },
  { w: '薬局', g: 1, u: 0, sch: ['greenOnWhite', 'whiteOnGreen', 'redOnWhite', 'blueOnWhite'], fmt: 'suf', suf: ['薬局', '薬局'] },
  { w: '写真', g: 1, u: 0, sch: ['blueOnWhite', 'whiteOnOrange', 'blackOnYellow'], fmt: 'pre' },
  { w: '理容', g: 1, u: 1, sch: ['blueOnWhite', 'redOnWhite', 'whiteOnBlue'], fmt: 'pre' },
  { w: '美容室', g: 1, u: 1, sch: ['pinkOnWhite', 'whiteOnPurple', 'navyOnSky'], fmt: 'pre', kana: 1 },
  { w: '洋食', g: 1, u: 1, sch: ['brownOnCream', 'redOnWhite', 'whiteOnBrown'], fmt: 'suf', suf: ['亭', 'グリル'] },
  { w: 'とんかつ', g: 1, u: 1, sch: ['blackOnWhite', 'redOnCream', 'whiteOnBrown'], fmt: 'pre', noren: 1 },
  { w: '天ぷら', g: 1, u: 1, sch: ['blackOnWhite', 'whiteOnBlue', 'redOnCream'], fmt: 'pre', noren: 1 },
  { w: 'そば', g: 1, u: 0, sch: ['blackOnWhite', 'whiteOnBlue', 'whiteOnBlack', 'redOnCream'], fmt: 'suf', suf: ['庵', '屋', '庵'], noren: 1 },
  { w: '甘味', g: 1, u: 1, sch: ['redOnCream', 'pinkOnWhite', 'whiteOnRed'], fmt: 'pre', noren: 1 },
  { w: 'レストラン', g: 1, u: 1, sch: ['redOnWhite', 'whiteOnRed', 'blueOnWhite', 'whiteOnTeal'], fmt: 'pre', kana: 1 },
  { w: 'サウナ', g: 0, u: 1, sch: ['whiteOnBlue', 'blueOnWhite', 'whiteOnOrange', 'navyOnSky'], fmt: 'pre' },
  { w: '旅行', g: 1, u: 1, sch: ['whiteOnBlue', 'blueOnWhite', 'whiteOnTeal'], fmt: 'suf', suf: ['観光', '旅行社'] },
  { w: '不動産', g: 1, u: 1, sch: ['blueOnWhite', 'blackOnWhite', 'whiteOnGreen'], fmt: 'suf', suf: ['不動産', '商事'] },
  { w: 'パチンコ', g: 1, u: 0, sch: ['whiteOnRed', 'redOnYellow', 'yellowOnBlack', 'whiteOnBlue'], fmt: 'pre' },
  { w: 'ビリヤード', g: 0, u: 1, sch: ['whiteOnGreen', 'yellowOnBlack', 'greenOnWhite'], fmt: 'pre' },
  { w: '居酒屋', g: 1, u: 1, sch: ['blackOnWhite', 'whiteOnRed', 'redOnCream', 'whiteOnBlack'], fmt: 'pre', noren: 1 },
  { w: '焼肉', g: 1, u: 1, sch: ['whiteOnRed', 'redOnYellow', 'whiteOnBlack'], fmt: 'pre' },
  { w: 'お好み焼', g: 1, u: 1, sch: ['redOnCream', 'whiteOnRed', 'blackOnYellow'], fmt: 'pre', noren: 1 },
  { w: '割烹', g: 1, u: 1, sch: ['blackOnWhite', 'whiteOnBlack', 'brownOnCream'], fmt: 'pre', noren: 1 },
  { w: '定食', g: 1, u: 0, sch: ['redOnWhite', 'blackOnWhite', 'whiteOnRed'], fmt: 'bare', noren: 1 },
  { w: '洋酒', g: 0, u: 1, sch: ['goldOnMaroon', 'whiteOnBlack'], fmt: 'pre', kana: 1 },
  { w: '金融', g: 0, u: 1, sch: ['whiteOnBlue', 'blueOnWhite', 'whiteOnGreen'], fmt: 'suf', suf: ['ローン', '商事'] },
  { w: '質', g: 1, u: 0, sch: ['blackOnWhite', 'whiteOnBlue'], fmt: 'pre' },
  { w: '碁会所', g: 0, u: 1, sch: ['blackOnWhite', 'brownOnCream'], fmt: 'bare' },
  { w: '書店', g: 1, u: 0, sch: ['greenOnWhite', 'blueOnWhite'], fmt: 'suf', suf: ['書店', '書房'] },
  { w: 'レコード', g: 1, u: 1, sch: ['whiteOnOrange', 'blackOnYellow', 'whiteOnBlue', 'redOnWhite'], fmt: 'pre' },
  { w: '靴', g: 1, u: 0, sch: ['blackOnWhite', 'whiteOnBrown'], fmt: 'suf', suf: ['靴店'] },
  { w: '洋菓子', g: 1, u: 0, sch: ['pinkOnWhite', 'brownOnCream', 'navyOnSky'], fmt: 'pre', kana: 1 },
  { w: 'ゲームセンター', g: 1, u: 0, sch: ['whiteOnRed', 'yellowOnBlack', 'whiteOnBlue'], fmt: 'bare' },
  { w: '診療所', g: 0, u: 1, sch: ['greenOnWhite', 'blueOnWhite'], fmt: 'suf', suf: ['診療所', '医院'] },
  { w: '歯科', g: 0, u: 1, sch: ['greenOnWhite', 'blueOnWhite'], fmt: 'suf', suf: ['歯科'] },
];
export const TRADE_BY_WORD = Object.fromEntries(TRADES.map((t) => [t.w, t]));

// FICTIONAL name parts (invented; generic words that are not trademarks of period businesses).
export const NAME_STEMS = [
  '白鳥', '千鳥', '若葉', '桔梗', '花月', '月光', '銀河', '紫苑', '鈴蘭', '白樺', '千草', '夕霧', '志野', '葵', '楓', '桂',
  '藤', '梅', '浜', '松葉', '若竹', '寿', '福', '春日', '秋月', '雪', '星', '虹', '泉', '都', '京', '雅', '栄', '鶴', '亀',
  '鈴', '蘭', '舞', '渚', '港', '岬', '柳', '桜', '椿', '萩', '蓮', '牡丹', '撫子', '水仙', '朝顔', '山茶花', '小菊', '芙蓉',
  '一休', '大吉', '万福', '八重', '三笠', '加賀', '伊予', '銀座', '浪花', '博多', '長崎', '小町', '静', '紅葉', '翠', '琥珀',
];
export const KANA_NAMES = [
  'ルミ', 'エミ', 'マリ', 'ユキ', 'リラ', 'ミモザ', 'カトレア', 'ポエム', 'ロマン', 'モナ', 'ジュン', 'アカネ', 'ミキ', 'サチ',
  'ナナ', 'ルナ', 'エリカ', 'ララ', 'ピエロ', 'ベル', 'ノエル', 'シャルム', 'パピヨン', 'マロン', 'オリーブ', 'ルージュ', 'コロン',
  'カメリア', 'アゼリア', 'セーヌ', 'ローザ', 'ブーケ', 'フルール', 'アミ', 'ロンド', 'メルシー', 'ドンナ', 'ジョイ', 'メロディ',
  'オアシス', 'カルメン', 'ボレロ', 'ナポリ', 'ローマ', 'ウィーン', 'シャトー', 'エトワール', 'ラビアン', 'モンテ', 'リリー',
  'さゆり', 'みどり', 'あけみ', 'ひろみ', 'ゆかり', 'しのぶ', 'かおる', 'のぞみ',
];
// Never generate these (real local/period businesses, brands, landmark names reserved for adopted text).
export const BLOCKLIST = ['コマ', 'ミラノ', 'ハイツ', 'スカラ', 'ジャンボ', 'ロッテ', 'ルノアール', '滝沢', '風月堂', '中村屋', '高野',
  '紀伊國屋', '伊勢丹', '三越', '丸井', '東宝', '松竹', '東映', '日活', '大映', 'キリン', 'サッポロ', 'アサヒ', 'サントリー', '宝'];

export const PHRASES = ['営業中', '冷房完備', '冷暖房完備', '年中無休', '深夜営業', '貸室あり', 'ご宴会承ります', 'お食事', '喫茶・軽食',
  '生ビール', '洋酒', '初心者歓迎', '明朗会計', 'ランチタイム', 'お持ち帰り', '御予約承ります', '大衆割烹', '各種宴会', '朝まで営業'];
export const UPPER_ONLY_PHRASES = ['空室あり', '貸事務所', 'テナント募集'];
export const MENU = {
  喫茶: ['コーヒー 150円', '紅茶 150円', 'ミルク 120円', 'ジュース 180円', 'ケーキセット 300円', 'トースト 100円'],
  食事: ['定食 350円', 'ラーメン 250円', 'カレーライス 280円', 'チャーハン 300円', 'ギョーザ 180円', 'もりそば 200円', 'かつ丼 400円', '親子丼 350円'],
  酒: ['ビール 350円', '酒 一合 250円', 'ハイボール 200円', 'おでん 一皿 300円', 'やきとり 一本 60円', 'つまみ各種'],
};
export const NOREN_WORDS = { ラーメン: ['ラーメン', '中華そば'], 寿司: ['寿司', 'すし'], 焼鳥: ['焼鳥', 'やきとり'], 酒場: ['酒', '酒処'], 大衆酒場: ['酒', 'のみ処'],
  とんかつ: ['とんかつ'], 天ぷら: ['天ぷら'], そば: ['そば', '生そば'], 甘味: ['甘味', 'あんみつ'], 居酒屋: ['酒処', 'のみ処'], お好み焼: ['お好み焼'],
  割烹: ['割烹'], 定食: ['めし', '定食'], 食堂: ['めし', '御食事処'] };

/** Fictional 1970s-format 7-digit Tokyo number (3-digit exchange + 4); not dialable today. */
export function phone(r) {
  const ex = r.pick(['200', '202', '204', '205', '207', '208', '209', '232', '354', '356']);
  return `TEL ${ex}-${String(r.int(0, 9999)).padStart(4, '0')}`;
}

/** Make a shop name. Returns { text, trade, name, fictional }. */
export function shopName(r, trade) {
  const t = typeof trade === 'string' ? TRADE_BY_WORD[trade] || { w: trade, fmt: 'pre' } : trade;
  if (t.fmt === 'bare') return { text: t.w, trade: t.w, name: null, fictional: false };
  const kana = t.kana && r.chance(0.65);
  const stem = kana ? r.pick(KANA_NAMES) : r.pick(NAME_STEMS);
  if (t.fmt === 'suf') {
    const suf = r.pick(t.suf);
    // e.g. 麻雀 + 白鳥荘, 中華料理 + 桂林?  keep two-part reading: trade word shown separately by caller
    return { text: `${stem}${suf}`, trade: t.w, name: `${stem}${suf}`, fictional: true };
  }
  return { text: stem, trade: t.w, name: stem, fictional: true };
}

export function floorLabel(n, r) {
  if (n <= 0) return 'B1';
  return r.chance(0.7) ? `${n}F` : `${n}階`;
}
