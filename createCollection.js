import { qdrant } from "./qdrant.js";

async function createCollection() {
  await qdrant.createCollection("test_products", {
    vectors: {
      size: 3,
      distance: "Cosine"
    }
  })
  console.log("컬렉션 생성 완료");
}

createCollection();