#!/usr/bin/env python3
"""Giriş şifreli, kalıcı SQLite tabanlı ortak teklif sunucusu."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from http.cookies import SimpleCookie
import argparse, base64, gzip, hashlib, hmac, json, os, secrets, sqlite3, threading, time, webbrowser

HERE = Path(__file__).resolve().parent
STORE = Path(os.environ.get("KALDE_DATA_DIR", str(HERE / "data"))).resolve()
DATABASE = STORE / "kalde_shared.sqlite3"
MAX_DATA_BYTES = 20 * 1024 * 1024
LOCK = threading.Lock()
PASSWORD = os.environ.get("KALDE_SHARED_PASSWORD")
SECRET = os.environ.get("KALDE_SESSION_SECRET")
IS_PUBLIC = bool(os.environ.get("RAILWAY_ENVIRONMENT")) or os.environ.get("KALDE_PUBLIC") == "1"
if not PASSWORD:
    if IS_PUBLIC: raise SystemExit("Ortak sunucu sifresi eksik: KALDE_SHARED_PASSWORD")
    PASSWORD = secrets.token_urlsafe(16)
    print("YEREL GIRIS SIFRESI: " + PASSWORD, flush=True)
if not SECRET:
    if IS_PUBLIC: raise SystemExit("Oturum gizli anahtari eksik: KALDE_SESSION_SECRET")
    SECRET = secrets.token_hex(32)
if IS_PUBLIC and not os.environ.get("KALDE_DATA_DIR"):
    raise SystemExit("Kalici veri dizini gerekli: KALDE_DATA_DIR=/data")
STORE.mkdir(parents=True, exist_ok=True)

def connect():
    con = sqlite3.connect(str(DATABASE), timeout=15, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=15000")
    con.execute("PRAGMA journal_mode=WAL")
    return con

def init_db():
    with connect() as con:
        con.execute("CREATE TABLE IF NOT EXISTS shared_state (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL DEFAULT 0, payload TEXT, updated_at INTEGER NOT NULL DEFAULT 0)")
        con.execute("CREATE TABLE IF NOT EXISTS revisions (revision INTEGER PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)")
        con.execute("INSERT OR IGNORE INTO shared_state (id,revision,payload,updated_at) VALUES (1,0,NULL,0)")
init_db()

# Local rolling safety copies: one JSON snapshot per UTC day with write activity.
# Stored on the Railway volume, not an independent off-site backup.
BACKUPS = STORE / "daily-json-backups"
BACKUPS.mkdir(parents=True, exist_ok=True)
def save_daily_backup(compact, revision, timestamp):
    label=time.strftime("%Y-%m-%d",time.gmtime(timestamp))
    target=BACKUPS / (label+".json.gz")
    temporary=BACKUPS / ("."+label+".tmp")
    try:
        temporary.write_bytes(gzip.compress(compact.encode("utf-8"),compresslevel=6))
        os.replace(str(temporary),str(target))
        dated=sorted(BACKUPS.glob("????-??-??.json.gz"))
        for obsolete in dated[:-30]:
            obsolete.unlink(missing_ok=True)
    except Exception as exc:
        print("Gunluk JSON kopyasi kaydedilemedi: "+str(exc),flush=True)
        try: temporary.unlink(missing_ok=True)
        except OSError: pass

def latest():
    with connect() as con:
        row=con.execute("SELECT revision,payload,updated_at FROM shared_state WHERE id=1").fetchone()
        return {"revision":row["revision"], "data":json.loads(row["payload"]) if row["payload"] else None, "updatedAt":row["updated_at"]}

def commit_state(data, expected):
    compact=json.dumps(data,ensure_ascii=False,separators=(",",":"))
    if len(compact.encode("utf-8"))>MAX_DATA_BYTES: return ("too_big",None)
    now=int(time.time())
    with LOCK, connect() as con:
        con.execute("BEGIN IMMEDIATE")
        row=con.execute("SELECT revision,payload,updated_at FROM shared_state WHERE id=1").fetchone()
        old=row["revision"]
        if expected!=old:
            con.rollback()
            return ("conflict",old)
        if row["payload"] is not None:
            con.execute("INSERT OR IGNORE INTO revisions (revision,payload,updated_at) VALUES (?,?,?)",(old,row["payload"],row["updated_at"]))
        new=old+1
        con.execute("UPDATE shared_state SET revision=?,payload=?,updated_at=? WHERE id=1 AND revision=?",(new,compact,now,old))
        con.execute("DELETE FROM revisions WHERE revision < ?",(max(0,new-100),))
        con.commit()
        save_daily_backup(compact,new,now)
        return ("ok",new)

def issue_cookie():
    expires=str(int(time.time())+7*86400)
    signature=hmac.new(SECRET.encode(),expires.encode(),hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode((expires+"."+signature).encode()).decode()

def authorized(headers):
    parsed=SimpleCookie()
    try: parsed.load(headers.get("Cookie",""))
    except Exception: return False
    if "kalde_session" not in parsed: return False
    try:
        expires,signature=base64.urlsafe_b64decode(parsed["kalde_session"].value.encode()).decode().split(".",1)
        if int(expires)<time.time(): return False
        expected=hmac.new(SECRET.encode(),expires.encode(),hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature,expected)
    except Exception: return False

LOGIN = """<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Teklif Merkezi | Güvenli Giriş</title><style>*{box-sizing:border-box}body{background:#f5f7fb;min-height:100vh;display:grid;place-items:center;font-family:system-ui,Arial;padding:20px;color:#193449}.card{max-width:420px;width:100%;background:white;border:1px solid #dae5ea;border-radius:16px;padding:32px;box-shadow:0 12px 40px #20446112}.logo{font-weight:900;letter-spacing:.08em;font-size:26px;color:#103653}.sub{color:#597083;font-size:14px;line-height:1.6}label{font-size:13px;font-weight:800;display:block;margin-top:25px}input{display:block;width:100%;border:1px solid #ccdce5;padding:14px;margin:8px 0 17px;border-radius:8px;font-size:16px}button{width:100%;padding:14px;border:0;border-radius:8px;background:#f28c28;color:#102b4e;font-weight:800;font-size:15px;cursor:pointer}.err{background:#fff0ec;color:#a84233;padding:12px;border-radius:8px;font-size:13px}</style></head><body><form class="card" method="post" action="/login"><div class="logo">TEKLİF MERKEZİ</div><h2>Akıllı Teklif Merkezi</h2><p class="sub">Paylaşılan fiyat listeleri, iskontolar ve tekliflere erişmek için ekip şifresini girin.</p>__ERROR__<label for="pass">Ekip giriş şifresi</label><input id="pass" type="password" name="password" required autocomplete="current-password"><button type="submit">Giriş yap</button><p class="sub">Bu sayfa yalnızca yetkili kişiler içindir.</p></form></body></html>"""

class Handler(BaseHTTPRequestHandler):
    server_version="SharedQuotes/3.8"
    def common(self,status,ctype,length,extras=None):
        self.send_response(status)
        self.send_header("Content-Type",ctype)
        self.send_header("Content-Length",str(length))
        self.send_header("Cache-Control","no-store, private")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("X-Frame-Options","DENY")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("X-Kalde-Server","1")
        for k,v in (extras or {}).items(): self.send_header(k,v)
        self.end_headers()
    def respond(self,status,payload,extras=None):
        body=json.dumps(payload,ensure_ascii=False).encode()
        self.common(status,"application/json; charset=utf-8",len(body),extras)
        self.wfile.write(body)
    def html(self,status,content,extras=None):
        body=content.encode() if isinstance(content,str) else content
        self.common(status,"text/html; charset=utf-8",len(body),extras)
        self.wfile.write(body)
    def redirect(self,to,extras=None):
        self.send_response(303)
        self.send_header("Location",to)
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length","0")
        for k,v in (extras or {}).items(): self.send_header(k,v)
        self.end_headers()
    def cookie_opts(self):
        secured=(os.environ.get("KALDE_APP_ORIGIN","").startswith("https://") or self.headers.get("X-Forwarded-Proto","").split(",")[0].strip()=="https")
        return "; HttpOnly; Path=/; SameSite=Strict"+("; Secure" if secured else "")
    def is_auth(self): return authorized(self.headers)
    def origin_ok(self):
        origin=(self.headers.get("Origin") or "").strip().rstrip("/")
        if not origin:
            return True
        # Railway is a reverse proxy: the internal Host may differ from
        # the public browser origin. Permit only our explicit HTTPS origin.
        published_origin=os.environ.get("KALDE_APP_ORIGIN","").strip().rstrip("/")
        if published_origin:
            return hmac.compare_digest(origin,published_origin)
        host=self.headers.get("Host","").strip()
        return origin in ("https://"+host,"http://"+host)
    def do_GET(self):
        path=urlsplit(self.path).path
        if path=="/healthz":
            try:
                with connect() as con: con.execute("SELECT 1").fetchone()
                return self.respond(200,{"ok":True,"persistent":bool(os.environ.get("KALDE_DATA_DIR"))})
            except Exception: return self.respond(503,{"ok":False})
        if path=="/login":
            if self.is_auth():return self.redirect("/")
            return self.html(200,LOGIN.replace("__ERROR__",""))
        if not self.is_auth():
            if path.startswith("/api/"):return self.respond(401,{"error":"Oturum açmanız gerekiyor."})
            return self.redirect("/login")
        if path in ("/","/index.html"):return self.html(200,(HERE/"index.html").read_bytes())
        if path=="/api/state":return self.respond(200,latest())
        if path=="/api/daily-backups":
            items=[{"file":p.name[:-3],"size":p.stat().st_size} for p in sorted(BACKUPS.glob("????-??-??.json.gz"),reverse=True)]
            return self.respond(200,{"backups":items,"retentionDays":30,"sameVolume":True})
        if path.startswith("/api/daily-backups/"):
            name=path.rsplit("/",1)[-1]
            if len(name)!=15 or not name.endswith(".json") or any(c not in "0123456789-.json" for c in name):
                return self.respond(400,{"error":"Geçersiz günlük yedek adı"})
            if not __import__("re").fullmatch(r"\d{4}-\d{2}-\d{2}\.json",name):
                return self.respond(400,{"error":"Geçersiz günlük yedek adı"})
            file=BACKUPS/(name+".gz")
            if not file.is_file():return self.respond(404,{"error":"Yedek bulunamadı"})
            body=gzip.decompress(file.read_bytes())
            self.common(200,"application/json; charset=utf-8",len(body),{"Content-Disposition":'attachment; filename="'+name+'"'})
            return self.wfile.write(body)
        if path=="/api/previous-state":
            with connect() as con: row=con.execute("SELECT revision,payload FROM revisions ORDER BY revision DESC LIMIT 1").fetchone()
            return self.respond(200,{"data":json.loads(row["payload"]),"revision":row["revision"]}) if row else self.respond(404,{"error":"Önceki kayıt yok"})
        return self.respond(404,{"error":"Bulunamadı"})
    def do_POST(self):
        path=urlsplit(self.path).path
        if path=="/logout":
            return self.redirect("/login",{"Set-Cookie":"kalde_session=; Max-Age=0"+self.cookie_opts()})
        if path!="/login":return self.respond(404,{"error":"Bulunamadı"})
        # Login form uses an authenticated password and is served by this same app.
        # Railway's reverse proxy may rewrite Host/Origin differently; do not
        # reject the form due to proxy headers. Password is still mandatory.
        try:n=int(self.headers.get("Content-Length","0"))
        except ValueError:n=0
        if n<0 or n>2048:return self.respond(413,{"error":"Form çok büyük"})
        form=parse_qs(self.rfile.read(n).decode("utf-8","replace"))
        supplied=(form.get("password") or [""])[0]
        if hmac.compare_digest(supplied,PASSWORD):
            return self.redirect("/",{"Set-Cookie":"kalde_session="+issue_cookie()+self.cookie_opts()})
        return self.html(403,LOGIN.replace("__ERROR__",'<p class="err">Şifre yanlış. Tekrar deneyin.</p>'))
    def do_PUT(self):
        if urlsplit(self.path).path!="/api/state":return self.respond(404,{"error":"Bulunamadı"})
        if not self.is_auth():return self.respond(401,{"error":"Oturum süresi doldu. Tekrar giriş yapın."})
        # Authenticated JSON PUT requires a non-simple custom header.
        # Cross-origin pages cannot send it with cookies: no permissive CORS,
        # SameSite=Strict cookies, and browsers enforce preflight checks.
        # This is reliable behind Railway's reverse proxy.
        if self.headers.get("X-Kalde-Request")!="shared-state":
            return self.respond(403,{"error":"Güvenlik doğrulaması başarısız"})
        if "application/json" not in self.headers.get("Content-Type",""):return self.respond(415,{"error":"JSON gerekir"})
        try:n=int(self.headers.get("Content-Length","0"))
        except ValueError:n=0
        if n<=0 or n>MAX_DATA_BYTES+1000:return self.respond(413,{"error":"Veri çok büyük"})
        try:
            obj=json.loads(self.rfile.read(n))
            data=obj["data"]; expected=obj["expectedRevision"]
            if not isinstance(data,dict) or not all(isinstance(data.get(k),list) for k in ("products","groups","offers","dictionary")):
                raise ValueError("Geçersiz katalog verisi")
            if not isinstance(expected,int) or isinstance(expected,bool) or expected<0:
                raise ValueError("Geçersiz sürüm numarası")
            result,revision=commit_state(data,expected)
            if result=="conflict":return self.respond(409,{"error":"Başka kullanıcı daha yeni bir değişiklik kaydetti.","revision":revision})
            if result=="too_big":return self.respond(413,{"error":"Veri sınırı 20 MB"})
            return self.respond(200,{"ok":True,"revision":revision})
        except (ValueError,KeyError,TypeError) as exc:return self.respond(400,{"error":str(exc)})

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--host",default="127.0.0.1")
    parser.add_argument("--port",type=int,default=int(os.environ.get("PORT","8768")))
    parser.add_argument("--no-browser",action="store_true")
    args=parser.parse_args()
    httpd=ThreadingHTTPServer((args.host,args.port),Handler)
    print("TEKLIF MERKEZI | sqlite: "+str(DATABASE),flush=True)
    if not args.no_browser: threading.Timer(.5,lambda:webbrowser.open("http://127.0.0.1:"+str(args.port))).start()
    try:httpd.serve_forever()
    except KeyboardInterrupt:pass
    finally:httpd.server_close()
