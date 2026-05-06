import axios from "axios";
import Product from "../models/products.js";

export const sendProductsToAI = async () => {
  if (!process.env.AI_SERVICE_URL) {
    console.log("⏭️  AI_SERVICE_URL not set — skipping daily AI sync");
    return;
  }

  try {
    // 1️⃣ Fetch products from DB
    const products = await Product.find(
      { isAvailable: true },
      "productName sellerName howManyproductsSold"
    );

    // 2️⃣ Build keywords
    const keywords = products.map(p => ({
      productId: p._id,
      keyword: `${p.sellerName} ${p.productName}`,
      soldCount: p.howManyproductsSold
    }));

    console.log("🔹 Keywords being sent to AI:", keywords);

    // 3️⃣ Send to AI service
    await axios.post(
      `${process.env.AI_SERVICE_URL}/analyze`,
      { products: keywords },
      {
        headers: {
          "x-api-key": process.env.AI_SERVICE_KEY
        }
      }
    );

    console.log("✅ Product keywords sent to AI service");
  } catch (error) {
    console.error("❌ Failed to send products to AI:", error.message);
  }
};
