const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '100mb' }));

// 最新の「有料枠」の鍵で動かします
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.post('/api/process', async (req, res) => {
  try {
    const { image_url, bg_type } = req.body;
    
    // 1. 背景処理：絶対に形を崩さない最新・安定版のハサミ
    let editedImage;
    if (bg_type === 'white') {
      // 被写体の形を100%守る、最も安定した白背景ツール
      editedImage = await replicate.run(
        "cjwbw/rembg:fb8a3575979bc0319ca0f2a74c760b7d34cc8ec6c7475f4d455e9664c39179f8",
        { input: { image: image_url } }
      );
    } else {
      // ホテル背景などの合成（有料版なので爆速です）
      editedImage = await replicate.run(
        "logerzz/background-remover:77227ca3d052d91b40974955f1f9e9f694a50b8ef2f1e63a34a7428f55364842",
        { input: { image: image_url, background_prompt: bg_type } }
      );
    }

    // 2. 鑑定執筆：Gemini 2.0 Flash (有料枠1 なので制限なし)
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const base64Data = image_url.split(',')[1];
    const prompt = `あなたは高級ブランド専門の鑑定士です。画像の商品を分析し、以下を日本語で出力してください。\n【鑑定】ブランド名、モデル名、素材、色\n【出品文】プロらしい上品な紹介文\n【推定価格】市場相場に基づく価格帯`;

    const result = await model.generateContent([
      prompt, { inlineData: { mimeType: "image/jpeg", data: base64Data } }
    ]);

    res.json({ ok: true, edited_image: editedImage, description: result.response.text() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse 最終版 稼働中`));