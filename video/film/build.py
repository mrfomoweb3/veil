#!/usr/bin/env python3
"""Writes index.html and compositions/sNN.html for the VEIL walkthrough from one table.

Timing comes from the narration (audio_meta.json: each line's length and word times), so a
label lands on the word that names it. Re-run after changing a line, a shot or a voice take.
"""
import json, os, html

ROOT = os.path.dirname(os.path.abspath(__file__))
meta = json.load(open(os.path.join(ROOT, 'audio_meta.json')))
VOICE = {v['id']: v for v in meta['voices']}
RELAY = json.load(open(os.path.join(ROOT, 'assets/relay-tx.json')))

GAP, CHAPTER_GAP, LEAD = 0.45, 0.95, 0.2
CHAPTERS = {'s03', 's05', 's08', 's13', 's16', 's20'}          # a fog wipe opens these
FINALE = [('s21', 5.5), ('s22', 7.5), ('s23', 8.0), ('s24', 4.0), ('s25', 7.0)]

def img(name): return f'assets/shots/{name}.png'

# Each shot: image, focus point (0-1 of the image), scale from -> to, and the word it cuts on.
# Labels: (term, sub, word, x, y) in frame pixels; `extra` is scene-specific drawing.
S = {
 's01': dict(shots=[('15-reveal-verified', .42, .56, 1.30, 1.45, None)], extra='eyes'),
 's02': dict(shots=[('15-reveal-verified', .42, .56, 1.45, 1.45, None)], extra='split'),
 's03': dict(shots=[('01-title', .5, .40, 1.0, 1.22, None), ('05-board-fog', .62, .40, 1.25, 1.10, 'war')]),
 's04': dict(shots=[('05-board-fog', .66, .32, 1.6, 1.75, None)], extra='secrets'),
 's05': dict(shots=[('01-title', .5, .62, 1.0, 1.0, None), ('01-title', .5, .835, 2.4, 2.6, 'relayer')],
             labels=[('Relayer', 'creates your NEAR account · pays the gas', 'relayer', 960, 250)]),
 's06': dict(shots=[('03-lobby-invite', .5, .52, 1.5, 2.1, None), ('04-invite', .5, .50, 1.7, 2.1, 'friend')],
             labels=[('Starts by itself', 'when every seat is taken', 'starts', 960, 900)]),
 's07': dict(shots=[('05-board-fog', .30, .42, 1.15, 1.85, None), ('05-board-fog', .62, .38, 1.5, 1.25, 'nobody')]),
 's08': dict(shots=[], extra='enclave',
             labels=[('OutLayer enclave', 'Intel TDX · memory sealed from its operator', 'OutLayer', 960, 905)]),
 's09': dict(shots=[('06-orders-march', .33, .45, 1.5, 1.9, None), ('06-orders-march', .12, .30, 2.2, 2.4, 'recruit'),
                    ('06-orders-march', .12, .78, 2.3, 2.5, 'seal')], extra='seal',
             labels=[('Sealed in your browser', 'X25519 + XChaCha20, to the enclave’s key', 'encrypts', 1240, 520)]),
 's10': dict(shots=[('09-sealed-topbar', .2, .04, 2.4, 2.7, None)],
             labels=[('NEAR contract', 'ciphertext only · the turn clock', 'contract', 960, 560)]),
 's11': dict(shots=[('10-resolving', .62, .18, 2.0, 2.2, None), ('13-feed-truce', .5, .15, 2.2, 2.4, 'sends')],
             labels=[('Your view only', 'sealed to your key · same size for everyone', 'sends', 960, 640)]),
 's12': dict(shots=[('12-attest', .5, .45, 1.55, 1.7, None), ('12-attest', .44, .33, 2.3, 2.4, 'checks')],
             labels=[('VRF', 'verifiable random function · checked on chain', 'verifiable', 1440, 930)]),
 's13': dict(shots=[('05-board-fog', .22, .03, 2.6, 2.8, None), ('05-board-fog', .60, .40, 1.4, 1.2, 'decide')],
             labels=[('AI warlords', 'decide in the enclave, from their own fog', 'warlords', 960, 900)]),
 's14': dict(shots=[('08-market-intel', .13, .50, 2.0, 2.2, None), ('13b-feed-intel', .85, .20, 2.6, 2.8, 'intel')]),
 's15': dict(shots=[('13-feed-truce', .86, .17, 2.6, 2.8, None), ('12b-market-truce', .12, .50, 2.0, 2.2, 'Prices')]),
 's16': dict(shots=[('14-war-over', .50, .52, 1.7, 1.9, None)], extra='publish'),
 's17': dict(shots=[('15-reveal-verified', .42, .56, 1.25, 1.45, None)],
             labels=[('veil-verify', 'the game’s own Rust, compiled to WebAssembly', 'Rust', 760, 930)]),
 's18': dict(shots=[('15-reveal-verified', .865, .13, 2.7, 2.9, None)], extra='stamp'),
 's19': dict(shots=[], extra='wipe'),
 's20': dict(shots=[('16-vault', .50, .38, 2.1, 2.4, None)],
             labels=[('Chain Signatures', 'your NEAR account signs for its Base address', 'Chain', 960, 900)]),
 # Music-driven finale (no voice): titles carry it.
 's21': dict(shots=[('16-vault', .74, .34, 2.0, 2.25, None)],
             title=('NEAR Intents', 'carries winnings to Base · a faucet stands in on testnet')),
 's22': dict(shots=[('18-seal-1', .5, .55, 2.0, 2.0, None), ('18-seal-2', .5, .55, 2.0, 2.05, 1.6),
                    ('18-seal-3', .5, .55, 2.05, 2.1, 3.2), ('18-seal-done', .30, .30, 2.1, 2.3, 4.8)],
             title=('Sealed into Gloam', 'a private pool on Base · a zero-knowledge proof to cash out')),
 's23': dict(shots=[('19-cashout-sheet', .47, .50, 1.6, 1.8, None)], extra='relay'),
 's24': dict(shots=[('07-radial', .48, .42, 2.0, 2.2, None)],
             title=('Every input', 'mouse · touch · keyboard · gamepad, one radial menu')),
 's25': dict(shots=[('01-title', .5, .36, 1.12, 1.2, None)], extra='end'),
}

def word_at(sid, word, default=0.0):
    v = VOICE.get(sid)
    if not v: return default
    for w in v['words']:
        if w['text'].strip('.,:;!?').lower().startswith(word.lower()):
            return w['start']
    return default

# ---- timeline ----
t = 0.5
timing = {}
voiced = [f's{i:02d}' for i in range(1, 21) if f's{i:02d}' in VOICE]
for i, sid in enumerate(voiced):
    if i and sid in CHAPTERS: t += CHAPTER_GAP - GAP
    v = VOICE[sid]
    timing[sid] = dict(voice=t, vdur=v['duration_s'])
    t += v['duration_s'] + GAP
narr_end = t
for sid, d in FINALE:
    timing[sid] = dict(voice=None, start=t, dur=d)
    t += d
TOTAL = round(t + 0.1, 2)
order = voiced + [s for s, _ in FINALE]
for i, sid in enumerate(order):
    tm = timing[sid]
    if tm['voice'] is not None:
        tm['start'] = 0.0 if i == 0 else round(tm['voice'] - LEAD, 3)
for i, sid in enumerate(order):
    tm = timing[sid]
    nxt = timing[order[i + 1]]['start'] if i + 1 < len(order) else TOTAL
    tm['dur'] = round(nxt - tm['start'], 3)
    tm['off'] = 0 if tm['voice'] is None else round(tm['voice'] - tm['start'], 3)  # voice offset in the scene

FONT = """@font-face { font-family: 'Cinzel'; font-weight: 700 800; src: url('assets/fonts/Cinzel-latin.woff2') format('woff2'); }"""
BASE_CSS = FONT + """
#root { position: absolute; inset: 0; overflow: hidden; background: #17122b; font-family: Inter, sans-serif; color: #efe6d6; }
.shot { position: absolute; inset: 0; overflow: hidden; }
.cam { position: absolute; inset: 0; will-change: transform; }
.cam img { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; object-fit: cover; }
.dim { position: absolute; inset: 0; background: radial-gradient(ellipse 80% 70% at 50% 45%, rgba(23,18,43,0) 30%, rgba(23,18,43,.55) 100%); }
.term { position: absolute; transform: translate(-50%, -50%); }
.term-in { background: rgba(28,21,52,.94); border: 1.5px solid rgba(255,217,138,.55); border-radius: 14px; padding: 16px 26px 18px; text-align: center; box-shadow: 0 18px 40px rgba(8,5,20,.45); }
.term-in b { display: block; font: 800 44px/1.05 'Cinzel', serif; color: #ffd98a; letter-spacing: .02em; }
.term-in span { display: block; margin-top: 8px; font: 600 30px/1.25 Inter, sans-serif; color: #efe6d6; }
.title { position: absolute; left: 0; right: 0; bottom: 96px; text-align: center; }
.title-in { display: inline-block; background: rgba(23,18,43,.9); border-radius: 18px; padding: 22px 44px 26px; border: 1.5px solid rgba(255,217,138,.5); }
.title-in b { display: block; font: 800 78px/1 'Cinzel', serif; color: #ffd98a; letter-spacing: .02em; }
.title-in span { display: block; margin-top: 12px; font: 600 30px/1.25 Inter, sans-serif; color: #efe6d6; }
"""

def shot_html(sid, k, name):
    return f'<div id="{sid}-shot{k}" class="shot clip" data-start="{{start}}" data-duration="{{dur}}"><div id="{sid}-cam{k}" class="cam"><img src="{img(name)}" alt=""></div><div class="dim"></div></div>'

def term_html(sid, k, term, sub, x, y):
    return (f'<div id="{sid}-term{k}" class="term clip" data-start="{{start}}" data-duration="{{dur}}" style="left:{x}px;top:{y}px;z-index:20">'
            f'<div class="term-in"><b>{html.escape(term)}</b><span>{html.escape(sub)}</span></div></div>')

def build_scene(sid):
    spec, tm = S[sid], timing[sid]
    dur, off = tm['dur'], tm['off']
    parts, tweens, css = [], [], ''
    shots = spec.get('shots', [])
    # shot windows: each runs from its cue to the next shot's cue
    cues = []
    for k, sh in enumerate(shots):
        cue = sh[5]
        if cue is None: c = 0.0
        elif isinstance(cue, (int, float)): c = float(cue)
        else: c = round(off + word_at(sid, cue, 0) - 0.15, 3)
        cues.append(max(0.0, c))
    k = 0
    while k < len(shots):
        name = shots[k][0]
        j = k
        while j + 1 < len(shots) and shots[j + 1][0] == name: j += 1
        st = cues[k]; en = cues[j + 1] if j + 1 < len(shots) else dur
        parts.append(shot_html(sid, k, name).replace('{start}', f'{st}').replace('{dur}', f'{round(en - st, 3)}'))
        for m in range(k, j + 1):
            _, fx, fy, s0, s1, _c = shots[m]
            ms = cues[m]; me = cues[m + 1] if m + 1 < len(shots) else dur
            lazy = '' if m == k else ', immediateRender:false'
            # Bring the focus point to the frame centre, without ever showing the image's edge.
            def pan(f, sc, size): return round(max(-(sc - 1) * size / 2, min((sc - 1) * size / 2, (0.5 - f) * size * sc)), 1)
            x0, y0, x1, y1 = pan(fx, s0, 1920), pan(fy, s0, 1080), pan(fx, s1, 1920), pan(fy, s1, 1080)
            tweens.append(f'tl.fromTo("#{sid}-cam{k}", {{scale:{s0}, x:{x0}, y:{y0}, transformOrigin:"50% 50%"}}, {{scale:{s1}, x:{x1}, y:{y1}, transformOrigin:"50% 50%", duration:{min(0.9, max(0.4, me - ms - 0.1)):.2f}, ease:"power3.inOut"{lazy}}}, {ms + 0.05:.3f});')
            md = min(0.9, max(0.4, me - ms - 0.1))
            rest = round(me - ms - md - 0.05, 3)
            if rest > 1.2:
                tweens.append(f'tl.fromTo("#{sid}-cam{k}", {{scale:{s1}}}, {{scale:{round(s1 * 1.045, 3)}, duration:{rest}, ease:"none", immediateRender:false}}, {ms + 0.05 + md:.3f});')
        k = j + 1
    for k, (term, sub, word, x, y) in enumerate(spec.get('labels', [])):
        at = round(off + word_at(sid, word, 1.0), 3)
        parts.append(term_html(sid, k, term, sub, x, y).replace('{start}', f'{at}').replace('{dur}', f'{round(dur - at, 3)}'))
        tweens.append(f'tl.fromTo("#{sid}-term{k} .term-in", {{opacity:0, scale:1.08}}, {{opacity:1, scale:1, duration:.28, ease:"back.out(2)"}}, {at});')
    if 'title' in spec:
        b, s = spec['title']
        parts.append(f'<div id="{sid}-title" class="title clip" data-start="0.35" data-duration="{round(dur - .35, 3)}" style="z-index:30"><div class="title-in"><b>{html.escape(b)}</b><span>{html.escape(s)}</span></div></div>')
        tweens.append(f'tl.fromTo("#{sid}-title .title-in", {{opacity:0, y:24}}, {{opacity:1, y:0, duration:.45, ease:"power3.out"}}, .35);')
    ex = spec.get('extra')
    W = lambda w, d=0.5: round(off + word_at(sid, w, d), 3)
    if ex == 'eyes':
        # Watchers: first the operator's sweep, then cursors everywhere.
        css += '.sweep{position:absolute;left:0;right:0;height:6px;background:linear-gradient(90deg,transparent,#ffd98a,transparent);box-shadow:0 0 0 0 #ffd98a;} .cur{position:absolute;width:44px;height:44px;}'
        a = W('server'); b = W('everyone')
        parts.append(f'<div id="s01-sweep" class="clip" data-start="{a}" data-duration="1.4" style="position:absolute;inset:0;z-index:5"><div class="sweep" id="s01-line" style="top:0"></div></div>')
        tweens.append(f'tl.fromTo("#s01-line", {{y:0, opacity:1}}, {{y:1074, opacity:.2, duration:1.3, ease:"power1.inOut"}}, {a});')
        pts = [(310,260),(520,610),(760,330),(1010,720),(1240,420),(1460,650),(1660,300),(880,880),(420,860),(1530,860),(640,180),(1180,190)]
        cur = '<svg class="cur" viewBox="0 0 24 24"><path d="M3 2l18 9-7.5 2.2L11 21z" fill="#efe6d6" stroke="#17122b" stroke-width="1.4"/></svg>'
        for i, (x, y) in enumerate(pts):
            st = round(b + i * 0.07, 3)
            parts.append(f'<div id="s01-c{i}" class="clip" data-start="{st}" data-duration="{round(dur - st, 3)}" style="position:absolute;left:{x}px;top:{y}px;z-index:6">{cur}</div>')
            tweens.append(f'tl.fromTo("#s01-c{i} svg", {{scale:0, rotate:-30}}, {{scale:1, rotate:0, duration:.25, ease:"back.out(2.4)"}}, {st});')
    if ex == 'split':
        css += '.half{position:absolute;top:0;bottom:0;width:50%;} .half b{position:absolute;bottom:120px;left:0;right:0;text-align:center;font:800 64px/1 Cinzel,serif;letter-spacing:.04em;color:#ffd98a}'
        a = W('trust'); b = W('secrets')
        parts.append(f'<div id="s02-l" class="clip half" data-start="{a}" data-duration="{round(dur-a,3)}" style="left:0;background:rgba(23,18,43,.72);z-index:5"><b id="s02-lt">TRUST</b></div>')
        parts.append(f'<div id="s02-r" class="clip half" data-start="{b}" data-duration="{round(dur-b,3)}" style="left:50%;z-index:5"><b id="s02-rt">NO SECRETS</b></div>')
        parts.append(f'<div id="s02-bar" class="clip" data-start="{a}" data-duration="{round(dur-a,3)}" style="position:absolute;left:958px;top:0;width:4px;height:1080px;background:#ffd98a;z-index:6"></div>')
        tweens += [f'tl.fromTo("#s02-lt", {{opacity:0, scale:1.15}}, {{opacity:1, scale:1, duration:.3, ease:"power3.out"}}, {a});',
                   f'tl.fromTo("#s02-rt", {{opacity:0, scale:1.15}}, {{opacity:1, scale:1, duration:.3, ease:"power3.out"}}, {b});',
                   f'tl.fromTo("#s02-bar", {{scaleY:0}}, {{scaleY:1, duration:.4, ease:"power3.inOut"}}, {a});']
    if ex == 'secrets':
        css += '.secret{position:absolute;left:150px;font:800 118px/1 Cinzel,serif;color:#ffd98a;letter-spacing:.02em;text-shadow:0 6px 30px rgba(23,18,43,.6)} .shade{position:absolute;inset:0;background:rgba(23,18,43,.55)}'
        parts.append(f'<div id="s04-shade" class="clip shade" data-start="{W("Anything")}" data-duration="{round(dur - W("Anything"),3)}" style="z-index:4"></div>')
        tweens.append(f'tl.fromTo("#s04-shade", {{opacity:0}}, {{opacity:1, duration:.5}}, {W("Anything")});')
        for i, (w, label, y) in enumerate([('cards', 'Cards', 300), ('auctions', 'Auctions', 470), ('sealed', 'Sealed bids', 640)]):
            st = W(w)
            parts.append(f'<div id="s04-w{i}" class="clip secret" data-start="{st}" data-duration="{round(dur - st, 3)}" style="top:{y}px;z-index:6"><span>{label}</span></div>')
            tweens.append(f'tl.fromTo("#s04-w{i} span", {{opacity:0, x:-40}}, {{opacity:1, x:0, duration:.32, ease:"power3.out"}}, {st});')
    if ex == 'enclave':
        css += """.sky{position:absolute;inset:0;background:radial-gradient(ellipse 120% 90% at 50% 20%,#3a2f63 0%,#17122b 70%)}
.cloud{position:absolute;border-radius:50%;background:radial-gradient(circle at 40% 35%,#fbe9e6 0%,#f0d3d3 55%,#d9b6c0 100%);box-shadow:inset -18px -22px 40px rgba(120,80,110,.25)}
.vault{position:absolute;left:660px;top:250px;width:600px;height:420px;border-radius:28px;background:linear-gradient(160deg,#2a2148,#120e22);border:4px solid #8a6f3d;box-shadow:0 30px 80px rgba(0,0,0,.5), inset 0 0 0 10px #1c1633}
.engine{position:absolute;left:90px;top:80px;right:90px;bottom:80px;border:3px dashed rgba(255,217,138,.45);border-radius:16px;display:grid;place-items:center;font:700 34px/1.2 Inter,sans-serif;color:rgba(255,217,138,.8);letter-spacing:.06em;text-transform:uppercase}
.rivet{position:absolute;width:14px;height:14px;border-radius:50%;background:#8a6f3d}"""
        parts.append('<div id="s08-bg" class="clip sky" data-start="0" data-duration="%s"></div>' % dur)
        clouds = [(420,560,300),(1250,520,320),(520,220,240),(1180,190,260),(820,700,280),(300,330,200),(1450,380,220),(960,120,200)]
        for i, (x, y, r) in enumerate(clouds):
            parts.append(f'<div id="s08-cl{i}" class="clip cloud" data-start="0" data-duration="{dur}" style="left:{x-r//2}px;top:{y-r//2}px;width:{r}px;height:{int(r*0.62)}px;z-index:3"></div>')
            tweens.append(f'tl.fromTo("#s08-cl{i}", {{x:{-60 if x < 960 else 60}, opacity:.9}}, {{x:{-260 if x < 960 else 260}, opacity:.95, duration:.9, ease:"power3.inOut"}}, .1);')
        rivets = ''.join(f'<i class="rivet" style="left:{lx}px;top:{ly}px"></i>' for lx, ly in [(18,18),(568,18),(18,388),(568,388)])
        parts.append(f'<div id="s08-vault" class="clip" data-start="0" data-duration="{dur}" style="position:absolute;inset:0;z-index:2"><div class="vault" id="s08-box">{rivets}<div class="engine" id="s08-eng">game engine</div></div></div>')
        tweens.append(f'tl.fromTo("#s08-box", {{scale:.85, opacity:0}}, {{scale:1, opacity:1, duration:.6, ease:"power3.out"}}, .25);')
        tweens.append(f'tl.fromTo("#s08-box", {{scale:1}}, {{scale:1.06, duration:{round(dur - 1.0, 3)}, ease:"none", immediateRender:false}}, .85);')
        tweens.append(f'tl.fromTo("#s08-eng", {{opacity:0}}, {{opacity:1, duration:.4}}, {W("engine")});')
        # The operator's cursor reaches the wall and stops.
        o = W('operator')
        cur = '<svg viewBox="0 0 24 24" style="width:64px;height:64px"><path d="M3 2l18 9-7.5 2.2L11 21z" fill="#efe6d6" stroke="#17122b" stroke-width="1.4"/></svg>'
        parts.append(f'<div id="s08-op" class="clip" data-start="{o}" data-duration="{round(dur-o,3)}" style="position:absolute;left:1500px;top:440px;z-index:8">{cur}</div>')
        parts.append(f'<div id="s08-x" class="clip" data-start="{round(o+.75,3)}" data-duration="{round(dur-o-.75,3)}" style="position:absolute;left:1262px;top:418px;z-index:9;font:800 64px/1 Inter;color:#ff6b6b">✕</div>')
        tweens.append(f'tl.fromTo("#s08-op svg", {{x:200}}, {{x:-170, duration:.7, ease:"power2.in"}}, {o});')
        tweens.append(f'tl.fromTo("#s08-op svg", {{x:-170}}, {{x:-120, duration:.25, ease:"power2.out", immediateRender:false}}, {round(o+.7,3)});')
        tweens.append(f'tl.fromTo("#s08-x", {{scale:0}}, {{scale:1, duration:.2, ease:"back.out(3)"}}, {round(o+.75,3)});')
    if ex == 'seal':
        css += '.wax{position:absolute;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe7a8,#e0a948 55%,#a8742a);box-shadow:0 10px 30px rgba(0,0,0,.45),inset 0 0 0 8px rgba(255,255,255,.18);display:grid;place-items:center;font:800 64px/1 Cinzel,serif;color:#5a3a10}'
        e = W('encrypts')
        parts.append(f'<div id="s09-wax" class="clip" data-start="{e}" data-duration="{round(dur-e,3)}" style="position:absolute;left:330px;top:640px;z-index:12"><div class="wax" id="s09-w">V</div></div>')
        tweens.append(f'tl.fromTo("#s09-w", {{scale:2.2, opacity:0, rotate:-25}}, {{scale:1, opacity:1, rotate:0, duration:.32, ease:"power4.in"}}, {e});')
    if ex == 'publish':
        css += '.paper{position:absolute;left:0;top:0;width:400px;padding:20px 26px;border-radius:12px;background:#f3e6cc;color:#2a1d0c;box-shadow:0 14px 30px rgba(0,0,0,.4);font:700 38px/1.15 Inter,sans-serif}.paper small{display:block;font:600 28px/1.3 Inter;color:#6b5634;margin-top:6px}'
        items = [('order', 'Every order', 'all turns, all players', 200, 260), ('roll', 'Every roll', 'each turn’s VRF proof', 760, 200), ('key', 'The match key', 'so anyone can decrypt', 1320, 260)]
        base = W('publishes')
        for i, (w, a_, b_, x, y) in enumerate(items):
            st = round(base + 0.55 * i, 3)
            parts.append(f'<div id="s16-p{i}" class="clip" data-start="{st}" data-duration="{round(dur-st,3)}" style="position:absolute;left:{x}px;top:{y}px;z-index:10"><div class="paper" id="s16-pp{i}">{a_}<small>{b_}</small></div></div>')
            tweens.append(f'tl.fromTo("#s16-pp{i}", {{y:420, x:{660 - x}, scale:.4, opacity:0, rotate:{-12 + 12 * i}}}, {{y:0, x:0, scale:1, opacity:1, rotate:{-4 + 4 * i}, duration:.55, ease:"power3.out"}}, {st});')
    if ex == 'stamp':
        css += '.stamp{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border:6px solid #69db7c;color:#69db7c;font:800 120px/1 Cinzel,serif;padding:18px 54px;border-radius:18px;background:rgba(23,18,43,.82);letter-spacing:.06em}'
        parts.append(f'<div id="s18-s" class="clip" data-start="{off}" data-duration="{round(dur-off,3)}" style="position:absolute;inset:0;z-index:12"><div class="stamp" id="s18-st">VERIFIED</div></div>')
        tweens.append(f'tl.fromTo("#s18-st", {{scale:2, opacity:0, rotate:-8}}, {{scale:1, opacity:1, rotate:-4, duration:.3, ease:"power4.in"}}, {off});')
    if ex == 'wipe':
        css += '.pane{position:absolute;inset:0;overflow:hidden} .pane img{position:absolute;left:0;top:0;width:1920px;height:1080px;object-fit:cover} .word{position:absolute;bottom:110px;font:800 84px/1 Cinzel,serif;color:#ffd98a;letter-spacing:.05em;text-shadow:0 6px 30px rgba(23,18,43,.8)}'
        h = W('Hidden', .2); p = W('Provable', 2.0)
        parts.append(f'<div id="s19-a" class="clip pane" data-start="0" data-duration="{dur}" style="z-index:1"><img src="{img("05-board-fog")}" alt="" style="transform:scale(1.25);transform-origin:40% 40%"></div>')
        parts.append(f'<div id="s19-b" class="clip pane" data-start="{p}" data-duration="{round(dur-p,3)}" style="z-index:2"><img id="s19-bi" src="{img("15-reveal-verified")}" alt="" style="transform:scale(1.35);transform-origin:42% 56%"></div>')
        tweens.append(f'tl.fromTo("#s19-b", {{clipPath:"inset(0 100% 0 0)"}}, {{clipPath:"inset(0 50% 0 0)", duration:.7, ease:"power3.inOut"}}, {p});')
        parts.append(f'<div id="s19-hw" class="clip word" data-start="{h}" data-duration="{round(dur-h,3)}" style="right:150px;z-index:5">HIDDEN</div>')
        parts.append(f'<div id="s19-pw" class="clip word" data-start="{p}" data-duration="{round(dur-p,3)}" style="left:150px;z-index:5">PROVABLE</div>')
        tweens += [f'tl.fromTo("#s19-hw", {{opacity:0, scale:1.15}}, {{opacity:1, scale:1, duration:.3}}, {h});', f'tl.fromTo("#s19-pw", {{opacity:0, scale:1.15}}, {{opacity:1, scale:1, duration:.3}}, {p});']
    if ex == 'relay':
        css += """.receipt{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:1180px;background:#f6efe2;color:#1d1630;border-radius:20px;padding:40px 52px;box-shadow:0 40px 90px rgba(0,0,0,.55)}
.receipt h3{font:800 40px/1.1 Cinzel,serif;margin:0 0 6px;color:#1d1630}.receipt .net{font:600 28px Inter;color:#6b5f80;margin-bottom:22px}
.row{display:grid;grid-template-columns:230px 1fr;gap:18px;padding:14px 0;border-top:1.5px solid #e2d6bd;font:600 28px/1.3 Inter,sans-serif}
.row .k{color:#6b5f80}.row code{font:600 28px 'JetBrains Mono',monospace}.row.hl{background:#fff6dc;margin:0 -20px;padding:14px 20px;border-radius:10px;border-top-color:transparent}
.row .no{color:#c0392b;font-weight:800}"""
        r = RELAY
        short = lambda a: a[:6] + '…' + a[-4:]
        rows = [('Sent by', f'<code>{short(r["from"])}</code> &nbsp;Gloam’s relay', 'hl'),
                ('Paid out', f'<b>{r["amount"]} USDC</b> → <code>{short(r["usdcTo"])}</code> (a fresh address)', ''),
                ('The player', f'<code>{short(r["player"])}</code> &nbsp;<span class="no">not in this transaction</span>', 'hl'),
                ('Status', f'{r["status"]} · block {r["block"]:,}', '')]
        body = ''.join(f'<div class="row {c}" id="s23-r{i}"><span class="k">{k}</span><span>{v}</span></div>' for i, (k, v, c) in enumerate(rows))
        parts.append(f'<div id="s23-card" class="clip" data-start="2.4" data-duration="{round(dur-2.4,3)}" style="position:absolute;inset:0;z-index:10;background:rgba(23,18,43,.6)"><div class="receipt" id="s23-rc"><h3>The cash-out, on Base Sepolia</h3><div class="net">read from the chain · tx {r["hash"][:10]}…{r["hash"][-6:]}</div>{body}</div></div>')
        tweens.append('tl.fromTo("#s23-rc", {scale:.92, opacity:0}, {scale:1, opacity:1, duration:.45, ease:"power3.out"}, 2.4);')
        for i in range(4):
            tweens.append(f'tl.fromTo("#s23-r{i}", {{opacity:0, x:-24}}, {{opacity:1, x:0, duration:.3, ease:"power3.out"}}, {2.75 + i * 0.55:.2f});')
    if ex == 'end':
        css += '.url{position:absolute;left:0;right:0;top:850px;text-align:center;font:800 64px/1 Cinzel,serif;color:#ffd98a;letter-spacing:.04em}.stack{position:absolute;left:0;right:0;top:945px;text-align:center;font:600 28px Inter;color:#efe6d6;letter-spacing:.08em}'
        parts.append(f'<div id="s25-band" class="clip" data-start="0" data-duration="{dur}" style="position:absolute;left:0;right:0;bottom:0;height:430px;background:linear-gradient(180deg,rgba(23,18,43,0),#17122b 38%);z-index:8"></div>')
        parts.append(f'<div id="s25-url" class="clip url" data-start="1.6" data-duration="{round(dur-1.6,3)}" style="z-index:10">veil.mrfomolabs.xyz</div>')
        parts.append(f'<div id="s25-st" class="clip stack" data-start="2.4" data-duration="{round(dur-2.4,3)}" style="z-index:10">NEAR · OUTLAYER · GLOAM · NEAR INTENTS</div>')
        tweens += ['tl.fromTo("#s25-url", {opacity:0, scale:1.12}, {opacity:1, scale:1, duration:.6, ease:"power3.out"}, 1.6);',
                   'tl.fromTo("#s25-st", {opacity:0}, {opacity:1, duration:.5}, 2.4);']
    tl = '\n    '.join(tweens)
    return f"""<template>
  <style>
{BASE_CSS}
{css}
  </style>
  <div id="root" data-composition-id="{sid}" data-width="1920" data-height="1080" data-layout-allow-overlap data-layout-allow-occlusion>
    {chr(10).join('    ' + p for p in parts)}
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    {tl}
    window.__timelines["{sid}"] = tl;
  </script>
</template>
"""

os.makedirs(os.path.join(ROOT, 'compositions'), exist_ok=True)
for sid in order:
    open(os.path.join(ROOT, 'compositions', f'{sid}.html'), 'w').write(build_scene(sid))

hosts, audio, fogs, fog_tw = [], [], [], []
for i, sid in enumerate(order):
    tm = timing[sid]
    hosts.append(f'<div id="{sid}" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{tm["start"]}" data-duration="{tm["dur"]}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>')
    if tm['voice'] is not None:
        audio.append(f'<audio id="v-{sid}" class="clip" src="assets/voice/{sid}.wav" data-start="{round(tm["voice"],3)}" data-duration="{round(tm["vdur"],3)}" data-volume="1" data-track-index="2"></audio>')
    if sid in CHAPTERS or sid in ('s21', 's25'):
        b = round(tm['start'] - .45, 3)
        fogs.append(f'<div id="fog-{sid}" class="clip fog" data-start="{b}" data-duration=".9" style="z-index:50"><div class="fog-in" id="fogi-{sid}"></div></div>')
        fog_tw.append(f'tl.fromTo("#fogi-{sid}", {{xPercent:-115}}, {{xPercent:115, duration:.9, ease:"power2.inOut"}}, {b});')

fin = timing['s21']['start']
audio.append(f'<audio id="bed" class="clip" src="assets/bgm/bed.mp3" data-start="0" data-duration="{round(fin + 0.6, 2)}" data-volume="0.17" data-fade-out="2.2" data-track-index="3"></audio>')
audio.append(f'<audio id="finale" class="clip" src="assets/bgm/finale.mp3" data-start="{round(fin - 0.8, 2)}" data-media-start="34" data-duration="{round(TOTAL - fin + 0.8, 2)}" data-volume="0.9" data-fade-in="0.8" data-fade-out="2.5" data-track-index="5"></audio>')

FOG_CSS = """.fog { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.fog-in { position: absolute; top: -10%; left: -20%; width: 140%; height: 120%;
  background:
    radial-gradient(ellipse 18% 30% at 20% 30%, #fbe9e6 60%, transparent 62%),
    radial-gradient(ellipse 22% 34% at 38% 60%, #f3dada 60%, transparent 62%),
    radial-gradient(ellipse 20% 28% at 55% 25%, #fbe9e6 60%, transparent 62%),
    radial-gradient(ellipse 24% 36% at 72% 62%, #f0d3d3 60%, transparent 62%),
    radial-gradient(ellipse 18% 30% at 88% 30%, #fbe9e6 60%, transparent 62%),
    linear-gradient(90deg, transparent 8%, #f3dada 22%, #f3dada 78%, transparent 92%); }
#root { position: absolute; inset: 0; pointer-events: none; }"""
fog_tl = '\n    '.join(fog_tw)
fog_body = '\n    '.join(fogs)
open(os.path.join(ROOT, 'compositions', 'fog.html'), 'w').write(f"""<template>
  <style>
{FOG_CSS}
  </style>
  <div id="root" data-composition-id="fog" data-width="1920" data-height="1080" data-layout-allow-overlap data-layout-allow-occlusion>
    {fog_body}
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    {fog_tl}
    window.__timelines["fog"] = tl;
  </script>
</template>
""")
fogs = [f'<div id="fog" data-composition-id="fog" data-composition-src="compositions/fog.html" data-start="0" data-duration="{TOTAL}" data-track-index="4" data-track-kind="graphics" data-width="1920" data-height="1080" style="z-index:50"></div>']
fog_tw = []
index = f"""<!doctype html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #17122b; }}
      #root {{ position: relative; width: 100%; height: 100%; }}
      .fog {{ position: absolute; inset: 0; overflow: hidden; pointer-events: none; }}
      .fog-in {{ position: absolute; top: -10%; left: -20%; width: 140%; height: 120%;
        background:
          radial-gradient(ellipse 18% 30% at 20% 30%, #fbe9e6 60%, transparent 62%),
          radial-gradient(ellipse 22% 34% at 38% 60%, #f3dada 60%, transparent 62%),
          radial-gradient(ellipse 20% 28% at 55% 25%, #fbe9e6 60%, transparent 62%),
          radial-gradient(ellipse 24% 36% at 72% 62%, #f0d3d3 60%, transparent 62%),
          radial-gradient(ellipse 18% 30% at 88% 30%, #fbe9e6 60%, transparent 62%),
          linear-gradient(90deg, transparent 8%, #f3dada 22%, #f3dada 78%, transparent 92%); }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL}" data-width="1920" data-height="1080">
      {chr(10).join('      ' + h for h in hosts)}
      {chr(10).join('      ' + f for f in fogs)}
      {chr(10).join('      ' + a for a in audio)}
    </div>
    <script>
      const tl = gsap.timeline({{ paused: true }});
      {chr(10).join('      ' + f for f in fog_tw)}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
"""
open(os.path.join(ROOT, 'index.html'), 'w').write(index)
print(f'{len(order)} scenes, {TOTAL:.1f} s (narration ends {narr_end:.1f} s)')
