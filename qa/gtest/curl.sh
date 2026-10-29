UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
for u in "https://embed-cdn.gettyimages.com/widgets.js" "https://embed.gettyimages.com/embed/2287092991?et=c3M8KgJzQt53IOOYOcWPmw&tld=com&sig=iYuykixLlvAr02-FAwybhBf9RWLnabvM5L4JSTsNj5E%3D&caption=false&ver=1"; do
  r=$(curl -sS -o /tmp/b -m 30 -A "$UA" -H "Referer: https://cricforgeek.site/" -w "%{http_code} %{content_type} %{size_download}" "$u" 2>&1)
  echo "::notice::getty curl $u -> $r :: $(head -c 300 /tmp/b | tr '\n' ' ' | tr -d '\r')"
done
