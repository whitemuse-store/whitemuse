import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/*
 WhiteMuse v1.0
 出品文生成専用API
 ・日本語のみ
 ・英語・前置き・説明文・感想すべて禁止
 ・写真にない情報は書かない
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
あなたは日本のEC（メルカリ・ヤフオク等）で売るための「出品文作成AI」です。
出力は【日本語のみ】。前置き・説明・感想・英語は禁止。

【絶対禁止】
・英語
・「Here is」「I think」「happy」「help」などの前置き
・中身のない褒め言葉（高級・美しい等）
・写真にない情報（素材断定・型番・サイズ数値・付属品追加）
・推測、憶測

【入力情報（この情報だけ使用）】
${inputText}

【必ずこの形式で出力】
■商品名
■ポイント
■状態
■付属品
■注意

【出力ルール】
・日本語のみ
・6〜10行程度
・事実のみ
・不明点は必ず「写真参照」
・最後は必ず
「※状態・サイズは写真参照のうえご判断ください。」
で締める
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
          { role: "system", content: "You are a Japanese EC listing generator." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2
      })
    });

    const data = await response.json();
    const resultText = data.choices?.[0]?.message?.content || "";

    // 念のため英語を完全排除（保険）
    const japaneseOnly = resultText.replace(/[A-Za-z]/g, "").trim();

    return res.json({
      ok: true,
      mode: "text",
      result: japaneseOnly
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
