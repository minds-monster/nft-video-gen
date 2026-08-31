#!/usr/bin/env bash
# Encode a MiniMax render into the web delivery ladder for the hero backdrop.
#
#   npm run encode:hero -- assets/renders/hero-1.mp4 [version]
#
# Writes into public/hero/, which IS committed — a hero loop changes a few times a year,
# so a transcoding pipeline would be over-engineering, and Cloudflare/Vercel edge-cache
# static files better than a streaming platform serves a 15-second loop.
#
# Three video files, because codec support in 2026 is split and no single file covers the
# audience: AV1 decodes on ~91.5% of sessions overall but only ~24-33% of Safari sessions
# (Apple ships hardware-only decode); HEVC is the inverse. Together they reach ~99.7%,
# and H.264 is the floor nobody misses.
#
# Version the filenames rather than relying on content hashing — Vite does not hash files
# in public/, so `hero.v1.*` is what lets us cache them immutably forever.

set -euo pipefail

IN="${1:?usage: encode-hero.sh <input.mp4> [version]}"
VER="${2:-v1}"
OUT="public/hero"

[ -f "$IN" ] || { echo "no such file: $IN" >&2; exit 1; }
mkdir -p "$OUT"

# 24fps and 1080p are deliberate: the clip sits behind a scrim and headline type, so
# halving the motion budget against 60fps and capping at 1080 is imperceptible while
# roughly halving the bytes.
#
# LOOP SEAM, and it no longer trusts the model for either end.
#
# The idea: a white frame is compositionally identical regardless of what precedes or follows
# it, so if the film ends white and begins white the wrap is invisible and reads as one more
# lightning flash. v2 got the ending for free — it happened to blow to white on its own — so
# only the head was faded. That was luck, and v3 proved it: asked for the same white blowout,
# the camera instead drifted off to an aerial cityscape and ended on near-black, which would
# have made the loop a hard black-to-white pop.
#
# So both ends are forced here. Deterministic, independent of what the render does, cannot fail.
FADE_FROM_WHITE="${FADE_FROM_WHITE:-0.30}"
FADE_TO_WHITE="${FADE_TO_WHITE:-0.35}"
# The fade-out needs to know where the end is.
DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")"
FADE_OUT_AT="$(awk -v d="$DUR" -v f="$FADE_TO_WHITE" 'BEGIN{printf "%.3f", d - f}')"

# Built by a function rather than by substituting into a 1080p string: scale and crop have to
# move together, and patching only the scale leaves `crop=1920:1080` trying to cut a 1080p
# window out of a 720p frame, which ffmpeg rejects outright.
filt_for() { # <width> <height>
  echo "$(filt_plain "$1" "$2")," \
       "fade=t=in:st=0:d=$FADE_FROM_WHITE:color=white," \
       "fade=t=out:st=$FADE_OUT_AT:d=$FADE_TO_WHITE:color=white" | tr -d ' '
}
# Same geometry, NO fade. The poster must not carry the loop-seam treatment: `-ss` before `-i`
# is an input seek, which re-bases the filter timeline, so `fade=t=in:st=0` fires again from
# the seek point and hands back a near-white rectangle. That rectangle is the LCP element and
# therefore the first thing every visitor sees, so it is worth its own filter chain.
filt_plain() { # <width> <height>
  echo "fps=24,scale=$1:$2:force_original_aspect_ratio=increase,crop=$1:$2"
}
FILT="$(filt_for 1920 1080)"
FILT_720="$(filt_for 1280 720)"
POSTER_FILT="$(filt_plain 1920 1080)"

# Audio now ships. v1 stripped it, correctly, because a silent montage had nothing to carry —
# but v2 has a scored soundtrack and HeroBackdrop exposes a sound toggle. The file still
# autoplays muted (browsers permit nothing else); the track costs ~180KB and buys perfect sync,
# which a parallel <audio> element would not.
COMMON=(-sn -dn -map_metadata -1)
AAC=(-c:a aac -b:a 96k -ar 44100 -ac 2)
OPUS=(-c:a libopus -b:a 80k -ar 48000 -ac 2)

# format=yuv420p MUST be the last filter, not part of FILT. ffmpeg negotiates formats
# across the whole chain, so a `format` in the middle is only a constraint at that point —
# a later filter can legitimately renegotiate upward, and x264's main profile then refuses
# the 4:4:4 it is handed. Pinning it at the tail is what actually guarantees the output.
PIX="format=yuv420p"

echo "→ AV1 / WebM  (primary: Chrome, Edge, Firefox, Android, M3+/A17+ Apple)"
ffmpeg -hide_banner -loglevel error -y -i "$IN" "${COMMON[@]}" \
  -vf "$FILT,$PIX" \
  -c:v libsvtav1 -crf 40 -preset 6 \
  -svtav1-params "tune=0:film-grain=0" \
  -g 120 "${OPUS[@]}" \
  "$OUT/hero.$VER.av1.webm"

echo "→ HEVC / MP4  (covers Safari, where AV1 decode is the minority)"
ffmpeg -hide_banner -loglevel error -y -i "$IN" "${COMMON[@]}" \
  -vf "$FILT,$PIX" \
  -c:v libx265 -crf 32 -preset slow -tag:v hvc1 \
  -x265-params "keyint=120:min-keyint=120:no-open-gop=1" \
  "${AAC[@]}" -movflags +faststart \
  "$OUT/hero.$VER.hevc.mp4"

echo "→ H.264 / MP4 (universal floor, 720p)"
# 720p, not 1080p: this file exists only for sessions that can decode neither AV1 nor HEVC,
# it is displayed behind a scrim, and at 15s+ the 1080p version overruns the size budget.
ffmpeg -hide_banner -loglevel error -y -i "$IN" "${COMMON[@]}" \
  -vf "$FILT_720,$PIX" \
  -c:v libx264 -crf 28 -preset slow -profile:v main -level 4.0 \
  -g 120 -keyint_min 120 -sc_threshold 0 \
  "${AAC[@]}" -movflags +faststart \
  "$OUT/hero.$VER.h264.mp4"

echo "→ poster (this is the LCP element, not the video)"
# Grabbed through POSTER_FILT (no fade) so the loop-seam white never reaches the poster. The
# seek still matters for content: it should land on the film's opening composition — the open
# frunk with both cases — so the handover from poster to video is not a visible jump.
POSTER_AT="${POSTER_AT:-0.55}"
ffmpeg -hide_banner -loglevel error -y -ss "$POSTER_AT" -i "$IN" \
  -vf "$POSTER_FILT,$PIX" -frames:v 1 "/tmp/hero-poster-$VER.png"
if command -v cwebp >/dev/null 2>&1; then
  cwebp -quiet -q 70 -resize 1920 1080 "/tmp/hero-poster-$VER.png" -o "$OUT/hero.$VER.poster.webp"
else
  ffmpeg -hide_banner -loglevel error -y -i "/tmp/hero-poster-$VER.png" \
    -c:v libwebp -quality 70 "$OUT/hero.$VER.poster.webp"
fi

echo
echo "Sizes"
ls -lh "$OUT"/hero."$VER".* | awk '{printf "  %-34s %s\n", $9, $5}'

# ASSERT, do not merely report. The budget existed in v1 as a printed target and the first v2
# encode sailed past it (AV1 4.7MB against 3.5MB) with a zero exit status — a size regression
# that ships silently is the whole failure mode this guards.
echo
fail=0
check() { # <file> <max-bytes> <label>
  local bytes; bytes=$(stat -f%z "$1" 2>/dev/null || stat -c%s "$1")
  if [ "$bytes" -gt "$2" ]; then
    printf "  ✗ %-28s %sKB exceeds %sKB\n" "$3" "$((bytes/1024))" "$(($2/1024))"; fail=1
  else
    printf "  ✓ %-28s %sKB within %sKB\n" "$3" "$((bytes/1024))" "$(($2/1024))"
  fi
}
check "$OUT/hero.$VER.av1.webm"    3670016 "AV1 ≤3.5MB"
check "$OUT/hero.$VER.hevc.mp4"    3670016 "HEVC ≤3.5MB"
check "$OUT/hero.$VER.h264.mp4"    3145728 "H.264/720p ≤3MB"
check "$OUT/hero.$VER.poster.webp"   81920 "poster ≤80KB"

echo
echo "moov atom placement (must be near the head for fast first frame):"
for f in "$OUT/hero.$VER.hevc.mp4" "$OUT/hero.$VER.h264.mp4"; do
  pos=$(head -c 2000 "$f" | LC_ALL=C grep -abo moov | head -1 | cut -d: -f1)
  printf "  %-34s moov at byte %s\n" "$(basename "$f")" "${pos:-NOT IN FIRST 2KB}"
done

echo
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames \
  -show_entries format=duration,bit_rate \
  -of default=noprint_wrappers=1 "$OUT/hero.$VER.h264.mp4"

echo
echo "Audio streams (the sound toggle in HeroBackdrop has nothing to unmute without these):"
for f in "$OUT/hero.$VER.av1.webm" "$OUT/hero.$VER.hevc.mp4" "$OUT/hero.$VER.h264.mp4"; do
  codec=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$f")
  printf "  %-34s %s\n" "$(basename "$f")" "${codec:-NONE}"
  [ -z "$codec" ] && fail=1
done

exit "$fail"
