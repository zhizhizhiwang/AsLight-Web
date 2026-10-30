import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ContentBlock, CourseAsset } from '../shared/content.ts';
import type { Quest } from '../shared/quests.ts';

const Assets = createContext<ReadonlyMap<string, CourseAsset>>(new Map());
export function CourseMediaProvider({
  assets,
  children,
}: {
  assets: CourseAsset[];
  children: ReactNode;
}) {
  const registry = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  return <Assets.Provider value={registry}>{children}</Assets.Provider>;
}

export function CourseImage({
  assetId,
  alt,
  decorative = false,
  className = '',
  fallback,
}: {
  assetId: string | undefined;
  alt?: string;
  decorative?: boolean;
  className?: string;
  fallback?: ReactNode;
}) {
  const asset = useContext(Assets).get(assetId ?? '');
  const [failed, setFailed] = useState<string | null>(null);
  if (!asset || failed === asset.path) {
    return (
      fallback ??
      (decorative ? null : (
        <span
          className={`course-image-fallback ${className}`}
          role="img"
          aria-label={alt ?? '图片暂不可用'}
        >
          图片暂不可用{alt && <small>{alt}</small>}
        </span>
      ))
    );
  }
  return (
    <img
      className={`course-image ${className}`}
      src={asset.path}
      alt={decorative ? '' : (alt ?? asset.alt)}
      width={asset.width}
      height={asset.height}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(asset.path)}
    />
  );
}

export function QuestArtwork({ quest }: { quest: Quest }) {
  return (
    <CourseImage
      assetId={quest.imageAssetId}
      decorative
      fallback={quest.title.match(/\d+/)?.[0] ?? (quest.kind === 'main' ? '主' : '支')}
    />
  );
}

export function ContentBlocks({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="content-blocks">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return <h4 key={index}>{block.text}</h4>;
          case 'paragraph':
            return (
              <p key={index} className="preserve-text">
                {block.text}
              </p>
            );
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List key={index}>
                {block.items.map((item, i) => (
                  <li key={i} className="preserve-text">
                    {item}
                  </li>
                ))}
              </List>
            );
          }
          case 'image':
            return (
              <figure key={index}>
                <CourseImage assetId={block.assetId} alt={block.alt} />
                {block.caption && <figcaption>{block.caption}</figcaption>}
              </figure>
            );
        }
      })}
    </div>
  );
}
