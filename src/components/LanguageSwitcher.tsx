const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'fr', label: 'FR' },
] as const;

interface LanguageSwitcherProps {
  lang: string;
  onChange: (lang: string) => void;
}

export default function LanguageSwitcher({ lang, onChange }: LanguageSwitcherProps) {
  return (
    <div role="group" aria-label="annotation language" title="Annotation language" className="seg" style={{ display: 'flex', gap: 4 }}>
      {LANGS.map((l) => (
        <button key={l.code} type="button" aria-pressed={lang === l.code} onClick={() => onChange(l.code)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
