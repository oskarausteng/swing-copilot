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

  const { type, instrument, rr, news, notes, images, updateImage, previousAnalysis, alertLevel, lookFor } = body;

  if (type === "followup") {
    if (!updateImage) {
      return { statusCode: 400, body: JSON.stringify({ error: "No screenshot provided" }) };
    }

    const base64 = updateImage.split(",")[1];
    const mediaType = updateImage.match(/data:([^;]+);/)[1];

    const systemPrompt = `You are an expert swing trader giving a follow-up update on a specific trade setup.

CRITICAL PRICE READING RULES:
- The current price is the GREEN or highlighted label on the RIGHT side of the chart — read that number
- DO NOT read the price from the top header bar (O/H/L/C values) — those are old candle values, not current price
- DO NOT read the price from the dotted horizontal line label — that is a reference level, not current price
- If there is a green box with a number on the right price scale, that is the current price

Keep your response short — 4 to 8 lines max. Plain english only. No fluff.

Structure:
Line 1: YES — enter now / NOT YET — still waiting / SETUP OFF — invalidated
Line 2-3: What you actually see on the chart right now, including current price from the RIGHT scale
Line 4-5: What to do next (enter with levels, or new alert level to watch)`;

    const alertContext = alertLevel
      ? `Original alert level: ${alertLevel}\nWhat to look for: ${lookFor || "confirmation candle"}\n\n`
      : "";

    const content = [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      {
        type: "text",
        text: `${alertContext}This is a fresh 1H screenshot for ${instrument}.

IMPORTANT: Read the current price from the GREEN label on the RIGHT-HAND price scale only. Ignore the O/H/L/C values in the top header bar — those are old candle prices.

Has the setup formed? Give me a short update based only on what you can see in this chart.`,
      },
    ];

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 400,
          system: systemPrompt,
          messages: [{ role: "user", content }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { statusCode: response.status, body: JSON.stringify({ error: err }) };
      }

      const data = await response.json();
      const text = data.content.map((b) => b.text || "").join("");
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: text }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  if (!instrument || !images || images.length !== 4) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing instrument or 4 chart images" }) };
  }

  const minWin = Math.round((1 / (1 + rr)) * 100);

  const systemPrompt = `You are an expert swing trader and technical analyst. You perform strict 4-timeframe top-down analysis.

CRITICAL PRICE READING RULES:
- Read all prices from the RIGHT-HAND price scale of each chart
- DO NOT use the O/H/L/C values in the top header bar — those are individual candle values
- The current price is the highlighted label on the right side of the chart

Your job is to give clear, simple trade signals that even a beginner can follow.

ANALYSIS PROTOCOL:
1. Weekly — macro trend and key levels. Reject if chart is unclear or missing price scale.
2. Daily — structure aligned with weekly? Flag if mid-range with no clear level.
3. 4H — defined entry zone? Reject if price is mid-range or zone is off-screen.
4. 1H — specific entry trigger? Flag if no clear trigger.
5. Only issue LONG or SHORT if ALL FOUR timeframes align. Otherwise NO TRADE.

RESPONSE FORMAT — short and plain english:

SIGNAL QUALITY GRADE: A / B / C / REJECT
Signal: LONG / SHORT / NO TRADE

If LONG or SHORT:
- One sentence explaining the setup in plain english
- Entry: [price from right scale] (only enter after [specific 1H confirmation])
- Stop Loss: [price] (below liquidity, not the obvious swing low)
- TP1: [price] — take off half your position (RR X:X)
- TP2: [price] — take off a quarter (RR X:X)
- TP3: [price] — let the last quarter run (RR X:X)
- Once TP1 hits: move stop to entry — you can't lose now
- Suggested hold: X-X days
- Risk: [one line]

If NO TRADE:
- 2-3 sentences explaining why in plain english
- Set an alert at: [exact price from right scale]
- Look for: [exactly what to see]

Confidence: X% (Structure X/10 | Timing X/10 | News risk X/10 | TF alignment X/10)`;

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
    text: `Instrument: ${instrument} | RR target: 1:${rr} (min ${minWin}% winrate) | News: ${news || "not specified"}${notes ? " | Context: " + notes : ""}

Run the full 4-timeframe swing analysis. All prices must be read from the right-hand scale of each chart.`,
  });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: err }) };
    }

    const data = await response.json();
    const text = data.content.map((b) => b.text || "").join("");
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: text }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
