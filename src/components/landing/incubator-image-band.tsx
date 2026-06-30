import Image from "next/image";

/**
 * Reusable branded image band for the incubator lander. Centers a 16:9
 * generated graphic (black background, single blue accent) in a rounded
 * frame with an optional caption. Used to give each harness/leverage section
 * a visual anchor.
 */
export function IncubatorImageBand({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption?: string;
}) {
  return (
    <div className="px-6 py-6 sm:py-8">
      <figure className="mx-auto w-full max-w-4xl">
        <div className="overflow-hidden rounded-2xl border border-border bg-black">
          <Image
            src={src}
            alt={alt}
            width={1376}
            height={768}
            className="h-auto w-full"
            sizes="(max-width: 768px) 100vw, 896px"
          />
        </div>
        {caption ? (
          <figcaption className="mt-3 text-center text-sm text-muted-foreground">
            {caption}
          </figcaption>
        ) : null}
      </figure>
    </div>
  );
}
