#!/bin/bash
# Open 论文星图 in its own window. Finder runs this with a short PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  LINK_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$LINK_DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT=47321
RUN="$ROOT/.run"
URL="http://127.0.0.1:${PORT}/"
PIDFILE="$RUN/server.pid"
PROFILE="$RUN/chrome-app"
mkdir -p "$RUN"

python_bin=""
for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [[ -x "$candidate" ]]; then
    python_bin="$candidate"
    break
  fi
done

server_up() {
  curl -sf -o /dev/null --max-time 1 "$URL"
}

if ! server_up; then
  if [[ ! -f "$ROOT/dist/index.html" ]]; then
    osascript -e 'display dialog "论文星图还没有构建好的页面。" buttons {"好"} default button 1 with title "论文星图"'
    exit 1
  fi
  if [[ -z "$python_bin" ]]; then
    osascript -e 'display dialog "没有找到 Python，页面无法在本机打开。" buttons {"好"} default button 1 with title "论文星图"'
    exit 1
  fi
  nohup "$python_bin" "$ROOT/scripts/serve_dist.py" --root "$ROOT/dist" --port "$PORT" >>"$RUN/server.log" 2>&1 &
  echo $! >"$PIDFILE"
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    server_up && break
    sleep 0.15
  done
fi

if ! server_up; then
  osascript -e 'display dialog "页面服务没有启动。可以查看项目里的 .run/server.log。" buttons {"好"} default button 1 with title "论文星图"'
  exit 1
fi

if [[ -d "/Applications/Google Chrome.app" ]]; then
  open -na "Google Chrome" --args "--user-data-dir=$PROFILE" --no-first-run --disable-default-apps --app="$URL"
else
  open "$URL"
fi
