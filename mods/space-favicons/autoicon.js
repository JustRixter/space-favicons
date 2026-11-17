// Pure helpers for finding a project's favicon (no Herdr imports, so they test outside the app).

// Where picked-up favicons are copied, relative to the app folder (image() reads only there).
// A different folder from avatars.js's DATA_DIR: those copies are owned by "Set icon…".
export const AUTO_DIR = "data/space-favicons/auto";

// Shell: prints the repo's top folder (else the current one), then every favicon-ish
// file in it at any depth (a repo: git's own file list, so node_modules and other
// ignored folders cost nothing; no repo: eight folders down), relative to it.
export const FIND_SCRIPT = `
IMG='(svg|png|ico|webp|jpe?g|gif)'
PAT="(^|/)(favicon[^/]*|icon|apple-touch-icon[^/]*)\\.$IMG\$"
root=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$root" ]; then
  cd "$root" || exit 1
  echo "$root"
  # Tracked and not-ignored files at any depth, nested repos included.
  git -c core.quotepath=off ls-files -co --exclude-standard 2>/dev/null | grep -iE "$PAT" | head -300
  # Nested checkouts that git doesn't list (a folder of repos): look in them too.
  find . -mindepth 2 -maxdepth 3 -name .git -prune -print 2>/dev/null | head -50 | while read -r g; do
    d=\${g%/.git}
    (cd "$d" && git -c core.quotepath=off ls-files -co --exclude-standard 2>/dev/null | grep -iE "$PAT" | head -100 | sed "s#^#\${d#./}/#")
  done
else
  echo "$PWD"
  find . -maxdepth 8 \\( -name node_modules -o -name .git -o -name dist -o -name build -o -name target -o -name vendor -o -name .next -o -name .venv \\) -prune -o -type f -print 2>/dev/null | grep -iE "$PAT" | head -300
fi
`;

// Shell: $1 source, $2 destination folder, $3 destination extension.
// Copies (an .ico becomes a PNG through macOS's sips) under a name made of the
// file's checksum and size, so a changed favicon is a new file. Prints that name.
export const COPY_SCRIPT = `
sum=$(cksum < "$1" | tr ' ' '-'); out="$2/$sum.$3"
mkdir -p "$2" || exit 1
if [ ! -s "$out" ]; then
  case "$1" in
    *.ico|*.ICO) sips -s format png "$1" --out "$out" >/dev/null 2>&1 || { rm -f "$out"; exit 1; } ;;
    *) cp -- "$1" "$out" || exit 1 ;;
  esac
fi
echo "$sum"
`;

// Best first. An .ico needs converting, so it ranks below real images.
const EXT_RANK = { svg: 0, png: 1, webp: 2, jpg: 3, jpeg: 3, gif: 4, ico: 5 };
const NAME_RANK = [/^favicon\.[a-z]+$/i, /^favicon/i, /^icon\.[a-z]+$/i, /^apple-touch-icon/i];

const nameRank = (name) => {
  const i = NAME_RANK.findIndex((re) => re.test(name));
  return i < 0 ? NAME_RANK.length : i;
};

const extOf = (path) => {
  const name = path.split("/").pop();
  const dot = name.lastIndexOf(".");
  return dot < 1 ? null : name.slice(dot + 1).toLowerCase();
};

// What the FIND_SCRIPT printed -> { root, file } for the best favicon (file relative
// to root), or null. `canConvert`: an .ico can become a PNG here.
// Plain `favicon.svg` beats `favicon-32x32.png`; shallow beats deep (an app's own over
// a docs site's); then svg, png, ...; then the shorter name.
export function pickFavicon(output, canConvert) {
  const [root, ...rest] = String(output ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!root) return null;
  const files = rest
    .map((l) => l.replace(/^\.\//, ""))
    .filter((f) => EXT_RANK[extOf(f)] !== undefined && (canConvert || extOf(f) !== "ico"));
  files.sort((a, b) => {
    const da = a.split("/").length, db = b.split("/").length;
    const na = nameRank(a.split("/").pop()), nb = nameRank(b.split("/").pop());
    return da - db || na - nb || EXT_RANK[extOf(a)] - EXT_RANK[extOf(b)] || a.length - b.length || (a < b ? -1 : 1);
  });
  return files.length ? { root, file: files[0] } : null;
}

// The copy's extension: an .ico is stored as PNG.
export const copyExt = (file) => (extOf(file) === "ico" ? "png" : extOf(file));

// The copy's path relative to the app folder, from the checksum COPY_SCRIPT printed.
export const copyPath = (sum, file) => `${AUTO_DIR}/${sum}.${copyExt(file)}`;

// Shell, run in the checkout (or anywhere, when $2 is the remote URL, for a checkout on another machine): $1 destination folder. The picture the remote host shows
// for the project, from `origin` (else the first remote): on GitHub the owner's avatar (github.com/<owner>.png);
// on GitLab (gitlab.com or any host with "gitlab" in its name) the project's avatar, else
// its group's, from the public API; likewise Bitbucket (repository avatar), Codeberg and
// any host named gitea/forgejo (repository, else owner), and Gitee (owner). Other hosts
// (SourceHut, Azure DevOps, unnamed self-hosted ones) have no avatar to ask for.
// Saved as gh-<owner>.<ext> or rp-<checksum>.<ext>; prints that file name. Kept for a week, then fetched again (the old one stays if that
// fails). Prints nothing and fails for other hosts, private projects, or no network.
export const REMOTE_SCRIPT = `
url=$2
if [ -z "$url" ]; then
  remote=origin
  git remote get-url origin >/dev/null 2>&1 || remote=$(git remote 2>/dev/null | head -1)
  [ -n "$remote" ] || exit 1
  url=$(git remote get-url "$remote" 2>/dev/null) || exit 1
fi
rest=$(printf '%s' "$url" | sed -E 's#^(https?|ssh|git)://([^@/]+@)?##; s#^[^@/]+@##; s#^([^/:]+):([0-9]+/)#\\1/#; s#^([^/:]+):#\\1/#')
host=\${rest%%/*}; path=\${rest#*/}; path=\${path%.git}; path=\${path%/}
[ -n "$host" ] && [ "$path" != "$rest" ] && [ -n "$path" ] || exit 1
case $host in
  *github*)
    owner=\${path%%/*}
    case $owner in ''|*[!A-Za-z0-9_.-]*) exit 1 ;; esac
    key="gh-$owner"; src="https://github.com/$owner.png?size=64" ;;
  *gitlab*) kind=gitlab; api="https://$host/api/v4/projects/$(printf '%s' "$path" | sed 's#/#%2F#g')" ;;
  *bitbucket*) kind=bitbucket; api="https://api.bitbucket.org/2.0/repositories/$path" ;;
  *codeberg*|*gitea*|*forgejo*) kind=gitea; api="https://$host/api/v1/repos/$path" ;;
  *gitee*) kind=gitee; api="https://gitee.com/api/v5/repos/$path" ;;
  *) exit 1 ;;
esac
[ -n "$kind" ] && key="rp-$(printf '%s/%s' "$host" "$path" | cksum | cut -d' ' -f1)"
out="$1/$key"
mkdir -p "$1" || exit 1
have=$(ls "$out".* 2>/dev/null | head -1)
if [ -n "$have" ] && [ -s "$have" ] && [ -z "$(find "$have" -mtime +7 2>/dev/null)" ]; then echo "\${have##*/}"; exit 0; fi
if [ -z "$src" ]; then
  meta=$(curl -fsSL --max-time 10 "$api" 2>/dev/null) || meta=""
  if [ "$kind" = bitbucket ]; then
    src=$(printf '%s' "$meta" | tr -d '\n' | grep -o '"avatar": *{[^}]*}' | head -1 | grep -o 'https://[^"]*' | head -1)
  else
    src=$(printf '%s' "$meta" | grep -oE '"avatar_url": *"[^"]+"' | head -1 | sed 's/^"avatar_url": *"//; s/"$//')
  fi
  case $src in /*) src="https://$host$src" ;; esac
fi
if [ -z "$src" ]; then [ -n "$have" ] && echo "\${have##*/}" && exit 0; exit 1; fi
tmp="$out.tmp"
curl -fsSL --max-time 10 "$src" -o "$tmp" 2>/dev/null || { rm -f "$tmp"; [ -n "$have" ] && echo "\${have##*/}" && exit 0; exit 1; }
case $(file -b --mime-type "$tmp") in
  image/png) ext=png ;; image/jpeg) ext=jpg ;; image/gif) ext=gif ;; image/webp) ext=webp ;;
  *) rm -f "$tmp"; [ -n "$have" ] && echo "\${have##*/}" && exit 0; exit 1 ;;
esac
rm -f "$out".png "$out".jpg "$out".gif "$out".webp
mv "$tmp" "$out.$ext" && echo "$key.$ext"
`;

// Shell, run on the machine that has the file: $1 the file. Prints it as one line of
// base64, or fails when it is missing or too big to pass on as an argument (90 KB).
export const READ_SCRIPT = `
[ -f "$1" ] && [ "$(wc -c < "$1")" -le 90000 ] || exit 1
base64 < "$1" | tr -d '\\n '
`;

// Shell, run here: $1 the base64 a READ_SCRIPT printed, $2 destination folder, $3 the copy's extension, $4 "ico" to convert it to PNG.
// Same result as COPY_SCRIPT: the copy is named by checksum, an .ico becomes a PNG.
export const STORE_SCRIPT = `
mkdir -p "$2" || exit 1
tmp="$2/.in.$$"
{ printf '%s' "$1" | base64 -d 2>/dev/null || printf '%s' "$1" | base64 -D; } > "$tmp" 2>/dev/null
[ -s "$tmp" ] || { rm -f "$tmp"; exit 1; }
sum=$(cksum < "$tmp" | tr ' ' '-'); out="$2/$sum.\${3}"
if [ ! -s "$out" ]; then
  case "$4" in
    ico) sips -s format png "$tmp" --out "$out" >/dev/null 2>&1 || { rm -f "$tmp" "$out"; exit 1; } ;;
    *) cp -- "$tmp" "$out" ;;
  esac
fi
rm -f "$tmp"
echo "$sum"
`;
