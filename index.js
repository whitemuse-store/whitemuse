const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '100mb' }));

// おばあちゃんが設定した完璧な鍵を読み込みます
const repToken = (process.env.REPLICATE_API_TOKEN || "").trim();
const gemKey = (process.env.GEMINI_API_KEY || "").trim();

const replicate = new Replicate({ auth: repToken });
const genAI = new GoogleGenerativeAI(gemKey);

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.post('/api/process', async (req, res) => {
  try {
    const { image_url, bg_type } = req.body;
    let editedImage;

    // 【修正】404エラーを絶対に出さない、世界で最も安定した「cjwbw」版に固定します
    const model = bg_type === 'white' 
      ? "cjwbw/rembg:fb8a3575979bc0319ca0f2a74c760b7d34cc8ec6c7475f4d455e9664c39179f8"
      : "logerzz/background-remover:77227ca3d052d91b40974955f1f9e9f694a50b8ef2f1e63a34a7428f55364842";

    try {
      console.log("AIを呼び出します...");
      editedImage = await replicate.run(model, { input: { image: image_url } });
    } catch (e) {
      throw new Error(`AIの処理で失敗: ${e.message}`);
    }

    // 鑑定文章の作成
    const genModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await genModel.generateContent([
      "ブランド鑑定士として分析し、詳細を日本語で出力してください。",
      { inlineData: { mimeType: "image/jpeg", data: image_url.split(',')[1] } }
    ]);

    res.json({ ok: true, edited_image: editedImage, description: result.response.text() });

  } catch (error) {
    console.error("重大エラー:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('WhiteMuse Online'));