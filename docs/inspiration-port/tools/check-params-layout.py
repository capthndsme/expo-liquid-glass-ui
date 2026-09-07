#!/usr/bin/env python3
"""Check that the Metal and Swift copies of the uniform structs agree byte for byte.

Both compilers lay out `float4 / float2 / float` (Metal) and `SIMD4<Float> / SIMD2<Float> / Float`
(Swift) with natural alignment — 16/8/4 bytes — so two structs agree exactly when their member
sequences produce the same offsets and the same padded size. There is no compiler on this box to
ask, so this script re-derives both layouts from the source files and diffs them.

Usage: python3 docs/inspiration-port/tools/check-params-layout.py   (from the repo root)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
METAL = ROOT / "ios/Shaders/LiquidGlass.metal"
SWIFT = ROOT / "ios/Glass/GlassRenderContext.swift"

METAL_TYPES = {"float4": (16, 16), "float2": (8, 8), "float": (4, 4)}
SWIFT_TYPES = {"SIMD4<Float>": (16, 16), "SIMD2<Float>": (8, 8), "Float": (4, 4)}


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def metal_struct(name: str) -> list[tuple[str, str]]:
    body = re.search(r"struct\s+%s\s*\{(.*?)\};" % name, strip_comments(METAL.read_text()), re.S)
    if not body:
        sys.exit(f"{METAL.name}: struct {name} not found")
    members = []
    for line in body.group(1).split(";"):
        line = line.strip()
        if not line:
            continue
        typ, ident = line.split()[:2]
        members.append((ident, typ))
    return members


def swift_struct(name: str) -> list[tuple[str, str]]:
    body = re.search(r"struct\s+%s\s*\{(.*?)\n\}" % name, strip_comments(SWIFT.read_text()), re.S)
    if not body:
        sys.exit(f"{SWIFT.name}: struct {name} not found")
    members = []
    for line in body.group(1).splitlines():
        m = re.match(r"\s*var\s+(\w+)\s*:\s*(.+?)\s*$", line)
        if m:
            members.append((m.group(1), m.group(2)))
    return members


def layout(members, types):
    offset = 0
    max_align = 1
    rows = []
    for ident, typ in members:
        if typ not in types:
            sys.exit(f"unknown type {typ!r} for {ident}")
        size, align = types[typ]
        offset = (offset + align - 1) // align * align
        rows.append((ident, typ, offset, size))
        offset += size
        max_align = max(max_align, align)
    padded = (offset + max_align - 1) // max_align * max_align
    return rows, offset, padded


def check(name: str) -> bool:
    m_rows, m_size, m_padded = layout(metal_struct(name), METAL_TYPES)
    s_rows, s_size, s_padded = layout(swift_struct(name), SWIFT_TYPES)
    ok = True
    print(f"== {name}: Metal {m_size}/{m_padded} bytes, Swift {s_size}/{s_padded} bytes")
    width = max(len(r[0]) for r in m_rows + s_rows)
    for i in range(max(len(m_rows), len(s_rows))):
        m = m_rows[i] if i < len(m_rows) else None
        s = s_rows[i] if i < len(s_rows) else None
        same = m is not None and s is not None and m[0] == s[0] and m[2] == s[2] and m[3] == s[3]
        ok &= same
        flag = "  " if same else "!!"
        ml = f"{m[0]:<{width}} {m[1]:<8} @{m[2]:>3} +{m[3]:<2}" if m else "(missing)"
        sl = f"{s[0]:<{width}} {s[1]:<13} @{s[2]:>3} +{s[3]:<2}" if s else "(missing)"
        print(f"{flag} {ml}   |   {sl}")
    if m_padded != s_padded:
        ok = False
        print("!! padded sizes differ")
    print("   OK" if ok else "   MISMATCH")
    return ok


if __name__ == "__main__":
    results = [check("BlurParams"), check("GlassParams")]
    sys.exit(0 if all(results) else 1)
