#!/usr/bin/env python3
"""Convierte una fuente WOFF 1.0 a TTF (stb_truetype no lee WOFF). Uso: woff_to_ttf.py in.woff out.ttf"""
import struct
import sys
import zlib


def convert(src: bytes) -> bytes:
    sig, flavor, _length, num_tables = struct.unpack('>4sIIH', src[:14])
    if sig != b'wOFF':
        raise SystemExit('no es WOFF 1.0')
    tables = []
    for i in range(num_tables):
        tag, offset, comp, orig, checksum = struct.unpack('>4sIIII', src[44 + 20 * i:44 + 20 * (i + 1)])
        data = src[offset:offset + comp]
        if comp < orig:
            data = zlib.decompress(data)
        if len(data) != orig:
            raise SystemExit(f'tabla {tag!r}: tamaño inesperado')
        tables.append((tag, checksum, data))
    tables.sort(key=lambda t: t[0])
    entry_selector = num_tables.bit_length() - 1
    search_range = (1 << entry_selector) * 16
    out = bytearray(struct.pack('>IHHHH', flavor, num_tables, search_range, entry_selector, num_tables * 16 - search_range))
    offset = 12 + 16 * num_tables
    body = bytearray()
    for tag, checksum, data in tables:
        out += struct.pack('>4sIII', tag, checksum, offset + len(body), len(data))
        body += data + b'\0' * (-len(data) % 4)
    return bytes(out + body)


if __name__ == '__main__':
    with open(sys.argv[1], 'rb') as f:
        ttf = convert(f.read())
    with open(sys.argv[2], 'wb') as f:
        f.write(ttf)
    print(f'{sys.argv[2]}: {len(ttf)} bytes')
