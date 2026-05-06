import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Lazy init ──
let _claude = null;
let _geminiModel = null;
let _inited = false;

function init() {
  if (_inited) return;
  _inited = true;

  if (process.env.SERPER_API_KEY)
    console.log("🔍 AI Product Controller → Serper (web search) enabled");

  if (process.env.CLAUDE_API_KEY) {
    _claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    console.log("🤖 AI Product Controller → Claude enabled");
  }
  if (process.env.GEMINI_API_KEY) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    _geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    console.log("🤖 AI Product Controller → Gemini enabled");
  }
}

// ── Caches ──
const suggestionCache = new Map();
const detailsCache = new Map();
const CACHE_TTL_SUGGEST = 5 * 60 * 1000;
const CACHE_TTL_DETAILS = 30 * 60 * 1000;

// ── Serper helpers ──
async function serperSearch(query, type = "search") {
  if (!process.env.SERPER_API_KEY) {
    return null;
  }

  const url =
    type === "shopping"
      ? "https://google.serper.dev/shopping"
      : "https://google.serper.dev/search";

  const { data } = await axios.post(
    url,
    { q: query, num: 10 },
    { headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" } }
  );
  return data;
}

// ── LLM helper (optional enhancement, tries Claude → Gemini) ──
async function askAI(prompt) {
  init();

  if (_claude) {
    try {
      const m = await _claude.messages.create({
        model: "claude-3-5-haiku-latest",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      return m.content[0].text.trim();
    } catch (e) {
      console.warn("⚠️  Claude failed:", e.message);
    }
  }

  if (_geminiModel) {
    try {
      const r = await _geminiModel.generateContent(prompt);
      return r.response.text().trim();
    } catch (e) {
      console.warn("⚠️  Gemini failed:", e.message);
    }
  }

  return null; // no LLM available
}

// ── Category mapper ──
const CATEGORIES = ["Electronics", "Fashion", "Home", "Beauty", "Sports"];
const CATEGORY_KEYWORDS = {
  Electronics: ["phone", "laptop", "tablet", "tv", "camera", "headphone", "speaker", "watch", "computer", "monitor", "keyboard", "mouse", "console", "gaming", "earbuds", "charger", "drone", "smart", "bluetooth", "wireless", "audio", "video", "usb", "iphone", "samsung", "galaxy", "macbook", "ipad", "airpods", "playstation", "xbox", "nintendo"],
  Fashion: ["shirt", "dress", "shoe", "sneaker", "jacket", "pant", "jeans", "hoodie", "hat", "bag", "handbag", "sunglasses", "boots", "sandal", "wear", "cloth", "apparel", "nike", "adidas", "gucci", "zara"],
  Home: ["sofa", "table", "lamp", "chair", "bed", "mattress", "pillow", "kitchen", "blender", "vacuum", "curtain", "rug", "decor", "furniture", "shelf", "appliance", "microwave", "oven", "fridge", "dishwasher"],
  Beauty: ["cream", "serum", "makeup", "lipstick", "perfume", "shampoo", "lotion", "skincare", "mascara", "foundation", "moisturizer", "fragrance", "cologne", "cosmetic", "nail", "hair"],
  Sports: ["ball", "racket", "bike", "bicycle", "gym", "yoga", "treadmill", "fitness", "weight", "dumbbell", "jersey", "glove", "bat", "helmet", "skateboard", "surf", "swim", "run", "hiking", "camping", "outdoor"],
};

function guessCategory(text) {
  const lower = text.toLowerCase();
  let best = "Electronics";
  let bestScore = 0;
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = words.filter((w) => lower.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}

// ── Extract brand from product title ──
function extractBrand(title) {
  const known = ["Apple", "Samsung", "Google", "Sony", "LG", "Microsoft", "Dell", "HP", "Lenovo", "Asus", "Acer", "Nike", "Adidas", "Puma", "Reebok", "Canon", "Nikon", "Bose", "JBL", "Dyson", "Philips", "Xiaomi", "OnePlus", "Huawei", "Oppo", "Vivo", "Realme", "Nothing", "Razer", "Logitech"];
  for (const b of known) {
    if (title.toLowerCase().includes(b.toLowerCase())) return b;
  }
  // Product-line to brand mapping for common products
  const productBrands = { iphone: "Apple", ipad: "Apple", macbook: "Apple", airpods: "Apple", imac: "Apple", "apple watch": "Apple", galaxy: "Samsung", pixel: "Google", surface: "Microsoft", playstation: "Sony", xbox: "Microsoft", kindle: "Amazon", echo: "Amazon", thinkpad: "Lenovo", "rog ": "Asus", redmi: "Xiaomi", poco: "Xiaomi" };
  const lower = title.toLowerCase();
  for (const [key, brand] of Object.entries(productBrands)) {
    if (lower.includes(key)) return brand;
  }
  return title.split(/\s+/)[0];
}

// ──────────────────────────────────────────────
// POST /api/ai/product-suggest
// ──────────────────────────────────────────────
export const getProductSuggestions = async (req, res) => {
  const { query } = req.body;
  init();

  if (!query || typeof query !== "string" || query.trim().length < 2) {
    return res.json({ suggestions: [] });
  }

  const cacheKey = query.trim().toLowerCase();
  if (suggestionCache.has(cacheKey)) {
    return res.json({ suggestions: suggestionCache.get(cacheKey) });
  }

  try {
    // ── Primary: Serper web search ──
    if (process.env.SERPER_API_KEY) {
      const data = await serperSearch(`${query.trim()} product`);
      if (!data) return res.json({ suggestions: [] });

      const titles = new Set();

      // Extract from organic results
      if (data.organic) {
        for (const r of data.organic) {
          if (r.title) {
            // Clean common suffixes like "- Amazon.com", "| Best Buy", "- Wikipedia" etc.
            let clean = r.title
              .replace(/\s*[-–|:]\s*(Amazon|Best Buy|Walmart|eBay|Target|Newegg|B&H|Wikipedia|Tech|CNET|Forbes|Verge|GSMArena|Tom'?s?\s*Guide|Samsung|Apple|Google Store).*$/i, "")
              .replace(/\s*[-–|]\s*\d{4}.*$/, "")
              .replace(/\s*(Buy|Shop|Order|Price|Review|Specs|Deal|Compare|Official|Site).*$/i, "")
              .replace(/\b(Introducing|Differences between the|Which|Features & Highlights)\b.*$/i, "")
              .replace(/[:\-–|&]+\s*$/, "")  // trailing colons/dashes/ampersands
              .replace(/,\s*(US Version|International|Renewed|Refurbished)\b/i, "")
              .trim();
            // Skip titles that look like articles, not product names
            if (clean.length > 3 && clean.length < 120 && !/^(How|Why|What|Which|Where|When|Introducing|Differences)\b/i.test(clean)) {
              titles.add(clean);
            }
          }
        }
      }

      // Also pull from shopping results for clean product titles
      if (data.shopping) {
        for (const item of data.shopping.slice(0, 4)) {
          if (item.title) {
            let clean = item.title.replace(/\s*[-–|].*$/, "").trim();
            if (clean.length > 3 && clean.length < 100) titles.add(clean);
          }
        }
      }

      // Also check "relatedSearches" for extra product names
      if (data.relatedSearches) {
        for (const rs of data.relatedSearches.slice(0, 3)) {
          if (rs.query) titles.add(rs.query);
        }
      }

      const suggestions = [...titles].slice(0, 6);

      if (suggestions.length > 0) {
        suggestionCache.set(cacheKey, suggestions);
        setTimeout(() => suggestionCache.delete(cacheKey), CACHE_TTL_SUGGEST);
        return res.json({ suggestions });
      }
    }

    // ── Fallback: LLM ──
    const prompt = `You are a product catalog assistant for an ecommerce platform.
Given the partial product query: "${query.trim()}"

Return up to 6 specific, real, well-known product names that closely match this query.
Include variations (e.g. different models, capacities, or editions).

Return ONLY a raw JSON array of strings — no markdown, no code blocks, no explanation.
Example: ["Apple iPhone 15","Apple iPhone 15 Pro","Apple iPhone 15 Pro Max"]`;

    const text = await askAI(prompt);
    if (text) {
      const match = text.match(/\[[\s\S]*?\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter((s) => typeof s === "string").slice(0, 6);
          suggestionCache.set(cacheKey, clean);
          setTimeout(() => suggestionCache.delete(cacheKey), CACHE_TTL_SUGGEST);
          return res.json({ suggestions: clean });
        }
      }
    }

    return res.json({ suggestions: [] });
  } catch (err) {
    console.error("❌ AI product-suggest error:", err.message);
    return res.status(500).json({ error: "AI suggestion failed", suggestions: [] });
  }
};

// ──────────────────────────────────────────────
// POST /api/ai/product-details
// ──────────────────────────────────────────────
export const getProductDetails = async (req, res) => {
  const { product_name } = req.body;
  init();

  if (!product_name || typeof product_name !== "string") {
    return res.status(400).json({ error: "product_name is required" });
  }

  const cacheKey = product_name.trim().toLowerCase();
  if (detailsCache.has(cacheKey)) {
    return res.json(detailsCache.get(cacheKey));
  }

  try {
    // ── Try LLM first (best structured output) ──
    const llmPrompt = `You are a product catalog assistant with comprehensive knowledge of consumer products.
Extract structured product data for: "${product_name.trim()}"

Return ONLY a raw JSON object — no markdown, no code blocks, no extra text.
Use exactly this structure:

{
  "name": "full official product name",
  "brand": "brand/manufacturer name",
  "category": "exactly one of: Electronics, Fashion, Home, Beauty, Sports",
  "description": "2–3 sentence factual product description covering key features and highlights",
  "images": [],
  "variants": [
    {
      "variantName": "human-readable variant label e.g. 128GB Midnight Black",
      "color": "color name or empty string",
      "storage": "storage/capacity value or empty string",
      "size": "size value or empty string",
      "image": ""
    }
  ]
}

Rules:
- category must be exactly one of: Electronics, Fashion, Home, Beauty, Sports
- variants must reflect the real options for this product (colors, storage tiers, sizes, etc.)
- Keep variants to a maximum of 8 entries
- images must always be an empty array (admin will supply later)
- description must be factual, professional, and concise`;

    const llmText = await askAI(llmPrompt);
    if (llmText) {
      const match = llmText.match(/\{[\s\S]*\}/);
      if (match) {
        const details = JSON.parse(match[0]);
        if (details.name && details.brand && details.category) {
          details.images = [];
          if (!Array.isArray(details.variants)) details.variants = [];
          detailsCache.set(cacheKey, details);
          setTimeout(() => detailsCache.delete(cacheKey), CACHE_TTL_DETAILS);
          return res.json(details);
        }
      }
    }

    // ── Fallback: Serper Shopping + regular search ──
    if (process.env.SERPER_API_KEY) {
      const [shopData, searchData] = await Promise.all([
        serperSearch(product_name.trim(), "shopping"),
        serperSearch(`${product_name.trim()} specifications variants colors`),
      ]);

      const brand = extractBrand(product_name.trim());
      const category = guessCategory(product_name.trim());

      // Build description from search snippets
      let description = "";
      if (searchData && searchData.organic && searchData.organic.length > 0) {
        const snippets = searchData.organic
          .slice(0, 3)
          .map((r) => r.snippet)
          .filter(Boolean);
        description = snippets.join(" ").substring(0, 500);
      }
      if (!description) {
        description = `${product_name.trim()} by ${brand}. A popular product in the ${category} category.`;
      }

      // Extract variants from shopping results
      const variants = [];
      const seenNames = new Set();
      if (shopData && shopData.shopping) {
        for (const item of shopData.shopping.slice(0, 8)) {
          const vName = item.title || "";
          const shortName = vName.substring(0, 80);
          if (seenNames.has(shortName.toLowerCase())) continue;
          seenNames.add(shortName.toLowerCase());

          // Try to detect color/storage from title
          const colorMatch = vName.match(/\b(Black|White|Blue|Red|Green|Gold|Silver|Gray|Grey|Pink|Purple|Yellow|Orange|Midnight|Starlight|Titanium|Cream|Natural|Graphite|Space Gray)\b/i);
          const storageMatch = vName.match(/\b(\d+\s?(?:GB|TB))\b/i);
          const sizeMatch = vName.match(/\b((?:X?S|S|M|L|X?L|XXL|\d{1,2}(?:\.\d)?[\s-]?(?:inch|"|cm)))\b/i);

          variants.push({
            variantName: shortName,
            color: colorMatch ? colorMatch[1] : "",
            storage: storageMatch ? storageMatch[1] : "",
            size: sizeMatch ? sizeMatch[1] : "",
            image: "",
          });
        }
      }

      const details = {
        name: product_name.trim(),
        brand,
        category,
        description,
        images: [],
        variants: variants.length > 0 ? variants : [{ variantName: product_name.trim(), color: "", storage: "", size: "", image: "" }],
      };

      detailsCache.set(cacheKey, details);
      setTimeout(() => detailsCache.delete(cacheKey), CACHE_TTL_DETAILS);
      return res.json(details);
    }

    return res.status(500).json({ error: "No AI provider or search API available" });
  } catch (err) {
    console.error("❌ AI product-details error:", err.message);
    return res.status(500).json({ error: "AI details fetch failed" });
  }
};
