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

  const { type, instrument, news, notes, images, updateImage, updateImage2, sessionContext, conversationHistory } = body;

  // ─── INITIAL ANALYSIS ────────────────────────────────────────────────────────
  if (type === "initial") {
    if (!instrument || !images || images.length !== 4) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing instrument or 4 chart images" }) };
    }

    const systemPrompt = `You are an expert swing trader performing 4-timeframe top-down analysis.

PRICE READING — CRITICAL:
- IGNORE the O/H/L/C bar at the top of every chart — those values are wrong, they belong to a hovered candle.
- Current price = the highlighted label on the RIGHT-HAND scale, far right edge of the chart.
- For "current price" always use the 1H chart right-hand scale value.
- Read prices silently. Never narrate your price-reading process.

CHART DATE: Never reject or comment on chart dates. Backtesting data is valid. Just analyze what you see.

ANALYSIS PROTOCOL:
1. Weekly — macro bias and key levels.
2. Daily — aligned with weekly? Nearest key level?
3. 4H — defined zone within reach of current price?
4. 1H — trigger forming?

GRADING:
- A: All 4 align, clear trigger → issue LONG or SHORT
- B: Weekly/Daily/4H agree, no 1H trigger yet → issue LONG or SHORT with confirmation
- C: Weekly/Daily agree, 4H approximate → issue LONG or SHORT with tight conditions
- D: 2 of 4 agree, setup developing → issue DEVELOPING
- REJECT: Weekly and Daily contradict each other, or charts unreadable

Do NOT reject just because 4H is mid-range. If Weekly+Daily align and price is near a key level, that is tradeable.

ZONE RULES:
- Always give a zone (e.g. 1.0740–1.0760), never a single pip.
- Alert goes at whichever edge price hits FIRST:
  → Price falling toward zone: alert at TOP edge (higher number)
  → Price rising toward zone: alert at BOTTOM edge (lower number)
- Both alerts must be on OPPOSITE sides of current price.
- A reaction anywhere inside the zone is valid — do not require price to hit the exact midpoint.

OUTPUT FORMAT — follow this exactly. No extra sections. No headers beyond what is shown. No markdown bold (**). No "Explanation for Context" block. No reasoning paragraphs.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FOR LONG or SHORT (Grade A/B/C):

[LONG 📈 or SHORT 📉] — Grade [A/B/C] — [X]% confidence
[One sentence. Plain english. No jargon.]

━━━ HOW TO ENTER ━━━
Zone:      [price]–[price]
Wait for:  [exact 1H candle condition]
Then:      Enter at market price when that candle closes. Do not enter before.
Expires:   Cancel if not triggered within [X] days.

━━━ YOUR LEVELS ━━━
Stop Loss: [price]  ← exit if a 1H candle closes beyond this
TP1:       [price]  ← close HALF here (RR 1:[X])
TP2:       [price]  ← close a QUARTER here (RR 1:[X])
TP3:       [price]  ← let the last bit run (RR 1:[X])

RR calculation: stop distance = |confirmation price − SL|. Divide each TP distance by stop distance.

━━━ WHILE IN THE TRADE ━━━
Once TP1 hits → move stop to entry. You cannot lose after that.
[One specific management note if relevant. Skip if nothing to add.]

⚠️ [One risk warning. One sentence.]

Confidence: [X]% (Structure [X]/10 | Timing [X]/10 | News risk [X]/10 | TF alignment [X]/10)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FOR DEVELOPING (Grade D):

📊 DEVELOPING — Grade D — [X]% confidence
[One sentence on what is forming and why it is not ready.]

Bias:      [LONG or SHORT]
Key zone:  [price]–[price]  ← [one sentence why this matters]
Now:       [one sentence on where price is relative to the zone]

What needs to happen:
1. [First thing to see]
2. [Confirmation step]

⬇ Alert at: [price] — send 1H screenshot when hit
⬆ Alert at: [price] — send 4H + 1H screenshot when hit

Confidence: [X]% (Structure [X]/10 | Timing [X]/10 | News risk [X]/10 | TF alignment [X]/10)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FOR NO TRADE or REJECT:

⏸ NO TRADE — [one sentence why.]
[One more sentence max.]

⬇ [Scenario 1 label]:
   Zone: [price]–[price]
   Alert at: [near edge]
   When hit: send 1H screenshot
   Enter when: [exact condition]

⬆ [Scenario 2 label]:
   Alert at: [price on opposite side of current price]
   When hit: send 4H + 1H screenshot
   [One sentence what to look for]

Confidence: [X]% (Structure [X]/10 | Timing [X]/10 | News risk [X]/10 | TF alignment [X]/10)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After your response, write ---SESSION_CONTEXT--- then a compact key:value summary (not shown to user):
- Weekly bias and key levels
- Daily structure and nearest level
- 4H zone and current price relative to it
- Alert levels and confirmation conditions
- Signal issued`;

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
      text: `Instrument: ${instrument} | News: ${news || "not specified"}${notes ? " | Notes: " + notes : ""}

Analyze all 4 timeframes. After your analysis, append ---SESSION_CONTEXT--- followed by the compact summary.`,
    });

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-5-20250929", max_tokens: 1200, system: systemPrompt, messages: [{ role: "user", content }] }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { statusCode: response.status, body: JSON.stringify({ error: err }) };
      }

      const data = await response.json();
      const fullText = data.content.map((b) => b.text || "").join("");

      const scIndex = fullText.indexOf("---SESSION_CONTEXT---");
      const rawAnalysis = scIndex !== -1 ? fullText.substring(0, scIndex) : fullText;
      const sessionContextExtracted = scIndex !== -1 ? fullText.substring(scIndex + 21).trim() : "";

      const analysisText = rawAnalysis
        .replace(/^#+\s*.+\n*/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/\*\*/g, '')
        .replace(/^---\s*$/gm, '')
        .replace(/SESSION_CONTEXT[\s\S]*/gi, '')
        .replace(/explanation for context[\s\S]*?(?=confidence:|━━━|$)/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

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
- There is a bar of text at the TOP of the chart showing O, H, L, C values. IGNORE ALL OF THEM — they belong to whichever candle the cursor was hovering over, not the current price.
- The ONLY correct current price is the highlighted label on the RIGHT-HAND price scale — the number in a green or white box on the far right edge next to the most recent candle.
- If the price you are about to write matches any value in the top header bar, stop — you are reading the wrong thing.

CHART DATE RULES:
- Never reject or comment on charts based on the date shown. The user may be backtesting or replaying historical data — this is valid and intentional. Just analyze what you see.

Your job: look at the fresh 1H screenshot and give a short update. Write in plain english — a beginner must understand exactly what to do.

You have FIVE possible responses:

1. YES — ENTER NOW
✅ ENTER NOW
[One sentence explaining what you see that confirms the entry.]

━━━ HOW TO ENTER ━━━
Enter now at: market price (read from right-hand scale)
Confirmed — no need to wait for another candle.

━━━ YOUR LEVELS ━━━
Stop Loss:  [price]  ← exit if price closes below/above this
Calculate RR: Stop distance = |entry - SL|. Divide each TP distance by stop distance.
TP1:  [price]  ← close HALF here (RR 1:[calculated])
TP2:  [price]  ← close a QUARTER here (RR 1:[calculated])
TP3:  [price]  ← let the last bit run (RR 1:[calculated])

Once TP1 hits → move stop to entry. You cannot lose after that.
⚠️ [One risk warning if relevant.]

2. NOT YET — STILL WAITING
⏳ NOT YET — still waiting.
Current price: [read from RIGHT-HAND scale only]
[One sentence on what still needs to happen.]

Still watching:
⬇ Zone: [price]–[price] — set alert at [near edge], send 1H screenshot when hit
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

      const scIndex = fullText.indexOf("---SESSION_CONTEXT---");
      const rawUpdate = scIndex !== -1 ? fullText.substring(0, scIndex) : fullText;
      const updatedContext = scIndex !== -1 ? fullText.substring(scIndex + 21).trim() : sessionContext;

      const cleanText = rawUpdate
        .replace(/^#+\s*.+\n*/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/\*\*/g, '')
        .replace(/^---\s*$/gm, '')
        .replace(/SESSION_CONTEXT[\s\S]*/gi, '')
        .replace(/\n{3,}/g, '\n\n')
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
