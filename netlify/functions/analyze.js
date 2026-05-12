exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key not configured" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const { type, instrument, rr, news, notes, images, updateImage, updateImage2, sessionContext, conversationHistory } = body;

  // ─── INITIAL ANALYSIS ────────────────────────────────────────────────────────
  if (type === "initial") {
    if (!instrument || !images || images.length !== 4) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing instrument or 4 chart images" }) };
    }

    const minWin = Math.round((1 / (1 + rr)) * 100);

    const systemPrompt = `You are an expert swing trader and technical analyst performing strict 4-timeframe top-down analysis.

CRITICAL PRICE READING RULES:
- Read ALL prices from the RIGHT-HAND price scale of each chart
- DO NOT use O/H/L/C values in the top header bar — those are individual candle values, not current price
- The current price is the highlighted/green label on the right side of the chart

ANALYSIS PROTOCOL — assess in this order:
1. Weekly — macro trend and key levels. REJECT if chart is unclear or missing price scale.
2. Daily — structure aligned with weekly? Flag if mid-range with no clear level.
3. 4H — defined entry zone? REJECT if price is mid-range or zone is off-screen.
4. 1H — specific entry trigger? Flag if no clear trigger.
5. Only issue LONG or SHORT if ALL FOUR timeframes align. Otherwise NO TRADE.

RESPONSE FORMAT — two sections:

SECTION 1: ANALYSIS (shown to user)
---
Use this exact structure. Write in plain english. No jargon. A beginner must be able to read this and know exactly what to do.

If LONG or SHORT:

[SIGNAL EMOJI AND GRADE]
[LONG 📈 or SHORT 📉] — Grade [A/B/C] — [X]% confidence
[One sentence explaining the setup like you're talking to a friend. No jargon.]

━━━ YOUR LEVELS ━━━
Entry:      [price]
Stop Loss:  [price]  ← exit if price closes below/above this

IMPORTANT — calculate RR precisely using this method every time:
Stop distance = absolute difference between Entry and Stop Loss
TP1 RR = TP1 distance from entry ÷ Stop distance (round to 1 decimal)
TP2 RR = TP2 distance from entry ÷ Stop distance (round to 1 decimal)
TP3 RR = TP3 distance from entry ÷ Stop distance (round to 1 decimal)
Never guess or estimate — divide the exact pip distances.

TP1:        [price]  ← take off HALF your position here (RR 1:[calculated])
TP2:        [price]  ← take off a QUARTER here (RR 1:[calculated])
TP3:        [price]  ← let the last bit run to here (RR 1:[calculated])

━━━ BEFORE YOU ENTER ━━━
[Exact confirmation needed — e.g. "Wait for a green 1H candle to close above 1.08900 before placing the order."]
[If not triggered within X days: cancel and move on.]

━━━ WHILE IN THE TRADE ━━━
Once TP1 hits → move your stop to your entry price. You cannot lose money on the trade after that.
[Any other specific management note if relevant.]

⚠️  [One risk warning in plain english — e.g. news event, spread warning, volatile conditions.]

---

If NO TRADE:

⏸ NO TRADE — [one sentence why in plain english. No jargon.]

[One more sentence if needed to explain. Keep it simple.]

━━━ WHAT TO WATCH ━━━

⬇ If price pulls back first:
   Set alert at: [price]
   When it hits: send a fresh 1H screenshot here
   Enter when: [exact condition — e.g. "green 1H candle closes above X"]

⬆ If price takes off without you:
   Set alert at: [price]
   When it hits: send a fresh 4H + 1H screenshot here
   Don't chase before the alert — wait for it to come to you.

Confidence: [X]% (Structure [X]/10 | Timing [X]/10 | News risk [X]/10 | TF alignment [X]/10)
---

SECTION 2: SESSION_CONTEXT (used internally, not shown to user — put this at the very end after "---SESSION_CONTEXT---")
Write a compact structured summary for use in follow-up updates. Include:
- Weekly bias and key levels
- Daily structure and key levels
- 4H setup and entry zone
- Pullback alert level and confirmation condition
- Breakout watch level and what it means if hit
- Signal issued (or reason for no trade)
Format it as plain key:value lines, concise.`;

    const tfLabels = ["Weekly chart", "Daily chart", "4H chart", "1H chart"];
    const content = [];

    images.forEach((img, i) => {
      const base64 = img.split(",")[1];
      const mediaType = img.match(/data:([^;]+);/)[1];
      content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } });
      content.push({ type: "text", text: `${tfLabels[i]} (chart ${i + 1} of 4). Read prices from the RIGHT-HAND scale only, not the header bar.` });
    });

    content.push({
      type: "text",
      text: `Instrument: ${instrument} | RR: 1:${rr} (min ${minWin}% winrate) | News: ${news || "not specified"}${notes ? " | Notes: " + notes : ""}

Analyze all 4 timeframes. After your analysis, append ---SESSION_CONTEXT--- followed by the compact summary.`,
    });

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-5-20250929", max_tokens: 2500, system: systemPrompt, messages: [{ role: "user", content }] }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { statusCode: response.status, body: JSON.stringify({ error: err }) };
      }

      const data = await response.json();
      const fullText = data.content.map((b) => b.text || "").join("");

      // Strip SESSION_CONTEXT cleanly
      const scIndex = fullText.indexOf("---SESSION_CONTEXT---");
      const analysisText = (scIndex !== -1 ? fullText.substring(0, scIndex) : fullText)
        .replace(/\*\*SESSION_CONTEXT[:\*]*\**/gi, '')
        .replace(/SESSION_CONTEXT[:\s]*/gi, '')
        .trim();
      const sessionContextExtracted = scIndex !== -1 ? fullText.substring(scIndex + 21).trim() : "";

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: analysisText, sessionContext: sessionContextExtracted }),
      };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ─── FOLLOW-UP UPDATE ────────────────────────────────────────────────────────
  if (type === "followup") {
    if (!updateImage) {
      return { statusCode: 400, body: JSON.stringify({ error: "No screenshot provided" }) };
    }

    const base64 = updateImage.split(",")[1];
    const mediaType = updateImage.match(/data:([^;]+);/)[1];

    const systemPrompt = `You are an expert swing trader monitoring an active trade setup. You have memory of the higher timeframe analysis and conversation history below.

CRITICAL PRICE READING RULES:
- Current price = the GREEN or highlighted label on the RIGHT-HAND price scale
- IGNORE the O/H/L/C header bar at the top — those are old candle values
- IGNORE dotted line labels — those are reference levels

Your job: look at the fresh 1H screenshot and give a short update. Write in plain english — a beginner must understand exactly what to do.

You have FIVE possible responses:

1. YES — ENTER NOW
✅ ENTER NOW
[One sentence explaining what you see that confirms the entry.]

━━━ YOUR LEVELS ━━━
Entry:      [price]
Stop Loss:  [price]  ← exit if price closes below/above this

Calculate RR: Stop distance = |Entry - SL|. Divide each TP distance by stop distance.

TP1:        [price]  ← take off HALF here (RR 1:[calculated])
TP2:        [price]  ← take off a QUARTER here (RR 1:[calculated])
TP3:        [price]  ← let the last bit run (RR 1:[calculated])

Once TP1 hits → move stop to entry. You cannot lose after that.
⚠️ [One risk warning if relevant.]

2. NOT YET — STILL WAITING
⏳ NOT YET — still waiting.
Current price: [read from RIGHT-HAND scale only]
[One sentence on what still needs to happen.]

Still watching:
⬇ Set alert at: [pullback level] — send 1H screenshot when hit
⬆ Set alert at: [breakout level] — send 4H + 1H screenshot when hit

3. PRICE TOOK OFF — BREAKOUT
🚀 PRICE TOOK OFF — [one sentence what happened]
[Concrete guidance: is there a continuation entry forming, or stand aside?]

If continuing:
   Set alert at: [retest level]
   When it hits: send a fresh 4H + 1H screenshot here

If not clear:
   Stand aside for now. Send a fresh 4H screenshot in [X] hours.

4. SETUP OFF — INVALIDATED
❌ SETUP OFF — [one sentence why]
[What to look for next, if anything. If nothing, say "Nothing to watch right now — move on."]

5. NEED FRESH CHARTS
🔄 NEED FRESH CHARTS — [one sentence why]
Please upload a new Daily and 4H screenshot so I can reassess.

Keep the whole response under 15 lines. No fluff. No jargon.

After your response, append ---SESSION_CONTEXT--- followed by an updated compact summary reflecting the latest situation.`;

    // Build conversation for context
    const messages = [];

    // Add session context as first message if available
    if (sessionContext) {
      messages.push({
        role: "user",
        content: `Here is the higher timeframe context from the original analysis:\n\n${sessionContext}`,
      });
      messages.push({
        role: "assistant",
        content: "Understood. I have the higher timeframe context. Ready for follow-up updates.",
      });
    }

    // Add conversation history
    if (conversationHistory && conversationHistory.length > 0) {
      conversationHistory.forEach((msg) => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }

    // Add the new update
    // Build the update message — supports 1 or 2 images
    const updateContent = [];
    updateContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } });
    if (updateImage2) {
      const base642 = updateImage2.split(",")[1];
      const mediaType2 = updateImage2.match(/data:([^;]+);/)[1];
      updateContent.push({ type: "image", source: { type: "base64", media_type: mediaType2, data: base642 } });
      updateContent.push({ type: "text", text: `Fresh screenshots for ${instrument}. First image is the 4H chart, second image is the 1H chart. Read current price from the GREEN label on the RIGHT-HAND scale of the 1H chart — not the header bar. Has the setup formed? Give me a short update.` });
    } else {
      updateContent.push({ type: "text", text: `Fresh 1H screenshot for ${instrument}. Read current price from the GREEN label on the RIGHT-HAND scale — not the header bar. Has the setup formed? Give me a short update.` });
    }

    messages.push({ role: "user", content: updateContent });

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-5-20250929", max_tokens: 600, system: systemPrompt, messages }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { statusCode: response.status, body: JSON.stringify({ error: err }) };
      }

      const data = await response.json();
      const fullText = data.content.map((b) => b.text || "").join("");

      // Strip SESSION_CONTEXT — remove everything from the marker onwards
      const scIndex = fullText.indexOf("---SESSION_CONTEXT---");
      const updateText = (scIndex !== -1 ? fullText.substring(0, scIndex) : fullText).trim();
      const updatedContext = scIndex !== -1 ? fullText.substring(scIndex + 21).trim() : sessionContext;

      // Also strip any partial SESSION_CONTEXT mention that snuck through
      const cleanText = updateText
        .replace(/\*\*SESSION_CONTEXT[:\*]*\**/gi, '')
        .replace(/SESSION_CONTEXT[:\s]*/gi, '')
        .trim();

      const needsFreshCharts = cleanText.toUpperCase().includes("NEED FRESH CHARTS");

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: cleanText, sessionContext: updatedContext, needsFreshCharts }),
      };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: "Invalid request type" }) };
};
