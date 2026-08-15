# cleanroom dashboard

Zero-dependency (Node >= 22). Re-reads `<dir>/redacted.jsonl` + `<dir>/ledger.jsonl` every poll, so a live Sentinel run shows up within 2s.

    node dashboard/server.js --dir dashboard/fixtures   # standalone demo, synthetic PII
    node dashboard/server.js --dir out --port 4600      # live run (defaults: out, 4600)
    node --test dashboard/test/*.test.js                # tests

Open <http://localhost:4600>; `/api/state` is the JSON the UI polls, `/healthz` the probe. Missing
output files are fine. "simulate tamper" edits one row in the browser only. Hosted: see render.yaml.
