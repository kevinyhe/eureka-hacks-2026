# eureka-hacks-2026

> **Phone testing requires HTTPS.** iOS won't grant motion-sensor permission over plain HTTP unless the host is `localhost`. To test `gesture-test.html` from a real phone, expose your local server over HTTPS with a tunnel: `ngrok http 8000` (or `cloudflared tunnel --url http://localhost:8000`) and load the resulting `https://…` URL on the phone. For purely local testing, `http://localhost:<port>` also works in Safari.

## `gesture-collect.html` — labeled data recorder

A separate page from `gesture-test.html` whose only job is to record raw,
labeled motion samples we can analyze afterward to set real classifier
thresholds. **Doesn't classify or smooth** — captures every devicemotion
frame as-is.

### How to load it on the phone

Same HTTPS-tunnel setup as `gesture-test.html`. From the project root:

```cmd
python -m http.server 8000
```

In another terminal:
```cmd
cloudflared tunnel --url http://localhost:8000
```

Open `https://<random>.trycloudflare.com/gesture-collect.html` on the phone.
Tap **TAP TO START**, grant motion permission. Wake Lock is best-effort.

### Recording flow

The page walks you through 7 moves × 3 samples each = **21 samples per full
session**. Order:

1. `JAB`
2. `HOOK_RIGHT` (right hook only — no left hook in this game)
3. `UPPERCUT`
4. `HEAL`
5. `BLOCK_JAB`
6. `DODGE_SIDE`
7. `DODGE_BACK`

For each sample: instruction screen → tap **START** → perform the motion →
tap **STOP** → confirm with **KEEP**, **RETRY** (re-record), or **SKIP**
(mark bad and advance). After every kept/skipped sample the entire session
is written to `localStorage`, so a phone crash or accidental reload won't
cost you data — you'll see a "Resume previous session?" banner the next time
you open the page.

### Where the JSON ends up

After all 7 moves, the **export screen** shows a per-move kept/skipped
breakdown. Tap **DOWNLOAD JSON** — your phone saves a file named
`gesture-data-YYYYMMDD-HHMMSS.json` to its default Downloads location
(iOS: Files → Downloads; Android: Files / Downloads).

Move that file to your laptop (AirDrop, USB, email to yourself, whatever)
and drop it into this repo. The intent is to feed it back to **Claude Code
for threshold tuning** — the per-move frame arrays let us look at peak
accel.x for jabs, gyro spikes for dodges, sustained-state bands for blocks,
etc., and pick thresholds from real numbers instead of the spec defaults.

### Format quick reference

```json
{
  "sessionId": "…",
  "startedAt": "ISO timestamp",
  "endedAt":   "ISO timestamp",
  "userAgent": "…",
  "device": { "platform": "…", "screen": { "width": …, "height": … } },
  "samples": [
    {
      "id": "…",
      "label": "JAB",
      "sampleIndex": 1,
      "status": "kept",     // or "skipped"
      "startedAt": <ms epoch>,
      "endedAt":   <ms epoch>,
      "durationMs": <number>,
      "frames": [
        {
          "t": <ms since sample start>,
          "accel":        { "x":…, "y":…, "z":… },   // event.acceleration (no gravity); may be all-null on some devices
          "accelG":       { "x":…, "y":…, "z":… },   // event.accelerationIncludingGravity
          "rotationRate": { "alpha":…, "beta":…, "gamma":… },
          "orientation":  { "alpha":…, "beta":…, "gamma":… }   // most recent deviceorientation reading
        }
      ]
    }
  ]
}
```