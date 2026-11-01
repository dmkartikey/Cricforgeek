"""Nets analyser API (runs on Google Cloud Run).

POST /v1/upload   {size, type}                      -> {job, url}   a one-time link to upload the clip to private storage
POST /v1/link     {url}                             -> {job, W, H, fps, frames, stills}  fetch a clip from a sharing link
POST /v1/analyse  {job, taps, W, H, slow, lens}     -> a stream of JSON lines: progress, then the result
The clip is deleted as soon as the analysis ends (and a storage rule removes anything left after a day).
"""
import asyncio, json, os, queue, re, tempfile, threading, time, uuid
from collections import defaultdict, deque
from datetime import timedelta

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from nets.pipeline import analyse, probe, proc_size
from server.links import fetch as fetch_link, stills as make_stills, LinkError

BUCKET = os.environ.get("NETS_BUCKET", "")
WEIGHTS = os.environ.get("NETS_WEIGHTS", os.path.join(os.path.dirname(__file__), "..", "models", "ballnet.json"))
ORIGINS = [o for o in os.environ.get("NETS_ORIGINS", "https://cricforgeek.site").split(",") if o]
MAX_BYTES = int(os.environ.get("NETS_MAX_MB", "400")) * 1024 * 1024
PER_HOUR = int(os.environ.get("NETS_PER_HOUR", "30"))

app = FastAPI(title="cricforgeek nets analyser", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["POST", "GET"], allow_headers=["content-type"], max_age=3600)

_hits = defaultdict(deque)
_storage = None


def storage():
    global _storage
    if _storage is None:
        from google.cloud import storage as gcs
        _storage = gcs.Client()
    return _storage


def _limit(req: Request):
    """A simple per-address cap so one visitor can't run up the bill."""
    ip = (req.headers.get("x-forwarded-for") or req.client.host or "?").split(",")[0].strip()
    q, now = _hits[ip], time.time()
    while q and q[0] < now - 3600:
        q.popleft()
    if len(q) >= PER_HOUR:
        raise HTTPException(429, "Too many analyses from this connection in the last hour. Please try again later.")
    q.append(now)


def _signed_put(name, ctype):
    """A V4 signed upload link, signed by the service's own identity (no key files on the server)."""
    import google.auth
    from google.auth.transport import requests as greq
    creds, _ = google.auth.default()
    creds.refresh(greq.Request())
    blob = storage().bucket(BUCKET).blob(name)
    return blob.generate_signed_url(version="v4", expiration=timedelta(minutes=20), method="PUT", content_type=ctype,
                                    service_account_email=creds.service_account_email, access_token=creds.token)


@app.get("/healthz")
def health():
    return {"ok": True}


@app.post("/v1/upload")
async def upload(req: Request):
    _limit(req)
    body = await req.json()
    size, ctype = int(body.get("size", 0)), str(body.get("type") or "video/mp4")
    if not (0 < size <= MAX_BYTES):
        raise HTTPException(413, f"Clips up to {MAX_BYTES // (1024 * 1024)} MB, please. Trim the video to the deliveries.")
    if not re.fullmatch(r"video/[\w.+-]+", ctype):
        raise HTTPException(415, "That doesn't look like a video file.")
    job = uuid.uuid4().hex
    return {"job": job, "url": _signed_put(f"clips/{job}", ctype), "type": ctype}


@app.post("/v1/link")
async def link(req: Request):
    """Fetch a clip from a Google Drive / Dropbox / OneDrive / direct link into private storage, and send back a few
    frames to mark the pitch on."""
    _limit(req)
    body = await req.json()
    url = str(body.get("url", ""))[:2000]
    job = uuid.uuid4().hex
    fd, path = tempfile.mkstemp(suffix=".mp4", dir="/tmp")
    os.close(fd)

    def work():
        fetch_link(url, path, MAX_BYTES)
        w, h, times = probe(path)
        W, H = proc_size(w, h)
        pics = make_stills(path, W, H)
        storage().bucket(BUCKET).blob(f"clips/{job}").upload_from_filename(path, content_type="video/mp4")
        fps = (len(times) - 1) / max(times[-1] - times[0], 1e-6) if len(times) > 1 else 0
        return {"job": job, "W": W, "H": H, "fps": fps, "frames": len(times), "stills": pics}
    try:
        return await asyncio.to_thread(work)
    except LinkError as e:
        raise HTTPException(422, str(e))
    except Exception:
        raise HTTPException(502, "That link couldn't be fetched. Check it's shared publicly and try again.")
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def _valid_taps(taps):
    out = []
    for t in taps[:30]:
        u, v, X = float(t["u"]), float(t["v"]), [float(x) for x in t["X"]]
        if len(X) != 3 or not all(abs(x) < 50 for x in X):
            raise ValueError("bad point")
        out.append({"u": u, "v": v, "X": X})
    if len(out) < 4:
        raise ValueError("Mark at least four points on the pitch.")
    return out


@app.post("/v1/analyse")
async def run(req: Request):
    body = await req.json()
    job = str(body.get("job", ""))
    if not re.fullmatch(r"[0-9a-f]{32}", job):
        raise HTTPException(400, "Unknown upload.")
    try:
        taps = _valid_taps(body.get("taps") or [])
        W, H = int(body["W"]), int(body["H"])
        slow = float(body.get("slow", 1)); lens = str(body.get("lens", "normal"))
        assert 0 < W <= 4096 and 0 < H <= 4096 and slow in (1, 2, 4, 8) and lens in ("normal", "zoomed", "wide")
    except (KeyError, ValueError, TypeError, AssertionError) as e:
        raise HTTPException(400, str(e) if isinstance(e, ValueError) and str(e) else "Bad request.")

    q: "queue.Queue[dict]" = queue.Queue()

    def work():
        blob = storage().bucket(BUCKET).blob(f"clips/{job}")
        fd, path = tempfile.mkstemp(suffix=".mp4", dir="/tmp")
        os.close(fd)
        try:
            q.put({"type": "progress", "stage": "loading", "done": 0, "total": 1})
            blob.download_to_filename(path)
            res = analyse(path, taps, W, H, WEIGHTS, slow=slow, lens=lens,
                          progress=lambda s, d, n: q.put({"type": "progress", "stage": s, "done": d, "total": n}))
            q.put({"type": "done", "result": res})
        except Exception as e:  # report a plain message, never a trace
            msg = str(e) if isinstance(e, ValueError) else "The analysis failed on this clip."
            if "No such object" in str(e) or "404" in str(e):
                msg = "The upload wasn't found. Please try again."
            q.put({"type": "error", "message": msg})
        finally:
            try:
                blob.delete()
            except Exception:
                pass
            try:
                os.remove(path)
            except OSError:
                pass
            q.put(None)

    threading.Thread(target=work, daemon=True).start()

    async def stream():
        last = 0.0
        while True:
            try:
                m = q.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.15)
                if time.time() - last > 10:  # keep the connection alive
                    last = time.time()
                    yield "{\"type\":\"ping\"}\n"
                continue
            if m is None:
                break
            if m["type"] == "progress":
                if time.time() - last < 0.25 and m["done"] not in (0, m["total"]):
                    continue
                last = time.time()
            yield json.dumps(m, separators=(",", ":")) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson", headers={"cache-control": "no-store"})
