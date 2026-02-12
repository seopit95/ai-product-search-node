import { qdrant } from "./qdrant.js";

async function createCollection() {
  await qdrant.createCollection("test_products", {
    vectors: {
      dense: {
        size: 1536,
        distance: "Cosine"
      }
    },
    sparse_vectors: {
      sparse: {}
    }
  })
  console.log("컬렉션 생성 완료");
}

createCollection();
