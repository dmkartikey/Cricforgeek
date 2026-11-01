"""Fetching a clip from a link the user pastes (Google Drive, Dropbox, OneDrive or a direct video link).

YouTube and similar platforms are refused with an explanation: their terms don't allow other sites to download their
videos, and they block servers that try. Only public internet addresses are fetched (never this server's own network),
only video files, and only up to the size limit.
"""
import ipaddress, re, socket, subprocess, base64, os
from urllib.parse import urlparse, parse_qs, urlencode

import requests

PLATFORMS = ("youtube.com", "youtu.be", "youtube-nocookie.com", "instagram.com", "tiktok.com", "facebook.com", "fb.watch",
             "x.com", "twitter.com", "vimeo.com")
PLATFORM_MSG = ("That link is from {name}, which doesn't allow other sites to download its videos, so we can't fetch it. "
                "If it's your video, download the original (on YouTube: Studio → Content → ⋮ → Download) and choose the "
                "file here, or share it from Google Drive or Dropbox and paste that link.")


class LinkError(ValueError):
    pass


def _host_ok(host):
    """Only public addresses: no localhost, private ranges or cloud metadata servers."""
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise LinkError("That link's address couldn't be found.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            raise LinkError("That link points somewhere we can't fetch from.")


def direct_url(url):
    """The direct-download form of a sharing link, or a LinkError explaining why it can't be used."""
    u = urlparse(url.strip())
    if u.scheme not in ("https", "http") or not u.hostname:
        raise LinkError("Paste a full link starting with https://")
    host = u.hostname.lower()
    for p in PLATFORMS:
        if host == p or host.endswith("." + p):
            name = {"youtu.be": "YouTube", "youtube-nocookie.com": "YouTube", "fb.watch": "Facebook", "x.com": "X",
                    "twitter.com": "X"}.get(p, p.split(".")[0].capitalize().replace("Youtube", "YouTube").replace("Tiktok", "TikTok"))
            raise LinkError(PLATFORM_MSG.format(name=name))
    if host in ("drive.google.com", "docs.google.com"):
        m = re.search(r"/d/([\w-]{20,})", u.path) or re.search(r"[?&]id=([\w-]{20,})", url)
        if not m:
            raise LinkError("That Google Drive link has no file in it. Use Share → Copy link on the video file.")
        return f"https://drive.usercontent.google.com/download?id={m.group(1)}&export=download&confirm=t"
    if host.endswith("dropbox.com"):
        q = parse_qs(u.query); q["dl"] = ["1"]
        return u._replace(query=urlencode({k: v[0] for k, v in q.items()})).geturl()
    if host in ("1drv.ms", "onedrive.live.com"):
        enc = base64.urlsafe_b64encode(url.strip().encode()).decode().rstrip("=")
        return f"https://api.onedrive.com/v1.0/shares/u!{enc}/root/content"
    return url.strip()


def fetch(url, dest, max_bytes, timeout=120):
    """Downloads the clip to dest, checking every redirect's address and the size as it goes."""
    nxt = direct_url(url)
    s = requests.Session()
    for _ in range(6):
        _host_ok(urlparse(nxt).hostname)
        r = s.get(nxt, stream=True, timeout=(10, 30), allow_redirects=False, headers={"user-agent": "cricforgeek-nets/1.0"})
        if r.is_redirect or r.status_code in (301, 302, 303, 307, 308):
            nxt = requests.compat.urljoin(nxt, r.headers.get("location", ""))
            r.close()
            continue
        break
    else:
        raise LinkError("That link redirects too many times.")
    if r.status_code == 403 or r.status_code == 401:
        raise LinkError("That file isn't shared publicly. Set it to \"Anyone with the link can view\" and try again.")
    if r.status_code != 200:
        raise LinkError(f"The link didn't return a video (error {r.status_code}).")
    ctype = r.headers.get("content-type", "")
    if "text/html" in ctype:
        raise LinkError("That link opens a web page, not a video file. Share the video file itself.")
    size = int(r.headers.get("content-length") or 0)
    if size > max_bytes:
        raise LinkError(f"That video is over {max_bytes // (1024 * 1024)} MB. Trim it to the deliveries first.")
    got = 0
    import time
    t0 = time.time()
    with open(dest, "wb") as fh:
        for chunk in r.iter_content(1 << 20):
            got += len(chunk)
            if got > max_bytes:
                raise LinkError(f"That video is over {max_bytes // (1024 * 1024)} MB. Trim it to the deliveries first.")
            if time.time() - t0 > timeout:
                raise LinkError("The download took too long. Try a shorter clip.")
            fh.write(chunk)
    # it must really be a video
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type",
                          "-of", "csv=p=0", dest], capture_output=True, text=True)
    if "video" not in out.stdout:
        raise LinkError("That file isn't a video we can read.")
    return got


def stills(path, W, H, fractions=(1 / 3, 0.05, 0.6, 0.85, 0.2)):
    """A few JPEG frames at the processing size, for marking the pitch."""
    from nets.pipeline import probe
    _, _, times = probe(path)
    dur = (times[-1] if times else 10.0)
    out = []
    for f in fractions:
        p = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{dur * f:.3f}", "-i", path, "-frames:v", "1", "-vf",
                            f"scale={W}:{H}", "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "-"], capture_output=True)
        if p.stdout:
            out.append("data:image/jpeg;base64," + base64.b64encode(p.stdout).decode())
    return out
