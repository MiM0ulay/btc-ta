"""Generate masterPrompt.js from master_prompt.md"""
import json, pathlib

src = pathlib.Path("master_prompt.md")
dst = pathlib.Path("btc-ta-mobile/src/masterPrompt.js")

content = src.read_text(encoding="utf-8")
dst.write_text(
    f"// Auto-generated from master_prompt.md — do not edit manually\nexport default {json.dumps(content)};\n",
    encoding="utf-8"
)
print(f"Done: {len(content)} chars → {dst}")
