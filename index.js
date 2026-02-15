const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/process', async (req, res) => {
  try {
    const { image_url } = req.body;
    if (!image_url) throw new Error("画像が届いていません");

    // 1. 背景削除 (最新の安定版ツールに変更)
    // 職人AIが背景を真っ白にします
    const editedImage = await replicate.run(
      "cjwbw/rembg:fb8a3575979bc0319ca0f2a74c760b7d34cc8ec6c7475f4d455e9664c39179f8",
      { input: { image: image_url } }
    );

    // 2. 鑑定・執筆 (Gemini 2.0 Flash)
    // 爆速で正確な日本語を書きます
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const base64Data = image_url.split(',')[1];
    
    const prompt = `あなたは高級ブランド専門の鑑定士です。画像の商品を分析し、以下を日本語で出力してください。
    【鑑定】ブランド名、モデル名、素材、色
    【出品文】プロらしい上品な紹介文（使用感があれば正直に）
    【推定価格】現在の市場相場に基づく価格帯
    ※「被写体を変えない」ルールに基づき、見たままを誠実に記述してください。`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: "image/jpeg", data: base64Data } }
    ]);

    res.json({ ok: true, edited_image: editedImage, description: result.response.text() });
  } catch (error) {
    console.error("エラー詳細:", error);
    res.status(500).json({ ok: false, error: "処理に失敗しました。もう一度お試しください。" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse 稼働中`));