// Vercel Edge Function: /api/azuki-chat.js
import OpenAI from "openai";
export const config = { runtime: "edge" };
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CONFIG_URL = process.env.CONFIG_URL || "https://<your-project>.vercel.app/config.json";
let CACHE = { data:null, ts:0 };
async function loadConfig(){
  const now = Date.now();
  if (CACHE.data && now - CACHE.ts < 10*60*1000) return CACHE.data;
  const r = await fetch(CONFIG_URL, { cache:"no-store" });
  if(!r.ok) throw new Error("config fetch failed");
  const data = await r.json(); CACHE = { data, ts: now }; return data;
}
function sse(t){ return new TextEncoder().encode(`data: ${t}\n\n`); }

export default async function handler(req){
  try{
    const { question, history = [] } = await req.json();
    if(!question) return new Response(JSON.stringify({error:"No question"}), {status:400});

    const cfg = await loadConfig();
    const p = cfg.persona, pol = cfg.policies;
    const SYSTEM_PROMPT = `
あなたは「あずきちゃん」。${p.bio}
一人称は「${p.first_person}」。口調は${p.tone}
回答は「結論→箇条書き→補足」。日本語優先、英語質問には英語で返答。
初回あいさつ：${p.greeting}
自己紹介：${p.one_liner}
注意：- ${pol.caution.join("\n- ")}
紹介：提供リストにアフィリンクがあれば必ず表示。DomoAIは[公式サイト 10%引き](${cfg.recommend_ai[0].items[0].affiliate})を添える。
最後に「${p.signoff}」を添える。`.trim();

    const messages = [
      { role:"system", content:SYSTEM_PROMPT },
      ...history.map(m=>({role:m.role, content:m.content})),
      { role:"user", content:question }
    ];

    const stream = await client.chat.completions.create({
      model: "gpt-4o-mini", messages, temperature: 0.7, stream: true
    });

    const readable = new ReadableStream({
      async start(controller){
        for await (const chunk of stream){
          const delta = chunk?.choices?.[0]?.delta?.content || "";
          if (delta) controller.enqueue(sse(delta));
        }
        controller.enqueue(sse("[DONE]")); controller.close();
      }
    });

    return new Response(readable, {
      headers:{
        "Content-Type":"text/event-stream; charset=utf-8",
        "Cache-Control":"no-cache, no-transform",
        "Connection":"keep-alive",
        "Access-Control-Allow-Origin":"*"
      }
    });
  }catch(e){
    return new Response(JSON.stringify({error:"Server Error"}), {status:500});
  }
}
