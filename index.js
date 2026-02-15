const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '100mb' }));

// お金（数十円〜数百円）を払って、最高の職人と爆速の脳を雇います
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/process', async (req, res) => {
  try {
    const { image_url, bg_type } = req.body;
    if (!image_url) throw new Error("画像が届いていません");

    // 1. 【背景処理】Replicate（専門職人・絶対に形を変えない）
    let editedImage;
    if (bg_type === 'white') {
      editedImage = await replicate.run(
        "lucataco/remove-bg:95fcc2a21d565684d2a43a8b5d4bc46197e33da0c68230a5ca54bc7030ce8741",
        { input: { image: image_url } }
      );
    } else {
      editedImage = await replicate.run(
        "logerzz/background-remover:77227ca3d052d91b40974955f1f9e9f694a50b8ef2f1e63a34a7428f55364842",
        { input: { image: image_url, background_prompt: bg_type } }
      );
    }

    // 2. 【鑑定・執筆】Gemini API 有料枠（爆速のコンサルタント）
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const base64Data = image_url.split(',')[1];
    
    const prompt = `あなたは高級ブランド専門の鑑定士です。画像の商品を分析し、以下を日本語で出力してください。
    【鑑定】ブランド名、モデル名、素材、色
    【出品文】プロらしい上品な紹介文（使用感があれば正直に）
    【推定価格】市場相場に基づく価格帯`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: "image/jpeg", data: base64Data } }
    ]);

    res.json({ ok: true, edited_image: editedImage, description: result.response.text() });

  } catch (error) {
    console.error("エラー:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse 究極のハイブリッド版 稼働中`));