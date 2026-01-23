import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// JSON 파싱
app.use(express.json());
app.use(cors());

// ⭐ public 폴더를 정적 파일로 노출
app.use(express.static("public"));

// AI 채팅 API
app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  // 임시 응답 (여기서 OpenAI 연동)
  res.json({
    reply: `당신의 질문: "${userMessage}"`
  });
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});