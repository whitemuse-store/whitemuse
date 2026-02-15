const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' })); // 大量処理用に制限を緩和

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 画面を表示するための設定
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/process', async (req, res) => {
  try {
    const { image_url } = req.body;
    
    // 1. Replicateで背景削除（職人仕事）
    const editedImage = await replicate.run(
      "lucataco/remove-bg:95fcc2a21d565684d2a43a8b5d4bc46197e33da0c68230a5ca54bc7030ce8741",
      { input: { image: image_url } }
    );

    // 2. Geminiで鑑定・執筆（脳の仕事）
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = `高級ブランド鑑定士として、この画像を分析し以下を日本語で出力してください。
    1.【鑑定】ブランド・モデル・素材・色
    2.【出品文】高級感のある紹介文
    3.【価格】推定販売価格`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: "image/jpeg", data: Buffer.from(await fetch(image_url).then(r => r.arrayBuffer())).toString("base64") } }
    ]);

    res.json({ ok: true, edited_image: editedImage, description: result.response.text() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse v1.0 稼働中`));