#!/usr/bin/env bash
# Cut the montage shots into a single looping hero clip.
#
#   npm run assemble:hero                    # uses the MONTAGE order and timings
#   npm run assemble:hero -- 2.4             # default seconds for shots with no `:seconds`
#
# Writes assets/renders/hero-montage.mp4, which scripts/encode-hero.sh then turns into the
# web delivery ladder. Kept separate from encoding so the cut can be re-timed without
# re-running three video encodes.
#
# Order and per-shot length come from MONTAGE in scripts/hero-prompts.mjs; see the notes
# there for why the shots are weighted so unevenly.

set -euo pipefail

SECS="${1:-2.2}"
IN=assets/renders
OUT="$IN/hero-montage.mp4"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Read the order straight out of MONTAGE in scripts/hero-prompts.mjs. It used to be
# duplicated here as a literal array, which is a standing invitation for the cut to drift
# out of step with the prompts that produced it.
read -r -a SHOTS <<< "$(node -e "import('./scripts/hero-prompts.mjs').then(m => console.log(m.MONTAGE.join(' ')))")"
[ "${#SHOTS[@]}" -gt 0 ] || { echo "could not read MONTAGE from scripts/hero-prompts.mjs" >&2; exit 1; }
LAST=$(( ${#SHOTS[@]} - 1 ))

# Cuts between shots are hard. Brand palettes differ sharply (night amber, white studio,
# violet void, navy), so a dissolve between them would just muddy both sides.
#
# The loop seam is handled differently depending on how many shots there are:
#
#   many shots  — fade up from black on the first and down to black on the last. Over 12s+
#                 that reads as a deliberate beat.
#   one shot    — a dip to black recurring every 6.5s is far too frequent and pulls the eye,
#                 so instead the tail is cross-dissolved into the head to make the loop
#                 genuinely seamless, with no black frame at all.
SEAM=0.35
LOOP_XFADE=0.6

echo "Cutting ${#SHOTS[@]} shots"

LIST="$WORK/list.txt"
: > "$LIST"

for index in "${!SHOTS[@]}"; do
  entry="${SHOTS[$index]}"
  shot="${entry%%:*}"
  # `shot:seconds` overrides the default length. Shots are not equal: one of them runs a
  # four-beat narrative and needs room, while a slow rotate on a plinth reads in under two.
  if [ "$entry" = "$shot" ]; then secs="$SECS"; else secs="${entry##*:}"; fi

  # Latest take wins, so re-rendering a single shot is enough to update the montage. The
  # bare `<shot>-N.mp4` fallback picks up takes that came out of a probe run rather than a
  # --shot run; the frunk shot is one of those and is worth keeping.
  src=$(ls -1t "$IN"/shot-"$shot"-*.mp4 "$IN"/"$shot"-*.mp4 2>/dev/null | grep -v '\.grid\.png$' | head -1 || true)
  if [ -z "$src" ]; then
    echo "  missing: shot-$shot-*.mp4 — run: npm run gen:video -- --shot $shot" >&2
    exit 1
  fi

  seg="$WORK/$(printf '%02d' "$index")-$shot.mp4"

  # Trim the head of each shot, because MiniMax tends to ease in from a near-frozen first
  # frame and that reads as a stall immediately after a cut. A single-shot cut has no cut to
  # stall at, so it keeps the full clip — throwing away the opening frames of a shot that has
  # to carry the whole hero on its own is pure loss.
  if [ "${#SHOTS[@]}" -gt 1 ]; then head=0.4; else head=0; fi
  filter="fps=24,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080"
  if [ "${#SHOTS[@]}" -gt 1 ]; then
    [ "$index" -eq 0 ] && filter="$filter,fade=t=in:st=0:d=$SEAM"
    if [ "$index" -eq "$LAST" ]; then
      filter="$filter,fade=t=out:st=$(awk -v s="$secs" -v f="$SEAM" 'BEGIN{printf "%.3f", s-f}'):d=$SEAM"
    fi
  fi
  # Pinned last on purpose: a `format` mid-chain is only a constraint at that point, and a
  # later filter can renegotiate upward to 4:4:4, which x264's main profile then rejects.
  filter="$filter,format=yuv420p"

  # Re-encode rather than stream-copy: the shots have independent GOP structures, and
  # concat-demuxing them without a common keyframe grid produces a visible hitch. CRF 16
  # keeps this intermediate effectively lossless — encode-hero.sh does the real
  # compression, and stacking two lossy passes would show.
  ffmpeg -hide_banner -loglevel error -y \
    -ss "$head" -t "$secs" -i "$src" \
    -vf "$filter" \
    -an -sn -dn -c:v libx264 -crf 16 -preset veryfast -g 12 \
    "$seg"

  echo "file '$seg'" >> "$LIST"
  printf "  %-10s %-6s %s\n" "$shot" "${secs}s" "$(basename "$src")"
done

ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "$LIST" \
  -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -an \
  "$WORK/joined.mp4"

if [ "${#SHOTS[@]}" -gt 1 ]; then
  mv "$WORK/joined.mp4" "$OUT"
else
  # Seamless loop for a single shot: drop the first X seconds off the front, then dissolve
  # the original first X seconds back on at the end. On playback the wrap lands mid-dissolve
  # and the join is invisible, at the cost of X seconds of runtime.
  #
  #   body = X..D   (what actually plays)      head = 0..X   (dissolved on at the tail)
  #
  # xfade's offset is where the transition starts in the *output*, i.e. body length minus X.
  D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WORK/joined.mp4")
  X="$LOOP_XFADE"
  OFFSET=$(awk -v d="$D" -v x="$X" 'BEGIN{printf "%.3f", d - x - x}')
  echo "Seamless loop: ${X}s cross-dissolve, output $(awk -v d="$D" -v x="$X" 'BEGIN{printf "%.2f", d-x}')s"

  ffmpeg -hide_banner -loglevel error -y -i "$WORK/joined.mp4" -filter_complex "
    [0:v]split=2[a][b];
    [a]trim=start=${X},setpts=PTS-STARTPTS,fps=24[body];
    [b]trim=end=${X},setpts=PTS-STARTPTS,fps=24[head];
    [body][head]xfade=transition=fade:duration=${X}:offset=${OFFSET},format=yuv420p[v]
  " -map '[v]' -c:v libx264 -crf 16 -preset slow -an "$OUT"
fi

echo
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,nb_frames \
  -show_entries format=duration,size \
  -of default=noprint_wrappers=1 "$OUT"
echo
echo "→ $OUT"
echo "  next: npm run encode:hero -- $OUT"
