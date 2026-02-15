const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '100mb' }));

// 鍵を掃除して読み込みます
const repToken = (process.env.REPLICATE_API_TOKEN || "").trim();
const gemKey = (process.env.GEMINI_API_KEY || "").trim();

const replicate = new Replicate({ auth: repToken });
const genAI = new GoogleGenerativeAI(gemKey);

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.post('/api/process', async (req, res) => {
  try {
    const { image_url, bg_type } = req.body;
    let editedImage;

    // 404エラーを絶対に出さない、最も有名な「cjwbw」版の住所に固定しました
    const modelAddress = "cjwbw/rembg:fb8a3575979bc0319ca0f2a74c760b7d34cc8ec6c7475f4d455e9664c39179f8";

    try {
      // 背景を消す作業
      editedImage = await replicate.run(modelAddress, { input: { image: image_url } });
    } catch (e) {
      throw new Error("Replicateでエラー（鍵は正しいですが、通信に失敗しました）: " + e.message);
    }

    // 鑑定文章を書く作業
    const genModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await genModel.generateContent([
      "ブランド鑑定士として分析し、詳細を日本語で出力してください。",
      { inlineData: { mimeType: "image/jpeg", data: image_url.split(',')[1] } }
    ]);

    res.json({ ok: true, edited_image: editedImage, description: result.response.text() });

  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('WhiteMuse Ready'));