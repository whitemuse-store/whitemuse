const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
// 50枚の一括処理に耐えられるよう、データの通り道を広げます
app.use(express.json({ limit: '100mb' }));

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/process', async (req, res) => {
  try {
    const { image_url } = req.body;
    if (!image_url) throw new Error("画像が届いていません");

    // 1. 【背景削除】最新かつ非常に安定した公式モデルを使用
    // 被写体の輪郭を正確に残し、背景を透過・白化します
    const editedImage = await replicate.run(
      "lucataco/remove-bg:95fcc2a21d565684d2a43a8b5d4bc46197e33da0c68230a5ca54bc7030ce8741",
      { input: { image: image_url } }
    );

    // 2. 【鑑定・執筆】Gemini 2.0 Flash
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const base64Data = image_url.split(',')[1];
    
    const prompt = `あなたは高級ブランド専門の鑑定士です。画像の商品を分析し、以下を日本語で出力してください。
    【鑑定】ブランド名、モデル名、素材、色
    【出品文】プロらしい上品な紹介文（使用感があれば正直に）
    【推定価格】現在の市場相場に基づく価格帯
    ※誠実に、見たままを記述してください。`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: "image/jpeg", data: base64Data } }
    ]);

    res.json({ 
      ok: true, 
      edited_image: editedImage, 
      description: result.response.text() 
    });

  } catch (error) {
    console.error("エラー:", error);
    // エラーの中身を画面に詳しく出すようにして、原因を特定しやすくします
    res.status(500).json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse 稼働中`));