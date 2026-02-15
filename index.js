const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '100mb' }));

// Geminiの鍵だけで動かします
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/process', async (req, res) => {
  try {
    const { image_url, bg_type } = req.body;
    const base64Data = image_url.split(',')[1];

    // Gemini 2.5 Flash (画像編集と文章作成の両方が得意なモデル)
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const bgInstruction = bg_type === 'white' ? "純粋な真っ白な背景(pure white background)" : bg_type;

    // 命令：背景を変えて、かつ鑑定もして
    const prompt = `
      あなたは高級ブランド鑑定士兼、画像編集プロフェッショナルです。
      
      【画像編集】
      ・被写体（バッグ・時計・ジュエリー）の形、ロゴ、質感を1ミリも変えないでください。
      ・背景のみを「${bgInstruction}」に完璧に描き換えた画像を生成してください。
      
      【鑑定執筆】
      ・商品のブランド名、モデル名、素材を特定してください。
      ・プロらしい上品な日本語の出品文を書いてください。
      ・現在の市場価格の目安を教えてください。
    `;

    const result = await model.generateContent([
      { inlineData: { mimeType: "image/jpeg", data: base64Data } },
      { text: prompt }
    ]);

    const response = await result.response;
    const text = response.text();
    
    // Geminiが生成した画像データを取り出す
    const generatedImagePart = response.candidates[0].content.parts.find(p => p.inlineData);
    const edited_image = generatedImagePart 
      ? `data:image/jpeg;base64,${generatedImagePart.inlineData.data}` 
      : image_url; // 編集に失敗した場合は元の画像を表示

    res.json({ ok: true, edited_image: edited_image, description: text });

  } catch (error) {
    console.error(error);
    // 429エラー（混雑）のときはユーザーに優しく伝えます
    const errorMsg = error.message.includes("429") ? "現在無料枠が混み合っています。少し待って自動で再開します。" : error.message;
    res.status(500).json({ ok: false, error: errorMsg });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse 完全無料版 稼働中`));