const cache = new Map();

function encodeSvg(svg) {
  // Keep it simple and robust for inline <img src>.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function loadPieceSrc(pieceCode) {
  if (cache.has(pieceCode)) return cache.get(pieceCode);
  const url = `/assets/pieces/${pieceCode}.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Missing piece asset: ${url}`);
  const svg = await res.text();
  const src = encodeSvg(svg);
  cache.set(pieceCode, src);
  return src;
}

export const pieceLetterToCode = (letter) => {
  const isUpper = letter === letter.toUpperCase();
  const color = isUpper ? "w" : "b";
  const p = letter.toLowerCase();
  const map = { p: "p", r: "r", n: "n", b: "b", q: "q", k: "k" };
  return `${color}${map[p]}`;
};

