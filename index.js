import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/*
 WhiteMuse v1.0
 出品文生成専用API（確定版）
 ・日本語のみをAIに強制
 ・後処理で文章を壊さない
*/

app.post("/generate", async (req, res) => {
  try {
    const inputText = req.body?.input?.text;

    if (!inputText) {
      return res.status(400).json({
        ok: false,
        error: "input.text がありません"
      });
    }

    const prompt = `
あなたは日本のEC（メルカリ・ヤフオク）専用の出品文作成AIです。

【絶対ルール】
・出力は日本語のみ
・英語・前置き・挨拶・感想は禁止
・写真にない情報は書かない
・不明点は「写真参照」と書く
・事実のみ、簡潔

【入力情報】
${inputText}

【出力形式】
■商品名
■ポイント
■状態
■付属品
■注意

最後は必ず：
※状態・サイズは写真参照のうえご判断ください。
`.trim();

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "日本語のEC出品文のみを生成するAIです。" },
          { role: "user", content: prompt }
        ],
        temperature: 0.1
      })
    });

    const data = await response.json();
    const resultText = data.choices?.[0]?.message?.content?.trim();

    if (!resultText) {
      return res.json({
        ok: false,
        error: "生成結果が空でした"
      });
    }

    return res.json({
      ok: true,
      mode: "text",
      result: resultText
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      ok: false,
      error: "Internal server error"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
