import { useData } from '../lib/data';

// Getty Images embeds for players with no free-licence photo. This is Getty's own embedded viewer (the frame their
// embed code creates), showing their image and credit unmodified, which their terms allow for non-commercial sites.
// No Getty script runs on our pages: the viewer is a frame served by Getty.
// photos/getty.json: {player id: [embed id, signature, image id, width, height, credit]}
export type GettyEntry = [string, string, string, number, number, string];

export function useGetty() {
  return useData<Record<string, GettyEntry>>('photos/getty.json').data ?? {};
}

export default function GettyPhoto({ e, width, height, className }: { e: GettyEntry; width: number; height?: number; className?: string }) {
  const [embedId, sig, imageId, w, h, credit] = e;
  const H = height ?? Math.round((width * h) / w);
  const src = `https://embed.gettyimages.com/embed/${imageId}?et=${encodeURIComponent(embedId)}&tld=com&sig=${encodeURIComponent(sig)}&caption=false&ver=1`;
  return (
    <div className={`getty${className ? ' ' + className : ''}`} style={{ width, height: H }}>
      <iframe src={src} width={width} height={H} title={credit} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" scrolling="no" style={{ border: 0 }} />
    </div>
  );
}
