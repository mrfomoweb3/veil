# Review: VEIL walkthrough (2:51)

Checked with `hyperframes check` (passes, 0 warnings) and snapshot contact sheets at 20 points.

## Found and fixed
- The camera zoomed around the focus point, which kept it where it sat on screen: the resolving card,
  the truce feed and the orders panel were mostly out of frame. The camera now pans the focus to the
  centre, clamped so the screenshot's edge never shows.
- Opening title cropped the top of the logo; end card URL sat on the PLAY button (dark band added).
- Type under the 28 px floor (subtitles, receipt, published "papers"): raised.
- 3–5 s still stretches after each push: a slow continuous push follows the main move.
- Labels that landed on the last word of a line (view, match key) moved to earlier words.
- The recap screenshot was taken after the card had faded; the scene uses the next turn's recap.
- The intel screenshot had a raw error under the Seal button: cropped out (the bug is fixed in the game).

## Known, by choice or by limit
- Lines 21–25 (bridge, Gloam, relay, controls, end) are titles over music, not narration: the HeyGen
  free voice allowance ran out after line 20. When it renews, voice them with the same voice
  (Wade, `a3a4aa242aaf431ea8ec2c4b3bb332fa`) and add them to `audio_request.json`; `build.py`
  times scenes from the voice automatically.
- Basescan blocks automated browsers, so scene 23 shows the transaction as read from the chain
  (`assets/relay-tx.json`), not a Basescan screenshot.
- The enclave diagram's clouds are simple shapes; the rest of the film uses real screens only.

## BANNED (added for this film)
Bullet slides, icons in circles, crypto clip-art, the narrator's sentence repeated as on-screen text.
