const BRAND_SYNONYMS = {
  "Lock&Lock": ["락앤락", "locknlock", "lock&lock"]
};

const BRAND_MAP = new Map([
  ["락앤락", "Lock&Lock"],
  ["locknlock", "Lock&Lock"],
  ["lock&lock", "Lock&Lock"],
]);

const CATEGORY_SYNONYMS = {
  "밀폐용기": ["반찬통", "보관용기", "식재료통", "음식보관"],
  "텀블러": ["보온컵", "보냉컵", "휴대컵", "텀블러컵"],
  "보온병": ["보냉병", "물통", "텀블러"],
  "도시락": ["도시락통", "런치박스", "도시락용기"],
  "물병": ["물통", "보틀"],
  "프라이팬": ["후라이팬", "팬", "코팅팬"],
  "냄비": ["스텐냄비", "조리냄비", "냄비세트"],
  "주방소형가전": ["주방가전", "소형가전", "주방전기"],
};

const CATEGORY_ALIAS = new Map([
  ["후라이팬", "프라이팬"],
  ["프라이팬", "프라이팬"],
  ["팬", "프라이팬"],
  ["텀블러", "텀블러"],
  ["보온컵", "텀블러"],
  ["보냉컵", "텀블러"],
  ["보온병", "보온병"],
  ["보냉병", "보온병"],
  ["도시락", "도시락"],
  ["도시락통", "도시락"],
  ["물병", "물병"],
  ["물통", "물병"],
  ["밀폐용기", "밀폐용기"],
  ["반찬통", "밀폐용기"],
  ["전기포트", "주방소형가전"],
  ["전기주전자", "주방소형가전"],
  ["토스터기", "주방소형가전"],
  ["에어프라이어", "주방소형가전"],
  ["블렌더", "주방소형가전"],
  ["전기밥솥", "주방소형가전"],
  ["전기그릴", "주방소형가전"],
  ["커피메이커", "주방소형가전"],
  ["멀티쿠커", "주방소형가전"],
  ["전기찜기", "주방소형가전"],
]);

const NORMALIZE_REPLACEMENTS = [
  ["전자렌지", "전자레인지"],
  ["렌지", "레인지"],
];

const SPARSE_HASH_BUCKETS = 1 << 18;

function normalizeText(text) {
  if (!text) return "";
  let out = text;
  NORMALIZE_REPLACEMENTS.forEach(([from, to]) => {
    out = out.replaceAll(from, to);
  });
  return out
    .replace(/&/g, " and ")
    .replace(/[^0-9a-zA-Z가-힣\s]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  if (!text) return [];
  const tokens = normalizeText(text).split(" ");
  return tokens.filter((t) => {
    if (!t) return false;
    if (/[a-z0-9]/i.test(t) && t.length < 2) return false;
    return true;
  });
}

function hashToken(token) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildSparseVector(text) {
  const tokens = tokenize(text);
  const freq = new Map();
  tokens.forEach((token) => {
    const idx = hashToken(token) % SPARSE_HASH_BUCKETS;
    freq.set(idx, (freq.get(idx) || 0) + 1);
  });

  const indices = [];
  const values = [];
  let norm = 0;
  [...freq.entries()].sort((a, b) => a[0] - b[0]).forEach(([idx, tf]) => {
    const value = 1 + Math.log(tf);
    indices.push(idx);
    values.push(value);
    norm += value * value;
  });

  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < values.length; i += 1) {
    values[i] /= norm;
  }

  return { indices, values };
}

function normalizeBrand(brand) {
  if (!brand) return null;
  const raw = normalizeText(brand).replace(/\s+/g, "");
  return BRAND_MAP.get(raw) || brand;
}

function normalizeCategory(category) {
  if (!category) return null;
  const raw = normalizeText(category);
  return CATEGORY_ALIAS.get(raw) || category;
}

function expandQueryText(text, filters) {
  const baseTokens = new Set(tokenize(text));
  const extras = new Set();

  const addAll = (arr) => {
    if (!arr) return;
    arr.forEach((token) => {
      const t = normalizeText(token);
      if (t && !baseTokens.has(t)) extras.add(t);
    });
  };

  if (filters?.category) {
    addAll(CATEGORY_SYNONYMS[filters.category]);
  }

  if (filters?.brand && BRAND_SYNONYMS[filters.brand]) {
    addAll(BRAND_SYNONYMS[filters.brand]);
  }

  baseTokens.forEach((token) => {
    const normalizedCategory = CATEGORY_ALIAS.get(token);
    if (normalizedCategory) {
      addAll([normalizedCategory, ...(CATEGORY_SYNONYMS[normalizedCategory] || [])]);
    }
  });

  if (!extras.size) return text;
  return `${text} ${Array.from(extras).join(" ")}`.trim();
}

function buildQueryText({ semantic_query, filters, userMessage }) {
  const base = normalizeText(`${semantic_query} ${userMessage}`);
  const expanded = expandQueryText(base, filters);
  const brand = filters?.brand ? `브랜드: ${filters.brand}` : "";
  const category = filters?.category ? `카테고리: ${filters.category}` : "";
  const price = (filters?.min_price || filters?.max_price)
    ? `가격: ${filters.min_price ?? ""}-${filters.max_price ?? ""}` : "";

  return `
상품명: ${expanded}
설명: ${base}
${brand}
${category}
${price}
  `.trim();
}

function buildDocumentText(item) {
  return `
상품명: ${item.payload.name}
브랜드: ${item.payload.brand}
카테고리: ${item.payload.category}
가격: ${item.payload.price}
설명: ${item.payload.description}
태그: ${item.payload.tags.join(" ")}
  `.trim();
}

export {
  buildDocumentText,
  buildQueryText,
  buildSparseVector,
  normalizeBrand,
  normalizeCategory,
  normalizeText,
  tokenize,
};
