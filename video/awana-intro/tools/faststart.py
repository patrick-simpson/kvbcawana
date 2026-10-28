"""Move an .mp4's index (the moov box) in front of its picture data.

A browser cannot start a video until it has read the index. Blender's encoder
writes it at the END of the file, so a TV would first have to fetch the end
(one more round trip through the site's streaming Function) before playing a
frame. With it in front, the first request carries everything needed to start.

Plain Python, no ffmpeg: the boxes are shifted and every chunk offset (stco,
co64) is moved by the index's size. Used by awana_intro.py when it writes the
lobby's copy; also runs on its own:

    python tools/faststart.py in.mp4 out.mp4      (out may be the same file)
"""
import struct
import sys


def _boxes(data, start, end):
    """(type, start, size, header) for each box in data[start:end]."""
    out = []
    at = start
    while at + 8 <= end:
        size, kind = struct.unpack(">I4s", data[at:at + 8])
        header = 8
        if size == 1:
            size = struct.unpack(">Q", data[at + 8:at + 16])[0]
            header = 16
        elif size == 0:
            size = end - at
        if size < header or at + size > end:
            raise ValueError(f"broken box {kind!r} at {at}")
        out.append((kind.decode("latin-1"), at, size, header))
        at += size
    return out


CONTAINERS = {"moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "udta", "mvex"}


def _shift_offsets(moov, delta):
    """Every chunk offset inside moov, moved by delta (a bytearray, in place)."""
    def walk(start, end):
        for kind, at, size, header in _boxes(moov, start, end):
            body = at + header
            if kind in CONTAINERS:
                walk(body, at + size)
            elif kind == "stco":
                n = struct.unpack(">I", moov[body + 4:body + 8])[0]
                for i in range(n):
                    p = body + 8 + 4 * i
                    v = struct.unpack(">I", moov[p:p + 4])[0] + delta
                    if v > 0xFFFFFFFF:
                        raise ValueError("offset no longer fits in stco")
                    moov[p:p + 4] = struct.pack(">I", v)
            elif kind == "co64":
                n = struct.unpack(">I", moov[body + 4:body + 8])[0]
                for i in range(n):
                    p = body + 8 + 8 * i
                    v = struct.unpack(">Q", moov[p:p + 8])[0] + delta
                    moov[p:p + 8] = struct.pack(">Q", v)
    walk(0, len(moov))


def faststart(src, dst=None):
    """Rewrite src (to dst, default in place) with its index first. Returns
    True if it moved anything, False if the file was already that way."""
    with open(src, "rb") as fh:
        data = fh.read()
    top = _boxes(data, 0, len(data))
    kinds = [k for k, *_ in top]
    if "moov" not in kinds or "mdat" not in kinds:
        raise ValueError(f"{src} is not a plain mp4 (no moov/mdat)")
    if kinds.index("moov") < kinds.index("mdat"):
        if dst and dst != src:
            with open(dst, "wb") as fh:
                fh.write(data)
        return False
    _, at, size, _ = top[kinds.index("moov")]
    moov = bytearray(data[at:at + size])
    # Everything before mdat (ftyp, free...) stays first, then the index,
    # then the rest; the picture data moves down by the index's size.
    first = kinds.index("mdat")
    _shift_offsets(moov, size)
    out = bytearray()
    for kind, b_at, b_size, _ in top[:first]:
        out += data[b_at:b_at + b_size]
    out += moov
    for kind, b_at, b_size, _ in top[first:]:
        if kind != "moov":
            out += data[b_at:b_at + b_size]
    with open(dst or src, "wb") as fh:
        fh.write(out)
    return True


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    moved = faststart(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)
    print("index moved to the front" if moved else "index was already in front")
