export type IconName =
  | 'flow'
  | 'list'
  | 'overview'
  | 'arrow'
  | 'chapter'
  | 'close'
  | 'admin'
  | 'plus'
  | 'minus'
  | 'fit'
  | 'edit';

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'flow' && (
        <>
          <rect x="3" y="8" width="6" height="6" rx="1" />
          <rect x="15" y="3" width="6" height="6" rx="1" />
          <rect x="15" y="15" width="6" height="6" rx="1" />
          <path d="M9 11h3V6h3M12 11v7h3" />
        </>
      )}
      {name === 'list' && (
        <>
          <path d="M9 6h12M9 12h12M9 18h12" />
          <path d="M3 6h1M3 12h1M3 18h1" />
        </>
      )}
      {name === 'overview' && (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      )}
      {name === 'arrow' && <path d="M5 12h14m-5-5 5 5-5 5" />}
      {name === 'chapter' && (
        <>
          <path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h4v15h-3a4 4 0 0 0-4 2" />
        </>
      )}
      {name === 'close' && <path d="m6 6 12 12M6 18 18 6" />}
      {name === 'edit' && <path d="m4 16 12-12 4 4L8 20H4zm10-10 4 4" />}
      {name === 'plus' && <path d="M5 12h14M12 5v14" />}
      {name === 'minus' && <path d="M5 12h14" />}
      {name === 'fit' && <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" />}
      {name === 'admin' && (
        <>
          <path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z" />
          <path d="m8 12 3 3 5-6" />
        </>
      )}
    </svg>
  );
}
