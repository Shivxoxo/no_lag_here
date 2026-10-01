#!/bin/bash
# Assemble final book: sections + appendix -> final/ ; run checks ; build HTML + PDF
set -e
B=/tmp/claude-0/-home-user-no-lag-here/1c4eed2f-eb55-532f-b143-a5d948e32181/scratchpad/book
S=/tmp/claude-0/-home-user-no-lag-here/1c4eed2f-eb55-532f-b143-a5d948e32181/scratchpad/src
rm -rf $B/final && mkdir -p $B/final
cp $B/sections/*.md $B/final/
cp $B/appendix/*.md $B/final/
echo "== files =="; ls $B/final
echo "== quotation check =="
fail=0
for f in $B/final/*.md; do python3 $S/check_quotes.py "$f" | grep -v "^# checked" || true; done
echo "== consistency check =="
python3 $S/consistency_check.py $B/final
echo "== build =="
python3 $B/build/build.py $B/final $B/build/book.html --pdf $B/build/JuliusCaesar_Act1_MasterCourse_ICSE.pdf
echo "== done =="
