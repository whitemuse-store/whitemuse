const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '100mb' }));

// 有料の鍵を使って、最高速度で動かします
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.post('/api/process', async (req, res) => {
  try {
    const { image_url, bg_type } = req.body;
    let editedImage;
    if (bg_type === 'white') {
      // 2026年現在、最も安定している「cjwbw」版の白背景ツール
      editedImage = await replicate.run(
        "cjwbw/rembg:fb8a3575979bc0319ca0f2a74c760b7d34cc8ec6c7475f4d455e9664c39179f8",
        { input: { image: image_url } }
      );
    } else {
      // ホテル背景などの合成ツール（型番を最新版に修正しました）
      editedImage = await replicate.run(
        "logerzz/background-remover:77227ca3d052d91b40974955f1f9e9f694a50b8ef2f1e63a34a7428f55364842",
        { input: { image: image_url, background_prompt: bg_type } }
      );
    }
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent([
      "ブランド鑑定士として分析し、詳細と推定価格を日本語で出力してください。",
      { inlineData: { mimeType: "image/jpeg", data: image_url.split(',')[1] } }
    ]);
    res.json({ ok: true, edited_image: editedImage, description: result.response.text() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse 最終稼働開始`));