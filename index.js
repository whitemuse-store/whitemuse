const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' })); // 大きな写真も受け取れるように設定

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/process', async (req, res) => {
  try {
    const { image_url } = req.body;
    if (!image_url) throw new Error("画像が届いていません");

    // 画像データをAIが読み込める形に整理
    const base64Data = image_url.split(',')[1];

    // 1. 背景削除 (Replicate)
    // 職人AIに「このデータを加工して」と直接渡す形に変更
    const editedImage = await replicate.run(
      "lucataco/remove-bg:95fcc2a21d565684d2a43a8b5d4bc46197e33da0c68230a5ca54bc7030ce8741",
      { input: { image: image_url } }
    );

    // 2. 鑑定・執筆 (Gemini)
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = "高級ブランド鑑定士として、この画像を分析し【鑑定結果】【出品文】【想定価格】を日本語で出力してください。嘘は書かないでください。";

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: "image/jpeg", data: base64Data } }
    ]);

    res.json({ ok: true, edited_image: editedImage, description: result.response.text() });
  } catch (error) {
    console.error("エラー詳細:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse 稼働中`));