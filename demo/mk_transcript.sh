#!/usr/bin/env bash
# Usage: mk_transcript.sh <session-text-file> <out.jsonl>
python3 -c "
import json,sys
text=open(sys.argv[1]).read()
print(json.dumps({'id':'live-demo','text':text,'planted':[]}))
" "$1" > "$2"
