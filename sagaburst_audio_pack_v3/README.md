# SagaBurst Audio Pack V3

## SFX
- `sfx/sword_armor_hit.wav` — V2 強化版刀劍 / 盔甲撞擊
- `sfx/arrow_body_impact.wav` — V2 強化版箭矢 / 標槍命中
- `sfx/bow_release_hit.wav` — 原始弓弦聲，只裁除前後無關靜音
- `sfx/lance_impact.wav` — 騎槍 / 長槍撞擊
- `sfx/horse_impact.wav` — 馬匹高速撞擊
- `sfx/horse_gallop.wav` — 重裝戰馬 gallop，保留完整 5 秒 loop

## Roman commands
- `commands/roman/defend.wav`
- `commands/roman/formation.wav`
- `commands/roman/attack.wav`
- `commands/roman/charge.wav`

## Viking commands
- `commands/viking/defend.wav`
- `commands/viking/formation.wav`
- `commands/viking/attack.wav`
- `commands/viking/charge.wav`

## Horns
- `horns/roman_charge.wav` — alt horn
- `horns/viking_charge.wav` — main horn

## Notes
- 指揮官與號角只裁除前後無關空白。
- `horse_impact.wav` 裁除尾端無關靜音。
- `horse_gallop.wav` 不裁切，避免破壞生成時的 loop 接縫。
- 指揮官 MP3 轉成 WAV，避免再次以 MP3 有損編碼。
